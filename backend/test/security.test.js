import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { makeClient, verifiedPassenger } from './helpers.js';

/* Stand-in for the Have I Been Pwned range API: "Password1" is breached. */
const breached = crypto.createHash('sha1').update('Password1').digest('hex').toUpperCase();
const pwned = http.createServer((req, res) => {
  const prefix = req.url.split('/').pop();
  res.end(prefix === breached.slice(0, 5) ? `${breached.slice(5)}:52579\r\n0018A45C4D1DEF81644B54AB7F969B88D65:3` : '0018A45C4D1DEF81644B54AB7F969B88D65:3');
});
await new Promise((r) => pwned.listen(0, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-sec-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k',
  STAFF_MFA: 'required', PWNED_CHECK: 'on', PWNED_API_BASE: `http://127.0.0.1:${pwned.address().port}`, BANK_CHANGE_HOLD_HOURS: '24',
});
delete process.env.DEMO_MODE;

const { createApp, seedAdmin } = await import('../src/app.js');
const { seedDemo } = await import('../src/demo.js');
const { db } = await import('../src/db.js');
const { totp } = await import('../src/security.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); await seedDemo(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); pwned.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const login = (email, password) => call('POST', '/auth/login', { body: { email, password } });

/** Admin sign-in through the mandatory authenticator step. */
async function adminToken() {
  let r = await login('admin@drop.test', 'AdminPass123');
  if (r.data.token) return r.data.token;
  if (r.data.mfa === 'setup') {
    const s = await call('POST', '/auth/mfa/setup', { body: { mfaToken: r.data.mfaToken } });
    const c = await call('POST', '/auth/mfa/confirm', { body: { mfaToken: r.data.mfaToken, code: totp(s.data.secret) } });
    return c.data.token;
  }
  const u = db.find('users', (x) => x.email === 'admin@drop.test');
  const { decryptText } = await import('../src/kyc.js');
  const secret = decryptText(u.mfa.secretEnc);
  u.mfa.lastStep = -1; // test only: allow another sign-in within the same 30-second window
  r = await call('POST', '/auth/mfa/verify', { body: { mfaToken: r.data.mfaToken, code: totp(secret) } });
  return r.data.token;
}

test('SEC-003: staff must set up and use an authenticator app', async () => {
  const r = await login('admin@drop.test', 'AdminPass123');
  assert.equal(r.data.mfa, 'setup');
  assert.equal(r.data.token, undefined, 'no session before the second step');
  // The step token is not a session
  assert.equal((await call('GET', '/auth/me', { token: r.data.mfaToken })).status, 401);
  const s = await call('POST', '/auth/mfa/setup', { body: { mfaToken: r.data.mfaToken } });
  assert.match(s.data.otpauthUrl, /^otpauth:\/\/totp\/DROP/);
  assert.match(s.data.qrSvg, /^<svg/);
  assert.equal((await call('POST', '/auth/mfa/confirm', { body: { mfaToken: r.data.mfaToken, code: '000000' } })).status, 400);
  const c = await call('POST', '/auth/mfa/confirm', { body: { mfaToken: r.data.mfaToken, code: totp(s.data.secret) } });
  assert.equal(c.data.recoveryCodes.length, 8);
  assert.ok(c.data.token);
  assert.equal(c.data.user.mfaEnabled, true);
  assert.equal(c.data.user.mfa, undefined, 'secret never leaves the server');

  // Next sign-in asks for a code; a reused code is refused; a recovery code works once
  const again = await login('admin@drop.test', 'AdminPass123');
  assert.equal(again.data.mfa, 'verify');
  assert.equal((await call('POST', '/auth/mfa/verify', { body: { mfaToken: again.data.mfaToken, code: totp(s.data.secret) } })).status, 400, 'replay refused');
  const rec = await call('POST', '/auth/mfa/verify', { body: { mfaToken: again.data.mfaToken, recoveryCode: c.data.recoveryCodes[0] } });
  assert.ok(rec.data.token);
  assert.equal(rec.data.recoveryCodesLeft, 7);
  assert.equal((await call('POST', '/auth/mfa/verify', { body: { mfaToken: again.data.mfaToken, recoveryCode: c.data.recoveryCodes[0] } })).status, 400, 'recovery codes are single-use');
  assert.equal((await call('POST', '/auth/mfa/disable', { token: rec.data.token, body: { password: 'AdminPass123' } })).status, 403, 'staff cannot switch it off');
});

test('SEC-001: demo staff dashboards lock as soon as real customers exist; demo and real trips never mix', async () => {
  assert.equal((await call('GET', '/auth/demo')).data.accounts.length, 7);
  const demoAdmin = (await call('POST', '/auth/demo', { body: { role: 'admin' } })).data.token;
  assert.equal((await call('GET', '/admin/users', { token: demoAdmin })).status, 200);

  // First real customer signs up
  const admin = await adminToken();
  const real = await verifiedPassenger(call, admin, 'real.person@example.com', '930303');
  assert.equal((await call('GET', '/admin/users', { token: demoAdmin })).status, 401, 'existing demo admin session ends');
  assert.equal((await call('POST', '/auth/demo', { body: { role: 'admin' } })).status, 404);
  assert.equal((await call('POST', '/auth/demo', { body: { role: 'passenger' } })).status, 404, 'demo switches itself off by default');
  assert.deepEqual((await call('GET', '/auth/demo')).data.accounts, []);

  // Explicit DEMO_MODE=true keeps customer demos, never staff demos, and isolates trips
  process.env.DEMO_MODE = 'true';
  try {
    assert.deepEqual((await call('GET', '/auth/demo')).data.accounts.map((a) => a.role), ['passenger', 'driver', 'business']);
    assert.equal((await call('POST', '/auth/demo', { body: { role: 'finance' } })).status, 404);
    const demoDriver = (await call('POST', '/auth/demo', { body: { role: 'driver' } })).data.token;
    const b = (await call('POST', '/bookings', { token: real.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Gardens', destination: 'Sea Point Promenade', passengers: 1, payment: 'Cash' } })).data.booking;
    const reqs = (await call('GET', '/drivers/requests', { token: demoDriver })).data.requests;
    assert.ok(!reqs.some((x) => x.id === b.id), 'demo driver cannot see a real request');
    assert.equal((await call('GET', `/bookings/${b.ref}`, { token: demoDriver })).status, 404);
    assert.equal((await call('POST', `/drivers/bookings/${b.id}/accept`, { token: demoDriver })).status, 409, 'demo driver cannot take a real trip');
  } finally { delete process.env.DEMO_MODE; }
});

test('SEC-002/004: sessions are revocable; account lockout; breached passwords refused; no secret fields leak', async () => {
  // Breached password refused at sign-up
  const weak = await call('POST', '/auth/register', { body: { name: 'Bree Ched', email: 'bree@example.com', password: 'Password1' } });
  assert.equal(weak.status, 400);
  assert.match(weak.data.error, /data breaches/);

  const reg = await call('POST', '/auth/register', { body: { name: 'Sam Safe', email: 'sam@example.com', password: 'Tr1cky-Horse-Battery' } });
  const t1 = reg.data.token;
  const t2 = (await login('sam@example.com', 'Tr1cky-Horse-Battery')).data.token;
  assert.equal((await call('GET', '/auth/me', { token: t2 })).status, 200);

  // Password change signs out other devices and returns a fresh token for this one
  const ch = await call('PATCH', '/auth/me', { token: t1, body: { currentPassword: 'Tr1cky-Horse-Battery', newPassword: 'N3w-Horse-Battery' } });
  assert.ok(ch.data.token);
  assert.equal((await call('GET', '/auth/me', { token: t2 })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: t1 })).status, 401);
  assert.equal((await call('GET', '/auth/me', { token: ch.data.token })).status, 200);
  await call('POST', '/auth/logout-all', { token: ch.data.token });
  assert.equal((await call('GET', '/auth/me', { token: ch.data.token })).status, 401, 'sign out everywhere');

  // Lockout after 5 wrong passwords, even with the right one afterwards; unknown emails behave the same
  for (let i = 0; i < 5; i++) assert.equal((await login('sam@example.com', 'wrong-pass-1')).status, 401);
  const locked = await login('sam@example.com', 'N3w-Horse-Battery');
  assert.equal(locked.status, 429);
  for (let i = 0; i < 5; i++) await login('nobody@example.com', 'wrong-pass-1');
  assert.equal((await login('nobody@example.com', 'wrong-pass-1')).status, 429, 'no difference between real and unknown emails');

  // Admin views of users never include password hashes, MFA secrets or encrypted bank numbers
  const admin = await adminToken();
  const users = (await call('GET', '/admin/users', { token: admin })).data.users;
  const leak = JSON.stringify(users);
  assert.ok(!/passwordHash|secretEnc|accountEnc|tokenVersion/.test(leak));
});

test('SEC-006: bank account change needs the password and holds withdrawals', async () => {
  const admin = await adminToken();
  const { verifiedDriver } = await import('./helpers.js');
  const d = await verifiedDriver(call, admin, 'dee@example.com', '870707');
  const acct = { holder: 'Dee Driver', bank: 'FNB', branchCode: '250655', accountNumber: '62000012345', accountType: 'Cheque' };
  assert.equal((await call('PUT', '/wallet/bank-account', { token: d.token, body: acct })).status, 400, 'password required');
  assert.equal((await call('PUT', '/wallet/bank-account', { token: d.token, body: { ...acct, currentPassword: 'Driver123' } })).data.bankAccount.holdUntil, null, 'first account: no hold');
  const changed = await call('PUT', '/wallet/bank-account', { token: d.token, body: { ...acct, accountNumber: '99999912345', currentPassword: 'Driver123' } });
  assert.ok(changed.data.bankAccount.holdUntil);
  const { post, walletAccount, cents } = await import('../src/money/ledger.js');
  post({ type: 'test.credit', key: 'test:credit', memo: 'test', lines: [{ account: 'pool', dr: cents(500) }, { account: walletAccount(d.id), cr: cents(500) }] });
  const w = await call('POST', '/wallet/withdrawals', { token: d.token, body: { amount: 200 } });
  assert.equal(w.status, 400);
  assert.match(w.data.error, /newly changed bank account/);
  assert.ok(db.find('audit', (a) => a.action === 'bank_account_changed'));
});

test('SEC-005: malformed uploads are rejected without crashing the server', async () => {
  const p = (await call('POST', '/auth/register', { body: { name: 'Up Loader', email: 'up@example.com', password: 'Up-Loader-2026' } })).data.token;
  const bad = await fetch(`${base}/verification/documents`, { method: 'POST', headers: { authorization: `Bearer ${p}`, 'content-type': 'multipart/form-data; boundary=x' }, body: '--x\r\nContent-Disposition: form-data; name=""\r\n\r\nzz\r\n--x--' });
  assert.ok(bad.status >= 400 && bad.status < 500);
  assert.equal((await call('GET', '/health')).status, 200, 'server still up');
});
