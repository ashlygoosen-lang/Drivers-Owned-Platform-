import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data directory per run.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-test-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_EMAIL = 'admin@drop.test';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.FRONTEND_DIST = path.join(dir, 'no-frontend');

const { createApp, seedAdmin } = await import('../src/app.js');
let server, base;

before(async () => {
  await seedAdmin();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
  return { status: res.status, data: await res.json() };
}

const pdf = () => new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });

test('full DROP journey: passenger books, driver applies, admin approves, driver completes, passenger rates', async () => {
  // Fare estimate (public)
  const est = await call('POST', '/fares/estimate', { body: { service: 'Ride', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront' } });
  assert.equal(est.status, 200);
  assert.equal(est.data.approximate, false);
  assert.ok(est.data.options.every((o) => o.passengerCommission === 0));

  // Passenger signs up and books
  const reg = await call('POST', '/auth/register', { body: { name: 'Lerato M', email: 'lerato@example.com', password: 'Passw0rd!', phone: '+27821234567' } });
  assert.equal(reg.status, 201);
  const pToken = reg.data.token;
  const dup = await call('POST', '/auth/register', { body: { name: 'Lerato Two', email: 'lerato@example.com', password: 'Passw0rd!' } });
  assert.equal(dup.status, 409);

  const book = await call('POST', '/bookings', { token: pToken, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', passengers: 2, payment: 'Card' } });
  assert.equal(book.status, 201, JSON.stringify(book.data));
  assert.match(book.data.booking.ref, /^DRP-\d+$/);
  const bookingId = book.data.booking.id;

  // Driver applies with documents (creates account)
  const form = new FormData();
  Object.entries({ name: 'Thabo N', email: 'thabo@example.com', phone: '0821112222', password: 'Driver123', participation: 'Driver-owner programme', vehicle: 'Toyota Corolla · CA 123-456', consent: 'true' })
    .forEach(([k, v]) => form.append(k, v));
  form.append('identityDocument', pdf(), 'id.pdf');
  form.append('drivingLicence', pdf(), 'licence.pdf');
  form.append('vehicleDocument', pdf(), 'vehicle.pdf');
  const apply = await call('POST', '/drivers/apply', { form });
  assert.equal(apply.status, 201, JSON.stringify(apply.data));
  const dToken = apply.data.token;

  // Not approved yet: cannot go online
  assert.equal((await call('POST', '/drivers/online', { token: dToken, body: { online: true } })).status, 403);

  // Admin approves and can download the document
  const login = await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } });
  const aToken = login.data.token;
  const apps = await call('GET', '/admin/applications', { token: aToken });
  assert.equal(apps.data.applications.length, 1);
  const fileName = apps.data.applications[0].documents.identityDocument.file;
  const fileRes = await fetch(`${base}/admin/files/${fileName}`, { headers: { authorization: `Bearer ${aToken}` } });
  assert.equal(fileRes.status, 200);
  assert.equal((await fetch(`${base}/admin/files/${fileName}`)).status, 401);
  assert.equal((await call('PATCH', `/admin/applications/${apps.data.applications[0].id}`, { token: aToken, body: { status: 'approved' } })).status, 200);

  // Driver goes online, sees request, accepts and completes
  assert.equal((await call('POST', '/drivers/online', { token: dToken, body: { online: true } })).status, 200);
  const reqs = await call('GET', '/drivers/requests', { token: dToken });
  assert.equal(reqs.data.requests[0].id, bookingId);
  assert.equal((await call('POST', `/drivers/bookings/${bookingId}/accept`, { token: dToken })).status, 200);
  for (const expected of ['arriving', 'in_progress', 'completed']) {
    const r = await call('POST', `/drivers/bookings/${bookingId}/advance`, { token: dToken });
    assert.equal(r.data.booking.status, expected);
  }

  // Passenger sees driver and rates
  const mine = await call('GET', '/bookings', { token: pToken });
  assert.equal(mine.data.bookings[0].driver.name, 'Thabo N');
  assert.equal((await call('POST', `/bookings/${bookingId}/rate`, { token: pToken, body: { rating: 5, feedback: 'Great' } })).status, 200);

  // Dashboards reflect it
  const dDash = await call('GET', '/dashboard', { token: dToken });
  assert.equal(dDash.data.stats.find((s) => s.label === 'Completed trips').value, 1);
  assert.equal(dDash.data.rating, 5);

  // Support + public enquiry
  assert.equal((await call('POST', '/support/tickets', { token: pToken, body: { type: 'Lost item', message: 'I left my umbrella in the car.', bookingRef: book.data.booking.ref } })).status, 201);
  assert.equal((await call('POST', '/enquiries', { body: { topic: 'Business solutions', name: 'Acme', email: 'ops@acme.co.za', message: 'We need staff transport.' } })).status, 201);

  // Access control
  assert.equal((await call('GET', '/admin/users', { token: pToken })).status, 403);
  assert.equal((await call('GET', '/bookings')).status, 401);
});

test('validation errors are friendly', async () => {
  const r = await call('POST', '/fares/estimate', { body: { service: 'Ride', pickup: 'Sea Point', destination: 'sea point' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /different/);
  const weak = await call('POST', '/auth/register', { body: { name: 'A B', email: 'a@b.co', password: 'short' } });
  assert.equal(weak.status, 400);
});
