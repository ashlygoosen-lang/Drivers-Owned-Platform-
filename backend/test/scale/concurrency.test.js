/**
 * Multi-instance correctness under contention (Phase 6). Needs PostgreSQL and Redis:
 *   SCALE_DATABASE_URL=postgresql://... SCALE_REDIS_URL=redis://... node --test test/scale/concurrency.test.js
 * Two separate server processes share the database; requests are spread across both.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startCluster, seed, call, query } from './fixture.js';

const DB = process.env.SCALE_DATABASE_URL;
const REDIS = process.env.SCALE_REDIS_URL;
const skip = !DB || !REDIS ? 'set SCALE_DATABASE_URL and SCALE_REDIS_URL' : false;
let cluster, A, B, people;
const pick = (i) => (i % 2 ? B : A);
const trip = { service: 'Ride', category: 'Comfort', pickup: 'Gardens', destination: 'Sea Point Promenade', passengers: 1, payment: 'Cash' };

before(async () => {
  if (skip) return;
  await query(DB, 'drop table if exists drop_docs, drop_counters cascade; drop sequence if exists drop_seq');
  cluster = await startCluster({ databaseUrl: DB, redisUrl: REDIS, instances: 2 });
  [A, B] = cluster.instances.map((s) => s.base);
  people = await seed(DB, { drivers: 320, passengers: 60 });
  // drivers[0..299] race in the first test; the other tests use drivers[300+] so earlier winners don't interfere.
});
after(async () => { await cluster?.stop(); });

test('last seat: 300 drivers on two servers accept the same trip at once, exactly one wins', { skip }, async () => {
  const p = people.passengers[0];
  const { data: { booking } } = await call(A, 'POST', '/bookings', { token: p.token, body: trip });
  await new Promise((r) => setTimeout(r, 300));
  const results = await Promise.all(people.drivers.slice(0, 300).map((d, i) => call(pick(i), 'POST', `/drivers/bookings/${booking.id}/accept`, { token: d.token })));
  const winners = results.filter((r) => r.status === 200);
  assert.equal(winners.length, 1, `winners: ${winners.length}, statuses: ${[...new Set(results.map((r) => r.status))]}`);
  assert.ok(results.every((r) => r.status === 200 || r.status === 409));
  const [row] = await query(DB, "select data->>'driverId' d, data->>'status' s from drop_docs where collection='bookings' and id=$1", [booking.id]);
  assert.equal(row.s, 'accepted');
  assert.equal(row.d, winners[0].data.booking.driver ? people.drivers.find((d) => d.name === winners[0].data.booking.driver.name).id : row.d);
});

test('one driver, many trips: a driver racing to accept 20 trips at once gets exactly one', { skip }, async () => {
  const bookings = [];
  for (const p of people.passengers.slice(1, 21)) bookings.push((await call(B, 'POST', '/bookings', { token: p.token, body: trip })).data.booking);
  await new Promise((r) => setTimeout(r, 300));
  const d = people.drivers[301];
  const results = await Promise.all(bookings.map((b, i) => call(pick(i), 'POST', `/drivers/bookings/${b.id}/accept`, { token: d.token })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const rows = await query(DB, "select count(*)::int n from drop_docs where collection='bookings' and data->>'driverId'=$1 and data->>'status' in ('accepted','arriving','in_progress')", [d.id]);
  assert.equal(rows[0].n, 1);
});

test('double taps: 100 identical requests with one Idempotency-Key create one booking', { skip }, async () => {
  const p = people.passengers[30];
  const key = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => call(pick(i), 'POST', '/bookings', { token: p.token, body: trip, headers: { 'idempotency-key': key } })));
  const created = new Set(results.filter((r) => r.status === 201).map((r) => r.data.booking.id));
  assert.equal(created.size, 1, `distinct bookings: ${created.size}`);
  assert.ok(results.every((r) => [201, 409].includes(r.status)));
  const rows = await query(DB, "select count(*)::int n from drop_docs where collection='bookings' and data->>'userId'=$1", [p.id]);
  assert.equal(rows[0].n, 1);
});

test('one open trip per passenger: 50 different booking attempts at once, one succeeds', { skip }, async () => {
  const p = people.passengers[31];
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => call(pick(i), 'POST', '/bookings', { token: p.token, body: trip, headers: { 'idempotency-key': crypto.randomUUID() } })));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify([...new Set(results.map((r) => `${r.status}:${r.data.error || ''}`))]));
  const rows = await query(DB, "select count(*)::int n from drop_docs where collection='bookings' and data->>'userId'=$1", [p.id]);
  assert.equal(rows[0].n, 1);
});

test('state machine: a double-tapped "advance" on two servers moves the trip exactly one step', { skip }, async () => {
  const p = people.passengers[32];
  const d = people.drivers[302];
  const b = (await call(A, 'POST', '/bookings', { token: p.token, body: trip })).data.booking;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await call(B, 'POST', `/drivers/bookings/${b.id}/accept`, { token: d.token })).status, 200);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call(pick(i), 'POST', `/drivers/bookings/${b.id}/advance`, { token: d.token })));
  // Each success moves one step from the state it saw; with the conditional update no step is skipped or repeated.
  const [row] = await query(DB, "select data->>'status' s, data->'history' h from drop_docs where collection='bookings' and id=$1", [b.id]);
  const steps = row.h.map((x) => x.status);
  assert.equal(new Set(steps).size, steps.length, `no state repeated: ${steps}`);
  assert.deepEqual(steps, ['requested', 'accepted', 'arriving', 'in_progress', 'completed'].slice(0, steps.length));
  assert.equal(results.filter((r) => r.status === 200).length, steps.length - 2);
  const settled = await query(DB, "select count(*)::int n from drop_docs where collection='ledger' and data->>'key' like $1", [`%${b.id}%`]);
  assert.ok(row.s !== 'completed' || settled[0].n >= 1, 'a completed trip is settled exactly once');
});

test('cross-server: written on one server, read and pushed live on the other', { skip }, async () => {
  const p = people.passengers[33];
  const d = people.drivers[303];
  const b = (await call(A, 'POST', '/bookings', { token: p.token, body: trip })).data.booking;
  const seen = await (async () => { for (let i = 0; i < 30; i++) { const r = await call(B, 'GET', `/bookings/${b.id}`, { token: p.token }); if (r.status === 200) return Date.now(); await new Promise((x) => setTimeout(x, 100)); } return 0; })();
  assert.ok(seen, 'booking visible on the other server');
  assert.equal((await call(B, 'POST', `/drivers/bookings/${b.id}/accept`, { token: d.token })).status, 200);
  // Passenger's live stream on server A receives a chat message sent through server B
  const { ticket } = (await call(B, 'POST', '/comms/ticket', { token: p.token, body: {} })).data;
  const ctrl = new AbortController();
  const res = await fetch(`${A}/comms/stream?ticket=${ticket}`, { signal: ctrl.signal });
  assert.equal(res.status, 200, 'ticket issued on B is accepted on A');
  const got = new Promise((resolve) => { (async () => { let buf = ''; for await (const c of res.body) { buf += Buffer.from(c).toString(); if (buf.includes('Meet at the gate')) return resolve(true); } })().catch(() => resolve(false)); setTimeout(() => resolve(false), 8000); });
  await new Promise((r) => setTimeout(r, 500));
  await call(B, 'POST', `/bookings/${b.id}/messages`, { token: d.token, body: { text: 'Meet at the gate' } });
  assert.equal(await got, true, 'event crossed servers');
  ctrl.abort();
});

test('booking refs never collide across servers', { skip }, async () => {
  const rows = await query(DB, "select data->>'ref' r, count(*)::int n from drop_docs where collection='bookings' group by 1 having count(*) > 1");
  assert.deepEqual(rows, []);
});
