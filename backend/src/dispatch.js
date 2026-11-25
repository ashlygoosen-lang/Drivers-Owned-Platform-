import { canTake } from './vehicles.js';
import { db } from './db.js';
import { allLocations } from './tracking/locations.js';
import { distanceKm, locate } from './tracking/geo.js';
import { sameWorld } from './demoPolicy.js';
import { scholarEligibility, sastDate, sastTime } from './plans.js';

/**
 * Proximity dispatch (Phase 6B-2).
 *
 * Before: every open request went to every online driver, so at peak ~90% of driver traffic was
 * drivers racing for trips somebody nearer had already taken. Now each request is offered to the
 * nearest few available drivers, and the offer widens the longer it waits:
 *
 *   wait 0–1 min  → nearest DISPATCH_OFFER_COUNT drivers (default 5) within DISPATCH_RADIUS_KM (default 8)
 *   each minute   → twice as many drivers, radius + DISPATCH_WIDEN_KM (default 5), up to DISPATCH_MAX_KM (40)
 *   after DISPATCH_BROADCAST_AFTER_MIN (default 4) → every online driver, as before
 *
 * Requests are matched oldest first and a driver is offered at most DISPATCH_OFFERS_PER_DRIVER (2)
 * at a time, so a cluster of requests (a mall, an airport) spreads over the drivers around it
 * instead of every request going to the same few.
 *
 * Safe fallbacks keep today's behaviour wherever position is unknown: a request without pickup
 * coordinates is shown to everyone, and drivers who share no location (e.g. the website without
 * GPS) see any request that could not find enough located drivers nearby.
 * DISPATCH_MODE=broadcast switches the whole thing off.
 *
 * Accepting is unchanged: PostgreSQL still decides who wins (bookingState.transition). The plan is
 * rebuilt every couple of seconds per server from shared data (Redis locations, PostgreSQL bookings),
 * so every server computes the same offers.
 */
const env = (k, d) => (process.env[k] === undefined ? d : Number(process.env[k]));
const cfg = () => ({
  mode: process.env.DISPATCH_MODE || 'nearest',
  offer: env('DISPATCH_OFFER_COUNT', 5),
  radius: env('DISPATCH_RADIUS_KM', 8),
  widen: env('DISPATCH_WIDEN_KM', 5),
  maxKm: env('DISPATCH_MAX_KM', 40),
  broadcastAfterMin: env('DISPATCH_BROADCAST_AFTER_MIN', 4),
  refreshMs: env('DISPATCH_REFRESH_MS', 2000),
  perDriver: env('DISPATCH_OFFERS_PER_DRIVER', 2),
});
const FRESH_MS = 2 * 60_000; // a driver location older than this doesn't count
const CELL = 0.05; // grid cell ≈ 5 km, for nearest-driver search without scanning every driver
const ACTIVE = ['accepted', 'arriving', 'in_progress'];

let plan = { at: 0, offers: new Map(), everyone: new Set(), unlocated: new Set(), open: [] };
let building = null;
const geocoding = new Set();

const cellOf = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
// Waiting time counts from when the request opened (card trips open after payment, not at creation).
const openedAt = (b) => [...(b.history || [])].reverse().find((h) => h.status === 'requested')?.at || b.createdAt;
const ageMin = (b) => (Date.now() - Date.parse(openedAt(b))) / 60_000;

/** Pickup coordinates are looked up once per booking, in the background. */
function ensurePickup(b) {
  if (b.pickupLoc !== undefined || geocoding.has(b.id)) return;
  geocoding.add(b.id);
  locate(b.pickup).then((loc) => { if (db.byId('bookings', b.id)) db.update('bookings', b.id, { pickupLoc: loc || null }); })
    .catch(() => undefined).finally(() => geocoding.delete(b.id));
}

async function build() {
  const c = cfg();
  const open = [];
  const busy = new Set();
  for (const b of db.all('bookings')) {
    if (b.status === 'requested') open.push(b);
    else if (b.driverId && ACTIVE.includes(b.status)) busy.add(b.driverId);
  }
  // Drivers with a monthly-plan trip in the next 75 minutes are kept free for it (no on-demand offers).
  const today = sastDate();
  for (const p of db.all('plans')) {
    if (p.status !== 'active' || !p.driverId || !p.pricing?.dates?.includes(today) || (p.skipDates || []).includes(today)) continue;
    if (p.legs.some((l) => { const dt = sastTime(today, l.time) - Date.now(); return dt > 0 && dt < 75 * 60_000; })) busy.add(p.driverId);
  }
  const offers = new Map(); // driverId -> [{ id, km }]
  const everyone = new Set(); // booking ids shown to all online drivers
  const unlocated = new Set(); // booking ids also shown to drivers without a location
  if (c.mode === 'broadcast') { for (const b of open) everyone.add(b.id); return { at: Date.now(), offers, everyone, unlocated, open }; }

  // Available, located drivers on a coarse grid.
  const grid = new Map();
  if (open.length) {
    for (const [driverId, loc] of await allLocations()) {
      if (busy.has(driverId) || !loc?.at || Date.now() - Date.parse(loc.at) > FRESH_MS) continue;
      const u = db.byId('users', driverId);
      if (!u || !u.online || u.driverStatus !== 'approved') continue;
      const k = cellOf(loc.lat, loc.lng);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ id: driverId, lat: loc.lat, lng: loc.lng, user: u });
    }
  }
  open.sort((x, y) => ageMin(y) - ageMin(x)); // oldest first: longest-waiting passengers get the nearest drivers
  const vettedCache = new Map();
  const vetted = (driverId) => { if (!vettedCache.has(driverId)) vettedCache.set(driverId, scholarEligibility(driverId).eligible); return vettedCache.get(driverId); };
  for (const b of open) {
    ensurePickup(b);
    const age = ageMin(b);
    const p = b.pickupLoc;
    if (!p || age >= c.broadcastAfterMin) { everyone.add(b.id); continue; }
    const steps = Math.floor(age);
    const want = c.offer * 2 ** steps;
    const radius = Math.min(c.maxKm, c.radius + c.widen * steps);
    const passenger = db.byId('users', b.userId);
    // Search the grid ring by ring out to the radius, keep the nearest `want` drivers.
    const found = [];
    const ci = Math.floor(p.lat / CELL), cj = Math.floor(p.lng / CELL);
    const rings = Math.ceil(radius / (CELL * 111 * Math.cos((p.lat * Math.PI) / 180))) + 1;
    for (let di = -rings; di <= rings; di++) for (let dj = -rings; dj <= rings; dj++) {
      for (const d of grid.get(`${ci + di}:${cj + dj}`) || []) {
        if (!sameWorld(d.user, passenger) || (offers.get(d.id)?.length || 0) >= c.perDriver) continue;
        if (b.requiresScholarVetting && !vetted(d.id)) continue;
        if (!canTake(d.user, b)) continue; // the vehicle must be allowed for this category
        const km = distanceKm(p, d);
        if (km <= radius) found.push({ id: d.id, km });
      }
    }
    found.sort((x, y) => x.km - y.km);
    for (const f of found.slice(0, want)) {
      if (!offers.has(f.id)) offers.set(f.id, []);
      offers.get(f.id).push({ id: b.id, km: Math.round(f.km * 10) / 10 });
    }
    if (found.length < want) unlocated.add(b.id); // not enough located drivers: let unlocated ones see it too
  }
  return { at: Date.now(), offers, everyone, unlocated, open };
}

async function current() {
  if (Date.now() - plan.at < cfg().refreshMs) return plan;
  building ||= build().then((p) => { plan = p; return p; }).finally(() => { building = null; });
  return building;
}

/**
 * A new request opened: rebuild within half a second instead of waiting for the next tick.
 * (Taken requests need no rebuild: requestsFor re-checks each status.) Bursts coalesce into one rebuild.
 */
export function invalidate() { plan = { ...plan, at: Math.min(plan.at, Date.now() - cfg().refreshMs + 500) }; }

/** Open requests this driver should see, nearest first. `located` = the driver has a fresh GPS fix. */
export async function requestsFor(driver, location) {
  const p = await current();
  const located = Boolean(location?.at && Date.now() - Date.parse(location.at) <= FRESH_MS);
  const mine = new Map((p.offers.get(driver.id) || []).map((o) => [o.id, o.km]));
  const out = [];
  for (const b of p.open) {
    const fresh = db.byId('bookings', b.id);
    if (!fresh || fresh.status !== 'requested' || !sameWorld(driver, db.byId('users', fresh.userId))) continue;
    if (fresh.requiresScholarVetting && !scholarEligibility(driver.id).eligible) continue; // learners: vetted drivers only
    if (!canTake(driver, fresh)) continue;
    if (mine.has(b.id) || p.everyone.has(b.id) || (!located && p.unlocated.has(b.id))) {
      const km = mine.get(b.id) ?? (located && fresh.pickupLoc ? Math.round(distanceKm(location, fresh.pickupLoc) * 10) / 10 : null);
      out.push({ booking: fresh, km });
    }
  }
  out.sort((x, y) => (x.km ?? 1e9) - (y.km ?? 1e9) || String(y.booking.createdAt).localeCompare(String(x.booking.createdAt)));
  return out.slice(0, 20);
}

