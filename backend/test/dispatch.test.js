import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-dispatch-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  DISPATCH_OFFER_COUNT: '1', DISPATCH_RADIUS_KM: '8', DISPATCH_WIDEN_KM: '5', DISPATCH_BROADCAST_AFTER_MIN: '4', DISPATCH_REFRESH_MS: '0',
});
const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const sees = async (d, b) => (await call('GET', '/drivers/requests', { token: d.token })).data.requests.find((r) => r.id === b.id);
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

test('requests go to the nearest driver first, then widen with time; drivers without GPS are not left out', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'pia@example.com');
  const p2 = await verifiedPassenger(call, admin, 'pete@example.com', '910303', '5009082');
  const near = await verifiedDriver(call, admin, 'near@example.com', '850101', '5009083');
  const mid = await verifiedDriver(call, admin, 'mid@example.com', '850202', '5009084');
  const far = await verifiedDriver(call, admin, 'far@example.com', '850303', '5009085');
  const nogps = await verifiedDriver(call, admin, 'nogps@example.com', '850404', '5009086');
  for (const d of [near, mid, far, nogps]) await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  // Pickup: Cape Town City Centre (-33.9249, 18.4241)
  await call('POST', '/drivers/location', { token: near.token, body: { lat: -33.926, lng: 18.425, accuracy: 10 } }); // ~0.2 km
  await call('POST', '/drivers/location', { token: mid.token, body: { lat: -33.98, lng: 18.47, accuracy: 10 } });  // ~7.4 km
  await call('POST', '/drivers/location', { token: far.token, body: { lat: -34.1, lng: 18.85, accuracy: 10 } });   // ~44 km

  const b = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', payment: 'Cash' } })).data.booking;
  const offer = await sees(near, b);
  assert.ok(offer, 'nearest driver is offered the trip');
  assert.ok(offer.pickupDistanceKm < 0.5, 'distance to the pickup is shown');
  assert.equal(await sees(mid, b), undefined, 'only the nearest 1 at first (DISPATCH_OFFER_COUNT=1)');
  assert.equal(await sees(far, b), undefined);
  assert.equal(await sees(nogps, b), undefined, 'enough located drivers nearby: the no-GPS driver is not needed');

  // After 1 minute: twice as many drivers, radius 13 km → the mid driver too, still not the far one
  db.update('bookings', b.id, { history: b.history.map((h) => ({ ...h, at: ago(1.2) })) });
  assert.ok(await sees(mid, b));
  assert.equal(await sees(far, b), undefined);
  // After 4 minutes: everyone, as before proximity dispatch
  db.update('bookings', b.id, { history: b.history.map((h) => ({ ...h, at: ago(4.5) })) });
  assert.ok(await sees(far, b));
  assert.ok(await sees(nogps, b));

  // A busy driver is not offered new trips; nobody located in range → drivers without GPS see it at once
  assert.equal((await call('POST', `/drivers/bookings/${b.id}/accept`, { token: near.token })).status, 200);
  const b2 = (await call('POST', '/bookings', { token: p2.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', payment: 'Cash' } })).data.booking;
  assert.ok(await sees(mid, b2), 'mid driver is now the nearest available');
  assert.equal(await sees(near, b2), undefined, 'driver on a trip is skipped');
  assert.equal(await sees(nogps, b2), undefined);
  await call('POST', '/drivers/online', { token: mid.token, body: { online: false } });
  assert.ok(await sees(nogps, b2), 'no available located driver within 8 km → shown to drivers without GPS');

  // The taken trip disappears from everyone's list immediately
  assert.equal(await sees(far, b), undefined);
});

test('DISPATCH_MODE=broadcast restores the old behaviour', async () => {
  process.env.DISPATCH_MODE = 'broadcast';
  try {
    const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
    const p = await verifiedPassenger(call, admin, 'bea@example.com', '920404', '5009088');
    const far = (await call('POST', '/auth/login', { body: { email: 'far@example.com', password: 'Driver123' } })).data;
    const b = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', payment: 'Cash' } })).data.booking;
    assert.ok(await sees(far, b));
  } finally { delete process.env.DISPATCH_MODE; }
});
