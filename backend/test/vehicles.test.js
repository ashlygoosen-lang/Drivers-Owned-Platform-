import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-vehicles-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  DISPATCH_REFRESH_MS: '0', DISPATCH_BROADCAST_AFTER_MIN: '0',
});
const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { vehicleProfile, eligibleCategories, currentYear } = await import('../src/vehicles.js');
let server, base, admin;
const call = makeClient(() => base);
before(async () => {
  await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
});
after(async () => { server.closeAllConnections(); server.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const Y = currentYear();
const car = (over = {}) => ({ catalogueId: 'volkswagen|polo-vivo', year: Y - 3, plate: 'CA 123-456', colour: 'White', ...over });

test('catalogue: types, South African models, rules and travel operators', async () => {
  const r = await call('GET', '/vehicles/catalogue');
  assert.equal(r.status, 200);
  assert.ok(r.data.types.some((t) => t.key === 'minibus') && r.data.types.some((t) => t.key === 'motorbike') && r.data.types.some((t) => t.key === 'bakkie'));
  assert.ok(r.data.models.some((m) => m.make === 'Toyota' && m.model.startsWith('Quantum') && m.type === 'minibus'));
  assert.ok(r.data.operators.bus.includes('Intercape') && r.data.operators.flightInternational.includes('Emirates'));
});

test('what each vehicle may do follows the age and type rules', () => {
  assert.deepEqual(eligibleCategories({ type: 'hatchback', year: Y - 3 }).filter((k) => k.startsWith('Ride')), ['Ride:Go'], 'hatchbacks are Go only');
  const sedan = eligibleCategories({ type: 'sedan', year: Y - 6 });
  assert.ok(sedan.includes('Ride:Go') && sedan.includes('Ride:Comfort'));
  assert.ok(!eligibleCategories({ type: 'sedan', year: Y - 10 }).includes('Ride:Comfort'), 'sedans older than 8 years are Go only');
  const quantum = vehicleProfile(car({ catalogueId: 'toyota|quantum-14-seater', year: Y - 5 }));
  assert.equal(quantum.type, 'minibus'); assert.equal(quantum.seats, 14);
  assert.ok(quantum.categories.includes('Ride:Minibus') && quantum.categories.includes('Ride:XL'));
  const hilux = vehicleProfile(car({ catalogueId: 'toyota|hilux', year: Y - 12 }));
  assert.ok(hilux.categories.includes('Delivery:Bakkie') && !hilux.categories.some((k) => k.startsWith('Ride')));
  const bike = vehicleProfile(car({ catalogueId: 'honda|ace-125', year: Y - 2 }));
  assert.deepEqual(bike.categories, ['Delivery:Documents', 'Delivery:Small parcel', 'Delivery:Food & retail']);
  assert.throws(() => vehicleProfile(car({ catalogueId: 'honda|ace-125', year: Y - 14 })), /motorbike or scooter must be 10 years old or newer/);
  const exec = vehicleProfile(car({ catalogueId: 'bmw|5-series', year: Y - 2 }));
  assert.ok(exec.categories.includes('Ride:Executive') && exec.categories.includes('Premium Drive:Executive sedan'));
  const other = vehicleProfile({ type: 'sedan', make: 'Chery', model: 'Arrizo 6', year: Y - 1, plate: 'GP 12 AB', colour: 'Grey' });
  assert.equal(other.listed, false, 'unlisted models are allowed and flagged for review');
  assert.throws(() => vehicleProfile(car({ plate: '!' })), /registration number/);
});

test('minibus is for monthly plans only; Go and Bakkie are bookable', async () => {
  const p = await verifiedPassenger(call, admin, 'rider@example.com');
  const q = await call('POST', '/fares/estimate', { token: p.token, body: { service: 'Ride', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront' } });
  const ride = (q.data.quote || q.data).options.map((o) => o.category);
  assert.ok(ride.includes('Go') && ride.includes('Comfort') && !ride.includes('Minibus'));
  assert.equal((q.data.quote || q.data).selected.category, 'Comfort', 'Comfort stays the default');
  const mini = await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Minibus', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', payment: 'Cash' } });
  assert.equal(mini.status, 400);
  const planQuote = await call('POST', '/plans/quote', { token: p.token, body: { kind: 'scholar', category: 'Minibus', riderCount: 12, pickup: 'Sea Point Promenade', destination: 'Cape Town City Centre', outTime: '06:45', days: [1, 2, 3, 4, 5], startDate: new Date(Date.UTC(Y, new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 10) } });
  assert.equal(planQuote.status, 200, JSON.stringify(planQuote.data));
});

test('drivers only get trips their vehicle is approved for; vehicle changes wait for compliance', async () => {
  const p = await verifiedPassenger(call, admin, 'needs@example.com', '910303', '5009082');
  const d = await verifiedDriver(call, admin, 'biker@example.com', '850101', '5009083');
  // Approved driver changes to a motorbike: it waits for compliance, the old (legacy) vehicle keeps working.
  const ch = await call('PUT', '/drivers/vehicle', { token: d.token, body: car({ catalogueId: 'honda|ace-125', plate: 'CA 777-001', colour: 'Red' }) });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  assert.equal(ch.data.pending.type, 'motorbike');
  const queue = await call('GET', '/compliance/vehicles', { token: admin });
  assert.ok(queue.data.pending.some((x) => x.userId === d.id));
  assert.equal((await call('POST', `/compliance/vehicles/${d.id}/decision`, { token: admin, body: { decision: 'approve' } })).status, 200);
  assert.equal(db.byId('users', d.id).vehicleProfile.type, 'motorbike');

  await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  const ride = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', payment: 'Cash' } })).data.booking;
  const offered = (await call('GET', '/drivers/requests', { token: d.token })).data.requests;
  assert.ok(!offered.some((r) => r.id === ride.id), 'a motorbike is not offered a passenger ride');
  assert.equal((await call('POST', `/drivers/bookings/${ride.id}/accept`, { token: d.token })).status, 403);
  await call('POST', `/bookings/${ride.id}/cancel`, { token: p.token, body: {} });
  const parcel = (await call('POST', '/bookings', { token: p.token, body: { service: 'Delivery', category: 'Documents', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', parcel: 'Contract', payment: 'Cash' } })).data.booking;
  assert.ok((await call('GET', '/drivers/requests', { token: d.token })).data.requests.some((r) => r.id === parcel.id), 'a motorbike is offered documents');
  const acc = await call('POST', `/drivers/bookings/${parcel.id}/accept`, { token: d.token });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.booking.driver?.vehicleType ?? 'motorbike', 'motorbike');
  const view = await call('GET', `/bookings/${parcel.id}`, { token: p.token });
  assert.equal(view.data.booking.driver.vehicleType, 'motorbike', 'the passenger sees what kind of vehicle is coming');
});
