import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { makeClient, verifiedPassenger, day } from './helpers.js';

/* ---- Stand-in Paystack ---- */
const charges = new Map();
const refunds = [];
const paystack = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/transaction/initialize') {
      const b = JSON.parse(body);
      charges.set(b.reference, { amount: b.amount, currency: b.currency || 'ZAR', status: 'success', reference: b.reference, channel: 'card', authorization: { last4: '4081' } });
      return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } }));
    }
    const m = /^\/transaction\/verify\/(.+)$/.exec(req.url);
    if (m) return res.end(JSON.stringify({ status: true, data: charges.get(decodeURIComponent(m[1])) }));
    if (req.method === 'POST' && req.url === '/refund') { refunds.push(JSON.parse(body)); return res.end(JSON.stringify({ status: true, data: { status: 'pending' } })); }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => paystack.listen(0, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-travel-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  PAYSTACK_SECRET_KEY: 'sk_test_drop', PAYSTACK_BASE_URL: `http://127.0.0.1:${paystack.address().port}`, DISPATCH_REFRESH_MS: '0', TRAVEL_USD_ZAR: '18.5',
});
const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { balance, trialBalance } = await import('../src/money/ledger.js');
const { runTravelJobs } = await import('../src/travelJobs.js');
let server, base, admin, pat;
const call = makeClient(() => base);
before(async () => {
  await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  pat = await verifiedPassenger(call, admin, 'traveller@example.com');
});
after(async () => { server.closeAllConnections(); server.close(); paystack.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const DAY = 86_400_000;
let routeSeq = 0;
async function setupRoute(over = {}) {
  const p = await call('POST', '/admin/travel/partners', { token: admin, body: { name: `Coach Co ${++routeSeq}`, type: 'bus', contactEmail: 'ops@coach.test' } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const r = await call('POST', '/admin/travel/routes', { token: admin, body: { partnerId: p.data.partner.id, origin: `JNB${routeSeq}`, originName: 'Johannesburg', destination: `GBE${routeSeq}`, destinationName: 'Gaborone', international: true, capacity: 5, minimum: 3, bulkRate: 400, pricePerPerson: 500, deadlineDays: 3, depositPct: 30, ...over } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.route;
}
const traveller = (n, over = {}) => ({ fullName: `Traveller Number ${n}`, dateOfBirth: '1990-04-0' + ((n % 9) + 1), nationality: 'South African', passportNumber: `M${String(1000000 + n)}`, passportExpiry: day(1200), ...over });
const join = (route, dep, passengers, extra = {}) => call('POST', '/travel/join', { token: pat.token, body: { routeId: route.id, departureDate: dep, passengers, ...extra } });
async function pay(booking) {
  const co = await call('POST', `/payments/travel/${booking.id}/checkout`, { token: pat.token });
  assert.equal(co.status, 200, JSON.stringify(co.data));
  const v = await call('GET', `/payments/verify/${co.reference || co.data.reference}`, { token: pat.token });
  assert.equal(v.data.paid, true, JSON.stringify(v.data));
  return db.byId('groupBookings', booking.id);
}

test('search, join with passport, pay in full: seats, escrow and encrypted passport', async () => {
  const route = await setupRoute();
  const dep = day(30);
  const s = await call('GET', `/travel/search?type=bus&origin=Johannesburg&destination=Gaborone&departureDate=${dep}&travellers=2`);
  const hit = s.data.results.find((x) => x.route.id === route.id);
  assert.ok(hit.newGroup && !hit.group, 'a new group would open');
  assert.equal(hit.newGroup.pricePerPersonUsd, 27.03);

  const bad = await join(route, dep, [traveller(1, { passportNumber: '' })]);
  assert.equal(bad.status, 400, 'international routes need a passport');
  const minor = await join(route, dep, [traveller(2, { dateOfBirth: day(-3650) })]);
  assert.equal(minor.status, 400, 'under-18s need guardian consent');

  const j = await join(route, dep, [traveller(3), traveller(4)]);
  assert.equal(j.status, 201, JSON.stringify(j.data));
  assert.equal(j.data.booking.status, 'held');
  assert.equal(j.data.amounts.total, 1000);
  const pax = db.filter('groupPassengers', (p) => p.bookingId === j.data.booking.id);
  assert.equal(pax.length, 2);
  assert.ok(!JSON.stringify(pax).includes('M1000003'), 'passport number is stored encrypted');
  assert.ok(!JSON.stringify(j.data).includes('M1000003'), 'the customer API never returns the full passport number');

  const b = await pay(j.data.booking);
  assert.equal(b.status, 'paid');
  const g = db.byId('travelGroups', b.groupId);
  assert.equal(g.seatsTaken, 2);
  assert.equal(g.paidSeats, 2);
  assert.equal(balance(`travel_escrow:${g.id}`), 100000, 'R1 000 held in escrow');
  const tb = trialBalance(); assert.equal(tb.debits, tb.credits);
});

test('no overbooking: 8 people race for 5 seats, the rest go to an overflow group', async () => {
  const route = await setupRoute();
  const dep = day(40);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => join(route, dep, [traveller(10 + i)])));
  assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.data)));
  const groups = db.filter('travelGroups', (g) => g.routeId === route.id).sort((a, b) => a.sequence - b.sequence);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].seatsTaken, 5);
  assert.equal(groups[0].status, 'FULL');
  assert.equal(groups[1].seatsTaken, 3);
  assert.equal(groups[1].status, 'OPEN');
  const counts = groups.map((g) => db.filter('groupBookings', (b) => b.groupId === g.id).length);
  assert.deepEqual(counts, [5, 3], 'every booking points at the group whose seat it took');

  // A party of 6 can't fit a 5-seat group.
  const big = await join(route, dep, Array.from({ length: 6 }, (_, i) => traveller(30 + i)));
  assert.equal(big.status, 400);
});

test('unpaid holds expire and give the seats back', async () => {
  const route = await setupRoute();
  const dep = day(35);
  const j = await join(route, dep, [traveller(40), traveller(41)]);
  await runTravelJobs(Date.now() + 31 * 60_000);
  assert.equal(db.byId('groupBookings', j.data.booking.id).status, 'expired');
  assert.equal(db.byId('travelGroups', j.data.booking.group.id).seatsTaken, 0);
  const co = await call('POST', `/payments/travel/${j.data.booking.id}/checkout`, { token: pat.token });
  assert.equal(co.status, 400, 'an expired hold cannot be paid');
});

test('group below its minimum at the deadline is cancelled and everyone is refunded in full', async () => {
  const route = await setupRoute();
  const dep = day(20);
  const j = await join(route, dep, [traveller(50)], { paymentOption: 'deposit' });
  assert.equal(j.data.amounts.dueNow, 150, '30% deposit');
  const b = await pay(j.data.booking);
  assert.equal(b.status, 'deposit_paid');
  const before = refunds.length;
  await runTravelJobs(Date.parse(db.byId('travelGroups', b.groupId).deadline) + 60_000);
  const g = db.byId('travelGroups', b.groupId);
  assert.equal(g.status, 'CANCELLED');
  const after = db.byId('groupBookings', b.id);
  assert.equal(after.status, 'refunded');
  assert.equal(after.refundedCents, 15000);
  assert.equal(refunds.length, before + 1);
  assert.equal(balance(`travel_escrow:${g.id}`), 0);
});

test('transfer policy: customer moves to another date instead of a refund', async () => {
  const route = await setupRoute({ failurePolicy: 'transfer' });
  const dep = day(20);
  const j = await join(route, dep, [traveller(60)]);
  const b = await pay(j.data.booking);
  const other = await call('POST', '/admin/travel/groups', { token: admin, body: { routeId: route.id, departureDate: day(25) } });
  assert.equal(other.status, 201, JSON.stringify(other.data));
  await runTravelJobs(Date.parse(db.byId('travelGroups', b.groupId).deadline) + 60_000);
  assert.equal(db.byId('groupBookings', b.id).status, 'transfer_offered');
  const view = await call('GET', `/travel/my/${b.id}`, { token: pat.token });
  assert.ok(view.data.alternatives.some((a) => a.id === other.data.group.id));
  const t = await call('POST', `/travel/my/${b.id}/transfer`, { token: pat.token, body: { groupId: other.data.group.id } });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(db.byId('groupBookings', b.id).groupId, other.data.group.id);
  assert.equal(balance(`travel_escrow:${other.data.group.id}`), 50000, 'the money moved with the customer');
  assert.equal(db.byId('travelGroups', other.data.group.id).paidSeats, 1);
});

test('confirm with partner, manifest (staff only, audited), tickets, cancellation fee', async () => {
  const route = await setupRoute({ capacity: 4, minimum: 2 });
  const dep = day(20);
  const j1 = await join(route, dep, [traveller(70), traveller(71)]);
  const b1 = await pay(j1.data.booking);
  const j2 = await join(route, dep, [traveller(72)]);
  const b2 = await pay(j2.data.booking);
  const gid = b1.groupId;
  assert.equal(db.byId('travelGroups', gid).status, 'MINIMUM_REACHED');

  // Before the deadline a cancellation is free.
  const c = await call('POST', `/travel/my/${b2.id}/cancel`, { token: pat.token });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(db.byId('groupBookings', b2.id).refundedCents, 50000);
  assert.equal(db.byId('travelGroups', gid).seatsTaken, 2);

  const conf = await call('POST', `/admin/travel/groups/${gid}/confirm`, { token: admin, body: { partnerReference: 'CC-778812' } });
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  const g = db.byId('travelGroups', gid);
  assert.equal(g.status, 'CONFIRMED_WITH_PARTNER');
  assert.equal(g.partnerCents, 80000);
  assert.equal(g.marginCents, 20000);
  assert.equal(balance(`travel_escrow:${gid}`), 0);
  assert.equal(balance(`partner_payable:${route.partnerId}`), 80000);

  const denied = await call('GET', `/admin/travel/groups/${gid}/manifest.csv`, { token: pat.token });
  assert.equal(denied.status, 403);
  const res = await fetch(`${base}/admin/travel/groups/${gid}/manifest.csv`, { headers: { authorization: `Bearer ${admin}` } });
  const csv = await res.text();
  assert.ok(csv.includes('M1000070') && csv.includes('M1000071'), 'the manifest has the full passport numbers');
  assert.ok(!csv.includes('M1000072'), 'cancelled travellers are left off');
  assert.ok(db.all('audit').some((a) => a.action === 'travel.manifest_exported' && a.subjectId === gid));

  const payout = await call('POST', `/admin/travel/groups/${gid}/payout`, { token: admin, body: { amount: 800, kind: 'balance', reference: 'EFT-9921' } });
  assert.equal(payout.status, 201, JSON.stringify(payout.data));
  assert.equal(balance(`partner_payable:${route.partnerId}`), 0);

  const pax = db.filter('groupPassengers', (p) => p.bookingId === b1.id);
  const t = await call('POST', `/admin/travel/groups/${gid}/tickets`, { token: admin, body: { tickets: pax.map((p, i) => ({ passengerId: p.id, ticketNumber: `TK-${i}00`, seat: `${i + 1}A` })) } });
  assert.equal(t.data.ticketed, true);
  assert.equal(db.byId('travelGroups', gid).status, 'TICKETED');
  assert.equal(db.byId('groupBookings', b1.id).status, 'ticketed');

  const late = await call('POST', `/travel/my/${b1.id}/cancel`, { token: pat.token });
  assert.equal(late.status, 200, JSON.stringify(late.data));
  assert.equal(db.byId('groupBookings', b1.id).refundedCents || 0, 0, 'no refund once ticketed (100% fee)');

  await runTravelJobs(Date.parse(`${dep}T23:59:59+02:00`) + 2 * DAY);
  const rep = await call('GET', '/admin/travel/reports?by=partner', { token: admin });
  assert.ok(rep.data.rows.length >= 1);
  const tb = trialBalance(); assert.equal(tb.debits, tb.credits);
});

test('a partner balance payment cannot exceed what the group owes', async () => {
  const route = await setupRoute({ capacity: 2, minimum: 1 });
  const j = await join(route, day(20), [traveller(90)]);
  const b = await pay(j.data.booking);
  await call('POST', `/admin/travel/groups/${b.groupId}/confirm`, { token: admin, body: { partnerReference: 'CC-1' } });
  const ok = await call('POST', `/admin/travel/groups/${b.groupId}/payout`, { token: admin, body: { amount: 300, kind: 'balance', reference: 'EFT-1' } });
  assert.equal(ok.status, 201);
  const over = await call('POST', `/admin/travel/groups/${b.groupId}/payout`, { token: admin, body: { amount: 200, kind: 'balance', reference: 'EFT-2' } });
  assert.equal(over.status, 400, 'only R100 is still owed');
});
