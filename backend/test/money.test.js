import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

/* ---- Stand-in Paystack API (the real one is api.paystack.co) ---- */
const charges = new Map();
const refunds = [];
const paystack = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer sk_test_drop') { res.statusCode = 401; return res.end(JSON.stringify({ status: false, message: 'Invalid key' })); }
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-money-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'),
  FILE_ENCRYPTION_KEY: 'k', PAYSTACK_SECRET_KEY: 'sk_test_drop', PAYSTACK_BASE_URL: `http://127.0.0.1:${paystack.address().port}`,
  PAYMENTOLOGY_MODE: 'sandbox', PAYMENTOLOGY_TERMINAL_ID: '0068766621', PAYMENTOLOGY_TERMINAL_PASSWORD: 'terminal-secret', CARD_MAX_TRANSACTION: '2000',
});

const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { trialBalance } = await import('../src/money/ledger.js');
const { buildCall, buildKlv, xmlDate, parseResponse } = await import('../src/money/paymentology/xmlrpc.js');

let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.close(); paystack.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** Build a Remote API call exactly as Paymentology would, signed with the terminal password. */
function remote(method, args, { password = 'terminal-secret' } = {}) {
  const values = args.map((a) => a.value);
  const sig = crypto.createHmac('sha256', password).update(method + values.join('')).digest('hex').toUpperCase();
  return buildCall(method, [...args, { type: 'string', value: sig }]);
}
const S = (value) => ({ type: 'string', value: String(value) });
const I = (value) => ({ type: 'int', value });
const D = (value) => ({ type: 'dateTime.iso8601', value });
async function swipe(reference, amountCents, { mcc = '5541', merchant = 'ENGEN CAPE TOWN      ZA', txn = String(Math.random()).slice(2, 8), date = xmlDate(), password } = {}) {
  const xml = remote('Deduct', [S('0068766621'), S(reference), I(amountCents), S(merchant), S('00'), S(buildKlv({ '026': mcc, '250': 'EMV' })), S(txn), D(date)], { password });
  const r = await call('POST', '/paymentology/remote', { raw: xml, headers: { 'content-type': 'text/xml' } });
  return { ...parseResponse(r.text), txn, date };
}
const books = () => assert.ok(trialBalance().balanced, 'ledger must always balance');

test('passenger card payment → pool, trip completes → driver wallet, card spend, withdrawal', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'pat@example.com');
  const d = await verifiedDriver(call, admin, 'dee@example.com');

  // 1. Card booking waits for payment and is hidden from drivers until paid
  const b = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'Cape Town International Airport', passengers: 1, payment: 'Card' } })).data.booking;
  assert.equal(b.status, 'awaiting_payment');
  await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  assert.equal((await call('GET', '/drivers/requests', { token: d.token })).data.requests.length, 0);

  const co = await call('POST', `/payments/bookings/${b.id}/checkout`, { token: p.token });
  assert.match(co.data.authorizationUrl, /^https:\/\/checkout\.paystack\.test\//);
  const paid = await call('GET', `/payments/verify/${co.data.reference}`, { token: p.token });
  assert.equal(paid.data.booking.paymentStatus, 'paid');
  assert.equal(paid.data.booking.status, 'requested');
  const fin = async () => (await call('GET', '/finance/overview', { token: admin })).data;
  assert.equal((await fin()).pool, b.fare);
  assert.equal((await fin()).escrow, b.fare);
  books();

  // 2. Driver completes → earnings in wallet, fee to DROP, escrow released
  await call('POST', `/drivers/bookings/${b.id}/accept`, { token: d.token });
  for (let i = 0; i < 3; i++) await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token });
  let w = (await call('GET', '/wallet', { token: d.token })).data;
  assert.equal(w.balance, b.driverEarnings);
  assert.equal((await fin()).escrow, 0);
  assert.equal((await fin()).fees, b.driverServiceFee);
  books();

  // 3. Issue a card (Paymentology sandbox) linked to the wallet
  const card = (await call('POST', '/wallet/card', { token: d.token })).data.card;
  assert.equal(card.status, 'active');
  assert.match(card.maskedNumber, /\*\*\*\*/, 'only masked card numbers are stored');
  const ref = db.find('cards', (c) => c.id === card.id).reference;

  // 4. Remote API: signed Deduct calls against the wallet
  const balanceCents = Math.round(w.balance * 100);
  assert.equal((await swipe(ref, balanceCents + 100)).resultCode, -17, 'insufficient funds');
  assert.equal((await swipe(ref, 50000, { mcc: '7995' })).resultCode, -784, 'gambling blocked');
  assert.equal((await swipe(ref, 250000)).resultCode, -18, 'over per-transaction limit');
  assert.equal((await swipe(ref, 1000, { password: 'wrong' })).resultCode, -24, 'bad checksum rejected');
  const fuel = await swipe(ref, 15000);
  assert.equal(fuel.resultCode, 1);
  assert.equal(fuel.balanceAmount, balanceCents - 15000);
  const again = await swipe(ref, 15000, { txn: fuel.txn, date: fuel.date });
  assert.equal(again.resultCode, 1, 'retransmission answered');
  w = (await call('GET', '/wallet', { token: d.token })).data;
  assert.equal(Math.round(w.balance * 100), balanceCents - 15000, 'duplicate did not deduct twice');

  // Reversal of part of the purchase
  const rev = remote('DeductReversal', [S('0068766621'), S(ref), I(5000), S('ENGEN'), S(''), S(fuel.txn), D(fuel.date), S('999001'), D(xmlDate())]);
  assert.equal(parseResponse((await call('POST', '/paymentology/remote', { raw: rev, headers: { 'content-type': 'text/xml' } })).text).resultCode, 1);
  w = (await call('GET', '/wallet', { token: d.token })).data;
  assert.equal(Math.round(w.balance * 100), balanceCents - 10000);
  const bal = remote('Balance', [S('0068766621'), S(ref), S('ATM'), S(''), S('77'), D(xmlDate())]);
  assert.equal(parseResponse((await call('POST', '/paymentology/remote', { raw: bal, headers: { 'content-type': 'text/xml' } })).text).balanceAmount, balanceCents - 10000);
  books();

  // Freeze blocks spend; unfreeze restores
  await call('POST', '/wallet/card/freeze', { token: d.token });
  assert.equal((await swipe(ref, 100)).resultCode, -29);
  await call('POST', '/wallet/card/unfreeze', { token: d.token });
  assert.equal((await swipe(ref, 100)).resultCode, 1);
  const unsupported = remote('LoadAuth', [S('0068766621'), S(ref), I(100), S('x'), S(''), S('1'), D(xmlDate())]);
  assert.equal(parseResponse((await call('POST', '/paymentology/remote', { raw: unsupported, headers: { 'content-type': 'text/xml' } })).text).resultCode, -41);

  // 5. Withdrawal to bank → finance pays → pool reduced
  assert.equal((await call('POST', '/wallet/withdrawals', { token: d.token, body: { amount: 60 } })).status, 400, 'bank account needed');
  await call('PUT', '/wallet/bank-account', { token: d.token, body: { holder: 'Dee Driver', bank: 'FNB', branchCode: '250655', accountNumber: '62000012345', accountType: 'Cheque', currentPassword: 'Driver123' } });
  w = (await call('GET', '/wallet', { token: d.token })).data;
  assert.equal(w.bankAccount.masked, '•••• 2345');
  assert.ok(!JSON.stringify(db.find('users', (u) => u.id === d.id)).includes('62000012345'), 'account number encrypted at rest');
  const before = Math.round(w.balance * 100);
  const wd = await call('POST', '/wallet/withdrawals', { token: d.token, body: { amount: 50 } });
  assert.equal(wd.status, 201, JSON.stringify(wd.data));
  const csv = await call('GET', '/finance/withdrawals.csv', { token: admin });
  assert.match(csv.text, /62000012345/);
  assert.equal((await call('GET', '/finance/withdrawals.csv', { token: d.token })).status, 403);
  const poolBefore = (await fin()).pool;
  await call('POST', `/finance/withdrawals/${wd.data.withdrawal.id}/paid`, { token: admin, body: { bankReference: 'FNB-EFT-0001' } });
  assert.equal(Math.round((await fin()).pool * 100), Math.round(poolBefore * 100) - 5000);
  assert.equal(Math.round((await call('GET', '/wallet', { token: d.token })).data.balance * 100), before - 5000);
  books();

  // 6. Cash trip: driver keeps the cash, the service fee comes off the wallet
  const cash = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Sea Point Promenade', destination: 'Camps Bay', passengers: 1, payment: 'Cash' } })).data.booking;
  await call('POST', `/drivers/bookings/${cash.id}/accept`, { token: d.token });
  for (let i = 0; i < 3; i++) await call('POST', `/drivers/bookings/${cash.id}/advance`, { token: d.token });
  assert.equal(Math.round((await call('GET', '/wallet', { token: d.token })).data.balance * 100), before - 5000 - Math.round(cash.driverServiceFee * 100));
  books();

  // 7. Paid booking cancelled before pickup → refunded from the pool
  const b2 = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'XL', pickup: 'Gardens', destination: 'Woodstock', passengers: 2, payment: 'Card' } })).data.booking;
  const co2 = await call('POST', `/payments/bookings/${b2.id}/checkout`, { token: p.token });
  await call('GET', `/payments/verify/${co2.data.reference}`, { token: p.token });
  const escrowBefore = (await fin()).escrow;
  const cancelled = await call('POST', `/bookings/${b2.id}/cancel`, { token: p.token, body: {} });
  assert.equal(cancelled.data.booking.paymentStatus, 'refunded');
  assert.equal(refunds.length, 1);
  assert.equal(Math.round((await fin()).escrow * 100), Math.round(escrowBefore * 100) - Math.round(b2.fare * 100));
  books();

  // 8. Paystack webhook signature is enforced
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'x' } });
  assert.equal((await call('POST', '/payments/paystack/webhook', { raw: body, headers: { 'content-type': 'application/json', 'x-paystack-signature': 'bad' } })).status, 401);
  const sig = crypto.createHmac('sha512', 'sk_test_drop').update(body).digest('hex');
  assert.equal((await call('POST', '/payments/paystack/webhook', { raw: body, headers: { 'content-type': 'application/json', 'x-paystack-signature': sig } })).status, 200);

  // Finance staff role
  await call('POST', '/admin/staff', { token: admin, body: { name: 'Fin Officer', email: 'fin@drop.test', role: 'finance', password: 'Finance123' } });
  const f = (await call('POST', '/auth/login', { body: { email: 'fin@drop.test', password: 'Finance123' } })).data.token;
  assert.equal((await call('GET', '/finance/overview', { token: f })).status, 200);
  assert.equal((await call('GET', '/compliance/queue', { token: f })).status, 403, 'finance cannot see ID documents');
  assert.ok((await call('GET', '/dashboard', { token: f })).data.stats.length >= 4);
});
