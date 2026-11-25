import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

/* ---- Stand-in Google Maps Platform (Geocoding + Routes) ---- */
const hits = { geocode: 0, routes: 0 };
const google = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/maps/api/geocode/json')) {
      hits.geocode++;
      const u = new URL(req.url, 'http://x');
      if (u.searchParams.get('key') !== 'srv-key') return res.end(JSON.stringify({ status: 'REQUEST_DENIED' }));
      return res.end(JSON.stringify({ status: 'OK', results: [{ formatted_address: `${u.searchParams.get('address')}, Cape Town`, geometry: { location: { lat: -33.95, lng: 18.47 } } }] }));
    }
    if (req.url === '/directions/v2:computeRoutes') {
      hits.routes++;
      assert.equal(req.headers['x-goog-api-key'], 'srv-key');
      const b = JSON.parse(body);
      assert.equal(b.routingPreference, 'TRAFFIC_AWARE');
      return res.end(JSON.stringify({ routes: [{ distanceMeters: 4200, duration: '540s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' } }] }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => google.listen(0, r));
const gbase = `http://127.0.0.1:${google.address().port}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-track-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  GOOGLE_MAPS_SERVER_KEY: 'srv-key', GOOGLE_MAPS_BROWSER_KEY: 'browser-key', GOOGLE_MAPS_API_BASE: gbase, GOOGLE_ROUTES_API_BASE: gbase,
});

const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); google.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('driver GPS reaches the passenger live with a Google route and ETA; staff fleet map', async () => {
  const cfg = (await call('GET', '/maps/config')).data;
  assert.equal(cfg.provider, 'google');
  assert.equal(cfg.browserKey, 'browser-key');

  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'pat@example.com');
  const d = await verifiedDriver(call, admin, 'dee@example.com');
  const other = await verifiedPassenger(call, admin, 'olly@example.com', '910202', '5009087');

  // Unknown street address is geocoded through Google; known places use built-in coordinates
  const b = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: '14 Lower Main Road, Salt River', destination: 'V&A Waterfront', passengers: 1, payment: 'Cash' } })).data.booking;
  assert.equal(hits.geocode, 1);
  assert.deepEqual([b.pickupLoc.lat, b.pickupLoc.source], [-33.95, 'google']);
  assert.equal(b.destinationLoc.source, 'places');

  // Offline drivers are not tracked
  assert.equal((await call('POST', '/drivers/location', { token: d.token, body: { lat: -33.93, lng: 18.45 } })).data.reason, 'offline');
  await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  assert.equal((await call('POST', '/drivers/location', { token: d.token, body: { lat: 999, lng: 18 } })).status, 400);
  assert.equal((await call('POST', '/drivers/location', { token: d.token, body: { lat: -33.9349, lng: 18.4549, accuracy: 12 } })).data.ok, true);

  // Staff fleet map shows the available driver and the open request
  let fleet = (await call('GET', '/admin/fleet', { token: admin })).data;
  assert.equal(fleet.drivers.length, 1);
  assert.equal(fleet.drivers[0].state, 'available');
  assert.ok(fleet.requests.find((r) => r.ref === b.ref));
  assert.equal((await call('GET', '/admin/fleet', { token: p.token })).status, 403);

  // Before a driver accepts, the passenger sees no driver position
  let t = (await call('GET', `/bookings/${b.id}/tracking`, { token: p.token })).data;
  assert.equal(t.driver, null);
  assert.equal(t.pickup.label, '14 Lower Main Road, Salt River');

  await call('POST', `/drivers/bookings/${b.id}/accept`, { token: d.token });
  await new Promise((r) => setTimeout(r, 1100)); // fixes are accepted at most once a second
  const fix = (await call('POST', '/drivers/location', { token: d.token, body: { lat: -33.935, lng: 18.455, heading: 90, speed: 10 } })).data;
  assert.equal(fix.eta.durationSec, 540);
  assert.equal(hits.routes, 1);

  t = (await call('GET', `/bookings/${b.id}/tracking`, { token: p.token })).data;
  assert.equal(t.stage, 'to_pickup');
  assert.equal(t.driver.lat, -33.935);
  assert.equal(t.driver.heading, 90);
  assert.equal(t.route.polyline, '_p~iF~ps|U_ulLnnqC');
  assert.ok(t.eta.durationSec > 0);
  assert.equal(hits.routes, 1, 'route is cached between fixes');
  assert.deepEqual(t.trail, [], 'passenger does not get the raw trail during the trip');
  assert.equal((await call('GET', `/bookings/${b.id}/tracking`, { token: other.token })).status, 404);

  // Passenger shares their spot with the driver until pickup
  assert.equal((await call('POST', `/bookings/${b.id}/my-location`, { token: p.token, body: { lat: -33.9501, lng: 18.4702, accuracy: 9 } })).data.sharing, true);
  t = (await call('GET', `/bookings/${b.id}/tracking`, { token: d.token })).data;
  assert.equal(t.passenger.lat, -33.9501);
  assert.equal((await call('GET', `/bookings/${b.id}/tracking`, { token: p.token })).data.passenger, null);
  await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token }); // arriving
  await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token }); // in_progress
  t = (await call('GET', `/bookings/${b.id}/tracking`, { token: d.token })).data;
  assert.equal(t.passenger, null, 'passenger location stops once they are in the car');
  assert.equal(t.stage, 'to_destination');
  assert.equal((await call('POST', `/bookings/${b.id}/my-location`, { token: p.token, body: { lat: -33.95, lng: 18.47 } })).status, 400);

  fleet = (await call('GET', '/admin/fleet', { token: admin })).data;
  assert.equal(fleet.drivers[0].state, 'on_trip');

  // After the trip both sides can see the route that was driven
  await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token });
  t = (await call('GET', `/bookings/${b.id}/tracking`, { token: p.token })).data;
  assert.equal(t.driver, null, 'live position stops when the trip ends');
  assert.ok(t.trail.length >= 1);
});

test('impossible GPS jumps are ignored, flagged after repeats, and a real glitch recovers (SEC-021)', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const d = await verifiedDriver(call, admin, 'jumpy@example.com', '850505', '5009081');
  await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  const fix = async (lat, lng, extra = {}) => { await new Promise((r) => setTimeout(r, 1050)); return (await call('POST', '/drivers/location', { token: d.token, body: { lat, lng, accuracy: 10, ...extra } })).data; };

  assert.equal((await fix(-33.92, 18.42)).ok, true);
  assert.equal((await fix(-33.921, 18.421)).ok, true, 'normal driving is accepted');
  assert.equal((await fix(-33.93, 18.43, { speed: 120 })).reason, 'implausible', 'reported speed above 250 km/h');
  assert.equal((await fix(-26.2, 28.04)).reason, 'implausible', 'Cape Town to Johannesburg in a second');
  const before = db.all('securityEvents').filter((e) => e.type === 'gps_implausible').length;
  assert.equal((await fix(-26.2001, 28.0401)).ok, true, 'two consistent fixes at the new place are accepted (stored fix was the outlier)');
  assert.equal((await fix(-33.92, 18.42)).reason, 'implausible');
  assert.equal(db.all('securityEvents').filter((e) => e.type === 'gps_implausible').length, before + 1, 'third jump in 10 minutes alerts operations');
});
