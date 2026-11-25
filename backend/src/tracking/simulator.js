import { db } from '../db.js';
import { updateDriverLocation } from '../routes/tracking.js';
import { distanceKm } from './geo.js';
import { getLocation } from './locations.js';

/**
 * Demo only: drives the demo driver's car along Cape Town roads so the live map can be tried
 * without a phone in a moving car. Never touches real accounts, and stops as soon as the
 * driver's phone sends a real GPS fix.
 */
const APPROACH = [[-33.9105, 18.4010], [-33.9086, 18.4063], [-33.9070, 18.4105], [-33.9058, 18.4150], [-33.9047, 18.4185], [-33.9036, 18.4207]]; // Green Point → V&A Waterfront
const TRIP = [[-33.9036, 18.4207], [-33.9100, 18.4232], [-33.9165, 18.4262], [-33.9228, 18.4318], [-33.9290, 18.4385], [-33.9338, 18.4440], [-33.9395, 18.4512], [-33.9460, 18.4575], [-33.9535, 18.4626], [-33.9612, 18.4648], [-33.9690, 18.4622], [-33.9755, 18.4565], [-33.9810, 18.4480], [-33.9850, 18.4395], [-33.9875, 18.4327]]; // → Kirstenbosch via the M3
const STEP_KM = 0.035; // ~42 km/h at one fix every 3 s
const state = new Map(); // bookingId -> { stage, leg, t, parkedAt }

function advance(path, s) {
  let left = STEP_KM;
  while (s.leg < path.length - 1 && left > 0) {
    const a = { lat: path[s.leg][0], lng: path[s.leg][1] };
    const b = { lat: path[s.leg + 1][0], lng: path[s.leg + 1][1] };
    const segKm = distanceKm(a, b) || 0.001;
    const remain = segKm * (1 - s.t);
    if (left >= remain) { left -= remain; s.leg++; s.t = 0; } else { s.t += left / segKm; left = 0; }
  }
  if (s.leg >= path.length - 1) return { lat: path.at(-1)[0], lng: path.at(-1)[1], done: true };
  const [a, b] = [path[s.leg], path[s.leg + 1]];
  return { lat: a[0] + (b[0] - a[0]) * s.t, lng: a[1] + (b[1] - a[1]) * s.t, done: false };
}

async function tick() {
  for (const b of db.filter('bookings', (x) => x.demoLive && ['accepted', 'arriving', 'in_progress'].includes(x.status))) {
    const driver = db.byId('users', b.driverId);
    if (!driver) continue;
    const loc = await getLocation(driver.id);
    if (loc?.source === 'gps' && Date.now() - Date.parse(loc.at) < 60_000) continue; // a real phone is reporting
    const stage = b.status === 'in_progress' ? 'trip' : 'approach';
    let s = state.get(b.id);
    if (!s || s.stage !== stage) { s = { stage, leg: 0, t: 0, parkedAt: 0 }; state.set(b.id, s); }
    const p = advance(stage === 'trip' ? TRIP : APPROACH, s);
    if (p.done) {
      // Waiting at the pickup: after a minute, loop the approach again so visitors always see movement.
      s.parkedAt ||= Date.now();
      if (stage === 'approach' && Date.now() - s.parkedAt > 60_000) state.delete(b.id);
    }
    await updateDriverLocation(driver, { lat: p.lat, lng: p.lng, speed: p.done ? 0 : 11.7, accuracy: 5 }, 'simulator');
  }
}

export function startDemoSimulator() {
  const timer = setInterval(() => { tick().catch((err) => console.warn('[drop] demo simulator', err.message)); }, 3000);
  timer.unref();
  return timer;
}
