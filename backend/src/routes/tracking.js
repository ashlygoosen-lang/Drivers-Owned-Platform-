import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { wrap, bad, HttpError } from '../validate.js';
import { emit } from '../comms/hub.js';
import { browserKey, serverKey, locate, drivingRoute, distanceKm, roughEta, validPoint, bearing } from '../tracking/geo.js';
import { setLocation, getLocation, allLocations } from '../tracking/locations.js';
import * as kv from '../kv.js';

/**
 * Real-time vehicle tracking.
 * - Drivers' phones send GPS fixes (POST /drivers/location) while they are online.
 * - The passenger on that driver's active trip receives each fix live, with the road route and a
 *   traffic-aware ETA to the pickup (before pickup) or the destination (during the trip).
 * - Passengers can choose to share their own location with the driver until they are picked up.
 * - Admin and support see every online driver on a live fleet map.
 * Locations are only shared with the other person on an active trip. A sampled route trail is kept
 * on the booking for safety and dispute handling.
 */
const router = Router();
const ACTIVE = ['accepted', 'arriving', 'in_progress'];
const FLEET_ROLES = ['admin', 'support'];
const STALE_MS = 2 * 60_000;

const stageOf = (b) => (b.status === 'in_progress' ? 'to_destination' : ['accepted', 'arriving'].includes(b.status) ? 'to_pickup' : b.status);
const routes = new Map(); // bookingId -> { route, stage, origin, at, version }
// Passenger's shared pickup spot: Redis with a 10-minute expiry (never written to the database).
const spotKey = (bookingId) => `spot:${bookingId}`;
const getSpot = async (bookingId) => { const r = await kv.get(spotKey(bookingId)); return r ? JSON.parse(r) : null; };
const lastFix = new Map(); // driverId -> ms

/** Pickup and destination coordinates, looked up once and stored on the booking. */
export async function tripPoints(b) {
  if (b.pickupLoc === undefined || b.destinationLoc === undefined) {
    const [p, d] = await Promise.all([locate(b.pickup), locate(b.destination)]);
    db.update('bookings', b.id, { pickupLoc: p, destinationLoc: d });
  }
  return { pickup: b.pickupLoc || null, destination: b.destinationLoc || null };
}

async function etaFor(b, loc) {
  const pts = await tripPoints(b);
  const stage = stageOf(b);
  const target = stage === 'to_pickup' ? pts.pickup : stage === 'to_destination' ? pts.destination : null;
  if (!target || !loc) return { stage, eta: null, route: null };
  let cached = routes.get(b.id);
  const fresh = cached && cached.stage === stage && Date.now() - cached.at < 30_000 && distanceKm(cached.origin, loc) < 0.4;
  if (!fresh) {
    const route = await drivingRoute(loc, target);
    cached = { route, stage, origin: { lat: loc.lat, lng: loc.lng }, at: Date.now(), version: (cached?.version || 0) + 1, straight: distanceKm(loc, target) };
    routes.set(b.id, cached);
  }
  // Between route refreshes, scale the route's ETA by how much closer the car is.
  const ratio = cached.straight > 0.05 ? Math.min(1.2, distanceKm(loc, target) / cached.straight) : 0;
  const eta = cached.route.estimated ? roughEta(loc, target) : { distanceM: Math.round(cached.route.distanceM * ratio), durationSec: Math.round(cached.route.durationSec * ratio), estimated: false };
  return { stage, eta, route: cached.route.polyline ? { polyline: cached.route.polyline, version: cached.version } : null };
}

/** Record a driver's position, keep the trip trail and push it to the passenger on the active trip. */
export async function updateDriverLocation(driver, fix, source = 'gps') {
  const prev = await getLocation(driver.id);
  const heading = Number.isFinite(fix.heading) && fix.heading >= 0 ? fix.heading : prev && distanceKm(prev, fix) > 0.005 ? bearing(prev, fix) : prev?.heading ?? 0;
  const location = { lat: +fix.lat.toFixed(6), lng: +fix.lng.toFixed(6), heading: Math.round(heading), speed: Number.isFinite(fix.speed) ? Math.max(0, +fix.speed.toFixed(1)) : null, accuracy: Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy) : null, at: now(), source };
  await setLocation(driver.id, location);
  const b = db.find('bookings', (x) => x.driverId === driver.id && ACTIVE.includes(x.status));
  if (!b) return { location, booking: null };
  const trail = b.trail || [];
  const last = trail.at(-1);
  if (!last || Date.now() - last[2] > 15_000 || distanceKm({ lat: last[0], lng: last[1] }, location) > 0.06) {
    trail.push([location.lat, location.lng, Date.now()]);
    if (trail.length > 1500) trail.splice(0, trail.length - 1500);
    db.update('bookings', b.id, { trail });
  }
  const { stage, eta, route } = await etaFor(b, location);
  const payload = { bookingId: b.id, driver: location, stage, eta, route };
  emit(b.userId, 'location', payload);
  emit(driver.id, 'location', payload);
  return { location, booking: b, eta };
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

/* ---------- configuration ---------- */

router.get('/maps/config', (_req, res) => {
  const key = browserKey();
  res.json({
    provider: key ? 'google' : 'none',
    browserKey: key || null,
    mapId: (process.env.GOOGLE_MAPS_MAP_ID || '').trim() || 'DEMO_MAP_ID',
    routes: Boolean(serverKey()),
    center: { lat: -33.9249, lng: 18.4241 },
  });
});

/* ---------- driver GPS ---------- */

router.post('/drivers/location', requireRole('driver'), wrap(async (req, res) => {
  const me = db.byId('users', req.user.id);
  if (me.driverStatus !== 'approved') throw new HttpError(403, 'Your driver account is not active.');
  const b = req.body || {};
  const fix = { lat: num(b.lat), lng: num(b.lng), heading: num(b.heading), speed: num(b.speed), accuracy: num(b.accuracy) };
  if (!validPoint(fix.lat, fix.lng)) throw bad('Invalid location.');
  if (Number.isFinite(fix.accuracy) && fix.accuracy > 2000) return res.json({ ok: false, reason: 'low_accuracy' });
  const active = db.find('bookings', (x) => x.driverId === me.id && ACTIVE.includes(x.status));
  if (!me.online && !active) return res.json({ ok: false, reason: 'offline' }); // only track while working
  if (Date.now() - (lastFix.get(me.id) || 0) < 1000) return res.json({ ok: false, reason: 'throttled' });
  lastFix.set(me.id, Date.now());
  const out = await updateDriverLocation(me, fix, 'gps');
  res.json({ ok: true, eta: out.eta || null, bookingId: out.booking?.id || null });
}));

/* ---------- passenger shares their spot with the driver (until pickup) ---------- */

router.post('/bookings/:id/my-location', requireAuth, wrap(async (req, res) => {
  const b = db.byId('bookings', req.params.id);
  if (!b || b.userId !== req.user.id) throw new HttpError(404, 'Trip not found.');
  if (req.body?.stop) { await kv.del(spotKey(b.id)); if (b.driverId) emit(b.driverId, 'passenger-location', { bookingId: b.id, passenger: null }); return res.json({ ok: true, sharing: false }); }
  if (!b.driverId || !['accepted', 'arriving'].includes(b.status)) throw bad('You can share your location once a driver is on the way.');
  const lat = num(req.body?.lat); const lng = num(req.body?.lng);
  if (!validPoint(lat, lng)) throw bad('Invalid location.');
  const spot = { lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: Number.isFinite(num(req.body?.accuracy)) ? Math.round(num(req.body.accuracy)) : null, at: now() };
  await kv.set(spotKey(b.id), JSON.stringify(spot), 600);
  emit(b.driverId, 'passenger-location', { bookingId: b.id, passenger: spot });
  res.json({ ok: true, sharing: true });
}));

/** Stop sharing the passenger's location once they are in the car or the trip ends. */
export function onTrackingStatus(b) {
  if (!['accepted', 'arriving'].includes(b.status)) void kv.del(spotKey(b.id));
  if (!ACTIVE.includes(b.status)) routes.delete(b.id);
}

/* ---------- live view of one trip ---------- */

router.get('/bookings/:id/tracking', requireAuth, wrap(async (req, res) => {
  const b = await db.findFresh('bookings', (x) => x.id === req.params.id || x.ref === req.params.id);
  const u = req.user;
  const side = b && (b.userId === u.id ? 'passenger' : b.driverId === u.id ? 'driver' : null);
  if (!b || (!side && !FLEET_ROLES.includes(u.role))) throw new HttpError(404, 'Trip not found.');
  const pts = await tripPoints(b);
  const driver = b.driverId ? db.byId('users', b.driverId) : null;
  const driverLoc = driver ? await getLocation(driver.id) : null;
  const live = ACTIVE.includes(b.status) && driverLoc ? driverLoc : null;
  const { stage, eta, route } = live ? await etaFor(b, live) : { stage: stageOf(b), eta: null, route: null };
  res.json({
    bookingId: b.id, ref: b.ref, status: b.status, stage,
    pickup: pts.pickup && { ...pts.pickup, label: b.pickup },
    destination: pts.destination && { ...pts.destination, label: b.destination },
    driver: live && { ...live, stale: Date.now() - Date.parse(live.at) > STALE_MS, name: driver.name.split(' ')[0], vehicle: driver.vehicle || '' },
    passenger: (side === 'driver' || FLEET_ROLES.includes(u.role)) ? await getSpot(b.id) : null,
    eta, route,
    // The route actually driven: for staff, and for both parties once the trip is over.
    trail: (FLEET_ROLES.includes(u.role) || ['completed', 'cancelled'].includes(b.status)) ? (b.trail || []).map(([lat, lng]) => [lat, lng]) : [],
  });
}));

/* ---------- live fleet map (staff) ---------- */

router.get('/admin/fleet', requireRole(...FLEET_ROLES), wrap(async (_req, res) => {
  const cutoff = Date.now() - 15 * 60_000;
  const locs = await allLocations();
  const drivers = db.filter('users', (u) => u.role === 'driver' && u.driverStatus === 'approved' && locs.get(u.id) && Date.parse(locs.get(u.id).at) > cutoff && (u.online || db.find('bookings', (b) => b.driverId === u.id && ACTIVE.includes(b.status))))
    .map((u) => {
      u = { ...u, location: locs.get(u.id) };
      const trip = db.find('bookings', (b) => b.driverId === u.id && ACTIVE.includes(b.status));
      return { id: u.id, name: u.name, vehicle: u.vehicle || '', rating: u.rating || null, ...u.location, stale: Date.now() - Date.parse(u.location.at) > STALE_MS, state: trip ? 'on_trip' : 'available', trip: trip ? { id: trip.id, ref: trip.ref, status: trip.status, pickup: trip.pickup, destination: trip.destination } : null };
    });
  const open = db.filter('bookings', (b) => b.status === 'requested');
  const requests = [];
  for (const b of open.slice(-50)) { const p = await tripPoints(b); if (p.pickup) requests.push({ id: b.id, ref: b.ref, service: b.service, pickup: b.pickup, ...p.pickup, createdAt: b.createdAt }); }
  res.json({ drivers, requests, at: now() });
}));

export default router;
