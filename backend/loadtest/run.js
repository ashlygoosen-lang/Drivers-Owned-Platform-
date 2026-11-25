/**
 * DROP load test (Node, no extra tools). Starts N real server instances on PostgreSQL + Redis,
 * seeds drivers and passengers, then runs the full ride lifecycle at the requested rate:
 *   passenger: fare estimate → book (Idempotency-Key) → poll status until completed
 *   driver:    poll requests → accept → arriving → start → complete, sending GPS every 4 s
 * Reports throughput, latency percentiles per endpoint, errors and correctness checks.
 *
 *   LOAD_DATABASE_URL=... LOAD_REDIS_URL=... node loadtest/run.js --instances 2 --rate 33 --duration 60 --drivers 400
 * (--rate is bookings per second: 33/s = 2,000 per minute.)
 */
import crypto from 'node:crypto';
import { startCluster, seed, query } from '../test/scale/fixture.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const INSTANCES = arg('instances', 2), RATE = arg('rate', 33), DURATION = arg('duration', 60), DRIVERS = arg('drivers', 400);
const DISPATCH = (() => { const i = process.argv.indexOf('--dispatch'); return i > 0 ? process.argv[i + 1] : 'nearest'; })();
const DB = process.env.LOAD_DATABASE_URL, REDIS = process.env.LOAD_REDIS_URL;
if (!DB || !REDIS) { console.error('Set LOAD_DATABASE_URL and LOAD_REDIS_URL'); process.exit(1); }

const stats = new Map(); // name -> { lat: [], errors: {} }
async function timed(name, base, method, url, { token, body, headers } = {}) {
  const t = performance.now();
  let status = 0, data = {};
  try {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    status = res.status; data = await res.json().catch(() => ({}));
  } catch (err) { status = err.name === 'TimeoutError' ? 'timeout' : 'net'; }
  const s = stats.get(name) || { lat: [], codes: {} };
  s.lat.push(performance.now() - t); s.codes[status] = (s.codes[status] || 0) + 1; stats.set(name, s);
  return { status, data };
}
const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await query(DB, 'drop table if exists drop_docs, drop_counters cascade; drop sequence if exists drop_seq');
console.log(`Starting ${INSTANCES} instances…`);
const cluster = await startCluster({ databaseUrl: DB, redisUrl: REDIS, instances: INSTANCES, basePort: 4850, env: { DISPATCH_MODE: DISPATCH } });
const bases = cluster.instances.map((s) => s.base);
const passengersNeeded = Math.ceil(RATE * DURATION) + 50;
console.log(`Seeding ${DRIVERS} drivers and ${passengersNeeded} passengers…`);
const people = await seed(DB, { drivers: DRIVERS, passengers: passengersNeeded });
const baseFor = (i) => bases[i % bases.length];
const trip = { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', passengers: 1, payment: 'Cash' };

let running = true;
let booked = 0, completed = 0;
const completedAt = [];
// Drivers
const driverLoops = people.drivers.map(async (d, i) => {
  const base = baseFor(i + 1);
  let lat = -33.92 + (i % 50) * 0.001, lng = 18.42 + Math.floor(i / 50) * 0.001, lastGps = 0;
  await sleep(Math.random() * 1000);
  while (running) {
    if (Date.now() - lastGps > 4000) { lastGps = Date.now(); lat += 0.0002; void timed('POST /drivers/location', base, 'POST', '/drivers/location', { token: d.token, body: { lat, lng, accuracy: 8, speed: 10 } }); }
    const r = await timed('GET /drivers/requests', base, 'GET', '/drivers/requests', { token: d.token });
    const active = r.data.active;
    if (active) {
      await sleep(300);
      const a = await timed('POST /drivers/bookings/:id/advance', base, 'POST', `/drivers/bookings/${active.id}/advance`, { token: d.token });
      if (a.status === 200 && a.data.booking?.status === 'completed') { completed++; completedAt.push(Date.now()); }
      continue;
    }
    const open = r.data.requests || [];
    if (open.length) {
      // A person reads the request before tapping Accept, and waits for the list to refresh if it was taken.
      const pick = open[Math.floor(Math.random() * Math.min(open.length, 3))];
      await sleep(400 + Math.random() * 1200);
      const a = await timed('POST /drivers/bookings/:id/accept', base, 'POST', `/drivers/bookings/${pick.id}/accept`, { token: d.token });
      if (a.status !== 200) await sleep(1000);
      continue;
    }
    await sleep(800 + Math.random() * 400);
  }
});
// Passengers: open-loop arrivals at RATE per second
const passengerLoops = [];
const start = Date.now();
let next = 0;
console.log(`Running ${DURATION}s at ${RATE} bookings/s (${RATE * 60}/min)…`);
while (Date.now() - start < DURATION * 1000) {
  const p = people.passengers[next++];
  const base = baseFor(next);
  passengerLoops.push((async () => {
    await timed('POST /fares/estimate', base, 'POST', '/fares/estimate', { token: p.token, body: trip });
    const b = await timed('POST /bookings', base, 'POST', '/bookings', { token: p.token, body: { ...trip, category: 'Comfort' }, headers: { 'idempotency-key': crypto.randomUUID() } });
    if (b.status !== 201) return;
    booked++;
    for (let k = 0; k < 20 && running; k++) {
      await sleep(1500);
      const s = await timed('GET /bookings/:id', base, 'GET', `/bookings/${b.data.booking.id}`, { token: p.token });
      if (s.data.booking?.status === 'completed') return;
    }
  })());
  await sleep(1000 / RATE);
}
const offered = next;
await sleep(15_000); // let in-flight trips finish
running = false;
await Promise.allSettled([...passengerLoops, ...driverLoops]);

// Correctness checks straight from the database
const [dupRefs] = await query(DB, "select count(*)::int n from (select data->>'ref' from drop_docs where collection='bookings' group by 1 having count(*)>1) x");
const [multiActive] = await query(DB, "select count(*)::int n from (select data->>'driverId' from drop_docs where collection='bookings' and data->>'status' in ('accepted','arriving','in_progress') group by 1 having count(*)>1) x");
const [unsettled] = await query(DB, "select count(*)::int n from drop_docs where collection='bookings' and data->>'status'='completed' and data->>'settledAt' is null");
const [ledger] = await query(DB, "select coalesce(sum((l->>'dr')::bigint),0)::text dr, coalesce(sum((l->>'cr')::bigint),0)::text cr from drop_docs d, jsonb_array_elements(d.data->'lines') l where d.collection='ledger'");

const rows = [...stats.entries()].map(([name, s]) => ({ name, n: s.lat.length, p50: pct(s.lat, 50), p95: pct(s.lat, 95), p99: pct(s.lat, 99), codes: s.codes }));
const total = rows.reduce((a, r) => a + r.n, 0);
const result = {
  config: { dispatch: DISPATCH, instances: INSTANCES, rateTarget: `${RATE}/s (${RATE * 60}/min)`, duration: `${DURATION}s`, drivers: DRIVERS, cpuCores: (await import('node:os')).cpus().length },
  bookings: { offered, created: booked, completed, perMinute: Math.round((booked / DURATION) * 60) },
  requests: { total, perSecond: Math.round(total / (DURATION + 15)) },
  latencyMs: rows.map((r) => ({ endpoint: r.name, count: r.n, p50: Math.round(r.p50), p95: Math.round(r.p95), p99: Math.round(r.p99), statuses: r.codes })),
  correctness: { duplicateRefs: dupRefs.n, driversWithTwoActiveTrips: multiActive.n, completedButUnsettled: unsettled.n, ledgerBalanced: ledger.dr === ledger.cr },
};
console.log(JSON.stringify(result, null, 2));
await cluster.stop();
process.exit(0);
