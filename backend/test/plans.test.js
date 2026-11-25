import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { makeClient, verifiedPassenger, verifiedDriver, upload, day } from './helpers.js';

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
      charges.set(b.reference, { amount: b.amount, currency: b.currency, status: 'success', reference: b.reference, channel: 'card', authorization: { last4: '4081' } });
      return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } }));
    }
    const m = /^\/transaction\/verify\/(.+)$/.exec(req.url);
    if (m) return res.end(JSON.stringify({ status: true, data: charges.get(decodeURIComponent(m[1])) }));
    if (req.method === 'POST' && req.url === '/refund') { refunds.push(JSON.parse(body)); return res.end(JSON.stringify({ status: true, data: { status: 'pending' } })); }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => paystack.listen(0, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-plans-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  PAYSTACK_SECRET_KEY: 'sk_test_drop', PAYSTACK_BASE_URL: `http://127.0.0.1:${paystack.address().port}`, DISPATCH_REFRESH_MS: '0',
});
const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { balance, walletBalance, trialBalance } = await import('../src/money/ledger.js');
const { runPlanJobs } = await import('../src/planJobs.js');
const { sastTime, publicHolidays } = await import('../src/plans.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); paystack.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// Plans start on the 1st of next month (always in the future).
const now = new Date(Date.now() + 2 * 3_600_000);
const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const START = next.toISOString().slice(0, 10);
const scholarBody = (over = {}) => ({
  kind: 'scholar', category: 'Comfort', pickup: 'Sea Point Promenade', destination: 'Cape Town City Centre', school: 'City Primary',
  outTime: '06:45', returnTime: '14:30', days: [1, 2, 3, 4, 5], startDate: START,
  riders: [{ name: 'Thandi', grade: 'Grade 4', notes: 'Asthma pump in school bag' }, { name: 'Sipho', grade: 'Grade 1' }],
  guardian: { consent: true, relationship: 'Parent', emergencyName: 'Gogo Mbeki', emergencyPhone: '0821234000', handover: 'Hand over to a staff member at school' }, ...over,
});
async function vetDriver(admin, d) {
  for (const [type, o] of [['police_clearance', {}], ['child_protection_clearance', { expiresAt: day(300) }], ['learner_transport_licence', { expiresAt: day(300) }], ['roadworthy', { expiresAt: day(300) }]]) {
    const r = await upload(call, d.token, type, o);
    assert.ok(r.status < 300, `${type}: ${JSON.stringify(r.data)}`);
  }
  const file = (await call('GET', `/compliance/verifications/${d.id}`, { token: admin })).data.verification;
  for (const doc of file.documents.filter((x) => x.status === 'pending')) await call('POST', `/compliance/documents/${doc.id}/review`, { token: admin, body: { decision: 'approved' } });
  assert.equal(db.byId('users', d.id).driverStatus, 'approved', 'adding scholar documents never takes a driver offline');
}

test('public holidays follow the Public Holidays Act, including Sunday → Monday', () => {
  const h26 = publicHolidays(2026);
  for (const d of ['2026-04-03', '2026-04-06', '2026-08-10', '2026-12-16', '2026-12-25']) assert.ok(h26.has(d), d);
  assert.ok(publicHolidays(2027).has('2027-12-27'), 'Day of Goodwill on a Sunday moves to Monday');
});

test('scholar transport: consent, prepaid month, vetted drivers only, private details, daily trips, settlement, refund of unused days, renewal', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const parent = await verifiedPassenger(call, admin, 'parent@example.com');
  const plain = await verifiedDriver(call, admin, 'plain@example.com', '860101', '5009081');
  const vetted = await verifiedDriver(call, admin, 'vetted@example.com', '860202', '5009082');
  const other = await verifiedDriver(call, admin, 'other@example.com', '860303', '5009083');

  // Quote: 15% below on-demand fares, no trips on public holidays
  const qr = await call('POST', '/plans/quote', { token: parent.token, body: scholarBody({ riderCount: 2 }) });
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  const q = qr.data.pricing;
  assert.equal(q.discountRate, 0.15);
  assert.equal(q.trips, q.dates.length * 2);
  assert.ok(q.dates.every((d) => !publicHolidays(Number(d.slice(0, 4))).has(d)));
  assert.equal(q.total, Math.round(q.perDay * q.dates.length * 100) / 100);
  assert.ok(q.saving > 0);

  // Consent of the parent or guardian is required (POPIA s 35)
  const noConsent = await call('POST', '/plans', { token: parent.token, body: scholarBody({ guardian: { ...scholarBody().guardian, consent: false } }) });
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.data.error, /consent/);
  assert.equal((await call('POST', '/plans', { token: vetted.token, body: scholarBody() })).status, 403, 'drivers cannot book scholar plans');

  // Create → pay by card → waiting for a driver
  let plan = (await call('POST', '/plans', { token: parent.token, body: scholarBody() })).data.plan;
  assert.equal(plan.status, 'awaiting_payment');
  assert.equal(plan.guardian.consentVersion, 'scholar-2026-11');
  const co = (await call('POST', `/payments/plans/${plan.id}/checkout`, { token: parent.token, body: {} })).data;
  assert.equal(charges.get(co.reference).amount, Math.round(plan.pricing.total * 100));
  assert.equal((await call('GET', `/payments/verify/${co.reference}`, { token: parent.token })).data.paid, true);
  plan = (await call('GET', `/plans/${plan.id}`, { token: parent.token })).data.plan;
  assert.equal(plan.status, 'awaiting_driver');
  assert.equal(plan.paymentStatus, 'paid');
  assert.equal(balance('escrow'), Math.round(plan.pricing.total * 100), 'the month is held in escrow');

  // Drivers without child-protection vetting never see or take it
  let feed = (await call('GET', '/drivers/plans', { token: plain.token })).data;
  assert.equal(feed.eligibility.scholar, false);
  assert.ok(feed.eligibility.missing.includes('child_protection_clearance'));
  assert.equal(feed.offers.length, 0);
  assert.equal((await call('POST', `/drivers/plans/${plan.id}/accept`, { token: plain.token })).status, 403);

  await vetDriver(admin, vetted);
  await vetDriver(admin, other);
  feed = (await call('GET', '/drivers/plans', { token: vetted.token })).data;
  assert.equal(feed.eligibility.scholar, true, JSON.stringify(feed.eligibility));
  const offer = feed.offers.find((o) => o.id === plan.id);
  assert.ok(offer);
  assert.equal(offer.riders, undefined, 'learner names are hidden until accepted');
  assert.equal(offer.pickup, undefined, 'home address is hidden until accepted');
  assert.equal(offer.legs[0].from, undefined);
  assert.ok(offer.earnings > 0);

  assert.equal((await call('POST', `/drivers/plans/${plan.id}/accept`, { token: vetted.token })).status, 200);
  assert.equal((await call('POST', `/drivers/plans/${plan.id}/accept`, { token: other.token })).status, 409, 'one driver per plan');
  const asDriver = (await call('GET', `/plans/${plan.id}`, { token: vetted.token })).data.plan;
  assert.equal(asDriver.riders[0].name, 'Thandi');
  assert.equal(asDriver.guardian.emergencyPhone, '0821234000');
  assert.equal(asDriver.guardian.relationship, undefined, 'driver gets only what the trip needs');
  assert.ok(db.all('notifications').some((n) => n.userId === parent.id && /Driver confirmed/.test(n.title)));

  // Skip a day with notice (refunded at month end); same-day skips are refused
  const [d1, d2] = plan.pricing.dates;
  assert.equal((await call('POST', `/plans/${plan.id}/skip`, { token: parent.token, body: { date: d2 } })).data.plan.skipDates[0], d2);

  // Day 1: trips appear 45 minutes before departure, assigned to the plan driver, exactly once
  const t1 = sastTime(d1, '06:45') - 30 * 60_000;
  assert.equal((await runPlanJobs(t1)).made, 1);
  assert.equal((await runPlanJobs(t1)).made, 0, 'idempotent');
  const morning = db.find('bookings', (b) => b.planId === plan.id && b.planLeg === 'out');
  assert.equal(morning.status, 'accepted');
  assert.equal(morning.driverId, vetted.id);
  assert.equal(morning.payment, 'Card');
  assert.equal(morning.paymentStatus, 'paid');
  assert.equal(morning.fare, plan.pricing.perLeg[0].fare);
  assert.equal(morning.requiresScholarVetting, true);
  assert.match(morning.notes, /Hand over to a staff member/);
  // Driver completes it → paid from escrow to the driver's wallet
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', `/drivers/bookings/${morning.id}/advance`, { token: vetted.token })).status, 200);
  assert.equal(walletBalance(vetted.id), Math.round(morning.driverEarnings * 100));

  // Afternoon: the plan driver is busy on another trip → offered only to vetted drivers nearby
  const p2 = await verifiedPassenger(call, admin, 'rider2@example.com', '910202', '5009084');
  const ondemand = (await call('POST', '/bookings', { token: p2.token, body: { service: 'Ride', category: 'Comfort', pickup: 'V&A Waterfront', destination: 'Camps Bay', payment: 'Cash' } })).data.booking;
  assert.equal((await call('POST', `/drivers/bookings/${ondemand.id}/accept`, { token: vetted.token })).status, 200);
  assert.equal((await runPlanJobs(sastTime(d1, '14:30') - 20 * 60_000)).made, 1);
  const afternoon = db.find('bookings', (b) => b.planId === plan.id && b.planLeg === 'back');
  assert.equal(afternoon.status, 'requested');
  for (const d of [plain, other]) await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  const sees = async (d) => (await call('GET', '/drivers/requests', { token: d.token })).data.requests.some((r) => r.id === afternoon.id);
  assert.equal(await sees(plain), false, 'unvetted drivers are not shown learner trips');
  assert.equal(await sees(other), true);
  assert.equal((await call('POST', `/drivers/bookings/${afternoon.id}/accept`, { token: plain.token })).status, 403);
  // The parent cancels this trip before pickup: no refund now, it is included at month end
  assert.equal((await call('POST', `/bookings/${afternoon.id}/cancel`, { token: parent.token, body: {} })).status, 200);
  assert.equal(db.byId('bookings', afternoon.id).paymentStatus, 'plan_refund');
  assert.equal(refunds.length, 0);

  // Renewal from the 20th: next month's plan, same driver, waiting for payment
  const plan20 = Date.parse(`${START.slice(0, 8)}20T08:00:00+02:00`);
  assert.equal((await runPlanJobs(plan20)).renewed, 1);
  const renewed = db.find('plans', (p) => p.renewedFromId === plan.id);
  assert.equal(renewed.status, 'awaiting_payment');
  assert.equal(renewed.driverId, vetted.id);
  assert.equal(renewed.startDate.slice(8), '01');

  // Month end: everything paid but not driven goes back to the card, in one partial refund
  const end = Date.parse(`${plan.endDate}T23:00:00+02:00`) + 2 * 3_600_000;
  // finish the busy driver's on-demand trip first so nothing is in progress
  for (let i = 0; i < 3; i++) await call('POST', `/drivers/bookings/${ondemand.id}/advance`, { token: vetted.token });
  assert.equal((await runPlanJobs(end)).closed >= 1, true);
  const closed = db.byId('plans', plan.id);
  assert.equal(closed.status, 'completed');
  assert.equal(closed.usedAmount, morning.fare);
  assert.equal(closed.refundedAmount, Math.round((plan.pricing.total - morning.fare) * 100) / 100);
  assert.equal(refunds.at(-1).amount, Math.round(closed.refundedAmount * 100));
  assert.equal(balance('escrow'), 0, 'escrow nets to zero: paid = driven + refunded');
  assert.equal(trialBalance().balanced, true);
});

test('staff transport: business account, invoiced, cancellation takes effect after 24 hours', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const reg = await call('POST', '/auth/register', { body: { role: 'business', company: 'Acme Logistics', name: 'Ops Manager', email: 'ops@acme.example', password: 'Passw0rd!', phone: '+27821230000' } });
  const biz = reg.data.token;
  const passenger = await verifiedPassenger(call, admin, 'notbiz@example.com', '920101', '5009085');
  assert.equal((await call('POST', '/plans', { token: passenger.token, body: { ...scholarBody(), kind: 'staff' } })).status, 403, 'staff plans need a business account');

  const body = { kind: 'staff', category: 'XL', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', outTime: '07:00', returnTime: '17:00', days: [1, 2, 3, 4, 5], startDate: START,
    riders: [{ name: 'Ann' }, { name: 'Ben' }, { name: 'Cal' }, { name: 'Dee' }, { name: 'Eve' }] };
  // Business must be verified before booking (same gate as trips) — verify it
  const v = await call('PUT', '/verification/profile', { token: biz, body: { legalName: 'Ops Manager', idType: 'sa_id', idNumber: '8001015009087', nationality: 'South African', addressLine1: '1 Dock Rd', city: 'Cape Town', province: 'Western Cape', postalCode: '8001', companyName: 'Acme Logistics', registrationNumber: '2019/123456/07' } });
  assert.ok(v.status < 500);
  let created = await call('POST', '/plans', { token: biz, body });
  if (created.status === 403) {
    await upload(call, biz, 'id_document'); await upload(call, biz, 'proof_of_address', { issuedAt: day(-5) }); await upload(call, biz, 'company_registration');
    await call('POST', '/verification/submit', { token: biz, body: { consent: true } });
    const file = (await call('GET', `/compliance/verifications/${reg.data.user.id}`, { token: admin })).data.verification;
    for (const d of file.documents) await call('POST', `/compliance/documents/${d.id}/review`, { token: admin, body: { decision: 'approved' } });
    await call('POST', `/compliance/verifications/${reg.data.user.id}/decision`, { token: admin, body: { decision: 'approve' } });
    created = await call('POST', '/plans', { token: biz, body });
  }
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await call('POST', '/plans', { token: biz, body: { ...body, category: 'Comfort' } })).status, 400, 'five staff do not fit a Comfort car');
  const plan = created.data.plan;
  assert.equal(plan.status, 'awaiting_driver');
  assert.equal(plan.paymentStatus, 'invoice');

  const driver = await verifiedDriver(call, admin, 'shuttle@example.com', '870101', '5009086');
  const feed = (await call('GET', '/drivers/plans', { token: driver.token })).data;
  assert.ok(feed.offers.find((o) => o.id === plan.id), 'any approved driver can take staff transport');
  assert.equal((await call('POST', `/drivers/plans/${plan.id}/accept`, { token: driver.token })).status, 200);

  const cancelled = (await call('POST', `/plans/${plan.id}/cancel`, { token: biz, body: { reason: 'Office moving' } })).data.plan;
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(Date.parse(cancelled.cancelEffective) >= Date.parse(`${START}T00:00:00+02:00`));
  // No trips after the cancellation takes effect; the period closes without a card refund (invoiced)
  const first = plan.pricing.dates[0];
  assert.equal((await runPlanJobs(sastTime(first, '07:00') - 30 * 60_000)).made, Date.parse(cancelled.cancelEffective) > sastTime(first, '07:00') ? 1 : 0);
  const after = Date.parse(`${plan.endDate}T23:59:00+02:00`) + 3 * 3_600_000;
  for (const b of db.filter('bookings', (x) => x.planId === plan.id && ['accepted', 'arriving', 'in_progress'].includes(x.status))) for (let i = 0; i < 3; i++) await call('POST', `/drivers/bookings/${b.id}/advance`, { token: driver.token });
  await runPlanJobs(after);
  assert.ok(db.byId('plans', plan.id).closedAt);
  assert.equal(db.byId('plans', plan.id).refundedAmount, undefined);
});

test('dashboards and operations: KPIs, next pickup, statement, risk list, vetted reassignment, cancel on behalf', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const parent = (await call('POST', '/auth/login', { body: { email: 'parent@example.com', password: 'Passw0rd!' } })).data;
  const plain = (await call('POST', '/auth/login', { body: { email: 'plain@example.com', password: 'Driver123' } })).data;
  const other = (await call('POST', '/auth/login', { body: { email: 'other@example.com', password: 'Driver123' } })).data;

  let plan = (await call('POST', '/plans', { token: parent.token, body: scholarBody({ outTime: '07:10', returnTime: '15:00' }) })).data.plan;
  const co = (await call('POST', `/payments/plans/${plan.id}/checkout`, { token: parent.token, body: {} })).data;
  await call('GET', `/payments/verify/${co.reference}`, { token: parent.token });

  // Parent dashboard
  let dash = (await call('GET', '/plans/dashboard', { token: parent.token })).data;
  assert.equal(dash.kind, 'scholar');
  assert.ok(dash.kpis.awaitingDriver >= 1);
  const mine = dash.plans.find((p) => p.id === plan.id);
  assert.equal(mine.stats.tripsPlanned, mine.pricing.trips);
  assert.equal(mine.stats.next.date, mine.pricing.dates[0]);
  assert.equal(mine.stats.next.time, '07:10');
  assert.ok(Array.isArray(mine.stats.holidays));
  assert.equal(dash.nextUp.time >= '06:45', true);
  assert.equal((await call('GET', '/plans/dashboard', { token: other.token })).data.plans.length, 0, 'only your own plans');

  // Operations console: KPIs, search, candidates are vetted and clash-free
  const ops = (await call('GET', `/admin/plans?q=${plan.ref}`, { token: admin })).data;
  assert.deepEqual(ops.plans.map((p) => p.id), [plan.id]);
  assert.ok(ops.kpis.awaitingDriver >= 1);
  assert.ok(ops.kpis.escrowHeld >= plan.pricing.total);
  const cands = (await call('GET', `/admin/plans/${plan.id}/candidates`, { token: admin })).data.candidates;
  assert.ok(cands.some((c) => c.id === other.user.id));
  assert.equal(cands.some((c) => c.id === plain.user.id), false, 'unvetted drivers are never offered for scholar plans');
  assert.equal((await call('POST', `/admin/plans/${plan.id}/assign`, { token: admin, body: { driverId: plain.user.id, reason: 'try' } })).status, 400);
  assert.equal((await call('POST', `/admin/plans/${plan.id}/assign`, { token: admin, body: { driverId: other.user.id, reason: 'Matched by ops' } })).status, 200);
  assert.ok(db.all('audit').some((a) => a.action === 'plan.driver_assigned'));
  assert.ok(db.all('notifications').some((n) => n.userId === other.user.id && /assigned plan/.test(n.title)));
  dash = (await call('GET', '/plans/dashboard', { token: parent.token })).data;
  assert.equal(dash.plans.find((p) => p.id === plan.id).status, 'active');
  assert.equal(dash.plans.find((p) => p.id === plan.id).driver.name, 'Dee Driver');

  // Statement CSV
  const csv = await fetch(`${base}/plans/${plan.id}/statement.csv`, { headers: { authorization: `Bearer ${parent.token}` } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /^"Plan","Date","Trip","Booking","Status"/);
  assert.equal((await fetch(`${base}/plans/${plan.id}/statement.csv`, { headers: { authorization: `Bearer ${other.token}` } })).status, 404);
  const detail = (await call('GET', `/admin/plans/${plan.id}`, { token: admin })).data;
  assert.equal(detail.owner.email, 'parent@example.com');
  assert.equal((await call('GET', `/admin/plans/${plan.id}`, { token: parent.token })).status, 403);

  // Cancel on the customer's behalf (immediate, admin only)
  plan = (await call('POST', `/admin/plans/${plan.id}/cancel`, { token: admin, body: { reason: 'Family moved, phoned in', immediate: true } })).data.plan;
  assert.equal(plan.status, 'cancelled');
  assert.ok(Date.parse(plan.cancelEffective) <= Date.now());
  assert.ok(db.all('notifications').some((n) => n.userId === parent.user.id && /cancelled/.test(n.title)));
});
