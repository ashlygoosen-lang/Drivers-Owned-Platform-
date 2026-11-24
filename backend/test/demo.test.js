import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeClient } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-demo-'));
Object.assign(process.env, { DATA_DIR: dir, FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'true', PAYMENTOLOGY_MODE: 'sandbox' });

const { createApp } = await import('../src/app.js');
const { seedDemo } = await import('../src/demo.js');
const { db } = await import('../src/db.js');
const { trialBalance } = await import('../src/money/ledger.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await seedDemo(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.close(); await db.flush(); fs.rmSync(dir, { recursive: true, force: true }); });

test('demo logins open every dashboard with sample data', async () => {
  const list = await call('GET', '/auth/demo');
  assert.equal(list.data.enabled, true);
  assert.deepEqual(list.data.accounts.map((a) => a.role), ['passenger', 'driver', 'business', 'admin', 'compliance', 'support', 'finance']);
  assert.equal(await seedDemo(), false, 'seeding runs only once');

  const tokens = {};
  for (const { role } of list.data.accounts) {
    const r = await call('POST', '/auth/demo', { body: { role } });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, role);
    tokens[role] = r.data.token;
    const dash = await call('GET', '/dashboard', { token: r.data.token });
    assert.equal(dash.status, 200, role);
    assert.ok(dash.data.stats.length >= 4, role);
  }
  // Sample data is present and consistent
  const wallet = (await call('GET', '/wallet', { token: tokens.driver })).data;
  assert.ok(wallet.balance > 0, `driver wallet ${wallet.balance}`);
  assert.equal(wallet.card.status, 'active');
  assert.ok(wallet.transactions.length >= 8);
  assert.ok((await call('GET', '/bookings', { token: tokens.passenger })).data.bookings.length >= 7);
  assert.equal((await call('GET', '/verification', { token: tokens.passenger })).data.verification.status, 'verified');
  assert.ok((await call('GET', '/compliance/queue', { token: tokens.compliance })).data.queue.length >= 1, 'something to review');
  assert.ok((await call('GET', '/admin/tickets', { token: tokens.support })).data.tickets.length >= 3);
  assert.equal((await call('GET', '/finance/withdrawals?status=requested', { token: tokens.finance })).data.withdrawals.length, 1);
  assert.equal((await call('GET', '/business/employees', { token: tokens.business })).data.employees.length, 3);
  assert.ok(trialBalance().balanced, 'demo books balance');
  const doc = (await call('GET', '/verification', { token: tokens.passenger })).data.verification.documents[0];
  const file = await fetch(`${base}/verification/documents/${doc.id}/file`, { headers: { authorization: `Bearer ${tokens.passenger}` } });
  assert.equal(file.status, 200);

  // Demo accounts cannot be used with a password, or changed into real accounts
  assert.equal((await call('POST', '/auth/login', { body: { email: 'admin@demo.drop.co.za', password: 'anything' } })).status, 401);
  assert.equal((await call('PATCH', '/auth/me', { token: tokens.passenger, body: { newPassword: 'NewPass123', currentPassword: 'x' } })).status, 400);

  // Switching demo mode off closes the door and ends demo sessions
  process.env.DEMO_MODE = 'false';
  assert.equal((await call('POST', '/auth/demo', { body: { role: 'admin' } })).status, 404);
  assert.equal((await call('GET', '/auth/me', { token: tokens.admin })).status, 401);
  process.env.DEMO_MODE = 'true';
});
