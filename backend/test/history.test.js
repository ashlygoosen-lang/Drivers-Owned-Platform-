// Hot-data window (Phase 6B-1). PostgreSQL only: run through scripts/test-postgres.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

const PG = Boolean(process.env.DATABASE_URL);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-history-'));
Object.assign(process.env, { DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false', HOT_WINDOW_DAYS: '14' });
const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server?.closeAllConnections(); server?.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const oldTrip = (over) => ({ id: crypto.randomUUID(), ref: `DRP-OLD-${Math.random().toString(36).slice(2, 7)}`, service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront',
  passengers: 1, payment: 'Cash', fare: 100, driverServiceFee: 10, driverEarnings: 90, status: 'completed', history: [], createdAt: daysAgo(60), completedAt: daysAgo(60), updatedAt: daysAgo(60), settledAt: daysAgo(60), ...over });
async function insertCold(collection, rec) {
  await db.sql(`insert into drop_docs (collection, id, data, updated_at) values ($1, $2, $3, $4)`, [collection, rec.id, JSON.stringify(rec), rec.updatedAt || rec.createdAt]);
}
const stat = (dash, label) => dash.stats.find((s) => s.label === label).value;

test('old trips leave memory but stay in history, totals, ratings, receipts and POPIA deletion', { skip: !PG && 'needs PostgreSQL' }, async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'hana@example.com');
  const d = await verifiedDriver(call, admin, 'dave@example.com');
  const pid = db.find('users', (u) => u.email === 'hana@example.com').id;
  const did = db.find('users', (u) => u.email === 'dave@example.com').id;

  // 60-day-old history written straight to PostgreSQL (as if from before this server started)
  const t1 = oldTrip({ userId: pid, driverId: did, rating: 5 });
  const t2 = oldTrip({ userId: pid, driverId: did, rating: 3, fare: 50, driverServiceFee: 5, driverEarnings: 45 });
  await insertCold('bookings', t1); await insertCold('bookings', t2);
  await insertCold('messages', { id: crypto.randomUUID(), bookingId: t1.id, senderId: pid, senderName: 'Hana', body: 'thanks!', createdAt: daysAgo(60) });
  await insertCold('notifications', { id: crypto.randomUUID(), userId: pid, title: 'Old', body: 'old news', read: false, link: '', createdAt: daysAgo(60) });
  await (await import('../src/db.js')).catchUp();
  assert.equal(db.byId('bookings', t1.id), undefined, 'cold rows are not pulled into memory by catch-up');

  // History and totals include them
  const mine = (await call('GET', '/bookings', { token: p.token })).data.bookings;
  assert.deepEqual(mine.map((b) => b.id).sort(), [t1.id, t2.id].sort());
  let dash = (await call('GET', '/dashboard', { token: p.token })).data;
  assert.equal(stat(dash, 'Trips taken'), 2);
  assert.equal(stat(dash, 'Spent with DROP'), 150);
  dash = (await call('GET', '/dashboard', { token: d.token })).data;
  assert.equal(stat(dash, 'Your earnings'), 135);
  const adminList = (await call('GET', `/admin/bookings?q=${t2.ref.toLowerCase()}`, { token: admin })).data.bookings;
  assert.deepEqual(adminList.map((b) => b.id), [t2.id], 'staff search reaches old trips');

  // A receipt link for an old trip faults it back into memory; it is then a normal record
  assert.equal((await call('GET', `/bookings/${t1.id}`, { token: p.token })).status, 200);
  assert.ok(db.byId('bookings', t1.id));
  // Rating a new trip averages over all of the driver's trips, old ones included
  const nb = db.insert('bookings', oldTrip({ userId: pid, driverId: did, createdAt: daysAgo(1), completedAt: daysAgo(1), updatedAt: daysAgo(1) }));
  assert.equal((await call('POST', `/bookings/${nb.id}/rate`, { token: p.token, body: { rating: 4 } })).status, 200);
  assert.equal(db.byId('users', did).rating, 4);

  // Eviction: old finished trips leave memory; anything money jobs still need stays
  const settled = db.insert('bookings', oldTrip({ userId: pid, driverId: did }));
  const unsettled = db.insert('bookings', oldTrip({ userId: pid, driverId: did, settledAt: undefined }));
  const refunding = db.insert('bookings', oldTrip({ userId: pid, status: 'cancelled', paymentStatus: 'refund_pending' }));
  await db.flush();
  db.evictCold();
  assert.equal(db.byId('bookings', settled.id), undefined);
  assert.ok(db.byId('bookings', unsettled.id), 'unsettled trip stays for the reconciler');
  assert.ok(db.byId('bookings', refunding.id), 'pending refund stays');
  assert.equal(db.byId('bookings', nb.id)?.id, nb.id, 'recently updated trip stays');
  assert.equal((await call('GET', '/bookings', { token: p.token })).data.bookings.length, 6, 'evicted trips are still listed');

  // Old notifications: listed, and "mark all read" reaches them
  let n = (await call('GET', '/notifications', { token: p.token })).data;
  assert.ok(n.notifications.find((x) => x.title === 'Old' && !x.read));
  await call('POST', '/notifications/read', { token: p.token });
  n = (await call('GET', '/notifications', { token: p.token })).data;
  assert.equal(n.unread, 0);

  // Account deletion anonymises old chat too
  assert.equal((await call('POST', '/auth/delete-account', { token: p.token, body: { password: 'Passw0rd!', confirm: 'DELETE' } })).status, 200);
  const [m] = await db.sql(`select data->>'senderName' name from drop_docs where collection = 'messages' and data->>'senderId' = $1`, [pid]);
  assert.equal(m.name, 'Deleted user');

  const h = await db.health();
  assert.equal(h.hotDays, 14);
  assert.ok(Number.isFinite(h.inMemory.bookings));
});
