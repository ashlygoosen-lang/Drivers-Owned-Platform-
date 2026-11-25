// Windowed ledger stays exact (Phase 6B-1). PostgreSQL only: run through scripts/test-postgres.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PG = Boolean(process.env.DATABASE_URL);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-ledgerwin-'));
Object.assign(process.env, { DATA_DIR: dir, FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false', HOT_WINDOW_DAYS: '14' });
const dbm = await import('../src/db.js');
const { db } = dbm;
const ledger = await import('../src/money/ledger.js');
const { checkLedger } = await import('../src/reconcile.js');
before(async () => { await dbm.initDb(); });
after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const entry = (lines, createdAt, key = null) => ({ id: crypto.randomUUID(), key, type: 'test', memo: 'old', lines, meta: {}, actor: null, createdAt });

test('balances stay exact when old entries leave memory, across a restart, and the self-check repairs drift', { skip: !PG && 'needs PostgreSQL' }, async () => {
  // Recent activity through the normal path
  ledger.post({ type: 'payment.received', key: 'payment:new1', memo: 'n', lines: [{ account: 'pool', dr: 5000 }, { account: 'escrow', cr: 5000 }] });
  ledger.post({ type: 'trip.settled', key: 'settle:new1', memo: 'n', lines: [{ account: 'escrow', dr: 5000 }, { account: 'wallet:d1', cr: 4500 }, { account: 'fees', cr: 500 }] });
  // 30-day-old history written by "another server"
  for (let i = 0; i < 50; i++) {
    const e = entry([{ account: 'pool', dr: 1000 }, { account: 'wallet:d1', cr: 900 }, { account: 'fees', cr: 100 }], daysAgo(30), `old:${i}`);
    await db.sql('insert into drop_docs (collection, id, data) values ($1, $2, $3)', ['ledger', e.id, JSON.stringify(e)]);
  }
  await dbm.catchUp();
  const before = { pool: ledger.balance('pool'), wallet: ledger.walletBalance('d1'), fees: ledger.balance('fees'), escrow: ledger.balance('escrow') };
  assert.deepEqual(before, { pool: 55000, wallet: 49500, fees: 5500, escrow: 0 });
  assert.deepEqual(await ledger.verifyAgainstDatabase(), []);

  // Hourly eviction: the old entries leave memory, balances do not move by a cent
  const inMemBefore = db.all('ledger').length;
  db.evictCold();
  assert.equal(db.all('ledger').length, inMemBefore - 50);
  ledger.resetCacheForTests(); // force a rebuild from base + memory
  assert.deepEqual({ pool: ledger.balance('pool'), wallet: ledger.walletBalance('d1'), fees: ledger.balance('fees'), escrow: ledger.balance('escrow') }, before);
  assert.deepEqual(await ledger.verifyAgainstDatabase(), []);
  assert.equal(ledger.trialBalance().balanced, true);

  // Statements still show the whole history; idempotent keys still hold for recent entries
  assert.equal((await ledger.statement('wallet:d1', 500)).length, 51);
  assert.equal(ledger.post({ type: 'trip.settled', key: 'settle:new1', memo: 'again', lines: [{ account: 'escrow', dr: 1 }, { account: 'fees', cr: 1 }] }).memo, 'n');

  // A fresh server loads only recent entries and gets the same balances
  await db.flush();
  const child = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const m = await import(${JSON.stringify(new URL('../src/db.js', import.meta.url).href)});
    const l = await import(${JSON.stringify(new URL('../src/money/ledger.js', import.meta.url).href)});
    await m.initDb();
    console.log(JSON.stringify({ inMemory: m.db.all('ledger').length, pool: l.balance('pool'), wallet: l.walletBalance('d1'), fees: l.balance('fees'), diff: await l.verifyAgainstDatabase() }));
    await m.db.close(); process.exit(0);`], { env: process.env, encoding: 'utf8' });
  const fresh = JSON.parse(child.trim().split('\n').at(-1));
  assert.equal(fresh.inMemory, 2, 'only the 2 recent entries are in memory');
  assert.deepEqual({ pool: fresh.pool, wallet: fresh.wallet, fees: fresh.fees }, { pool: before.pool, wallet: before.wallet, fees: before.fees });
  assert.deepEqual(fresh.diff, []);

  // Drift (simulated corruption of the base) is detected, reported and repaired
  assert.deepEqual(await checkLedger({ attempts: 1 }), []);
  db.ledgerBase().set('pool', (db.ledgerBase().get('pool') || 0) + 7);
  ledger.resetCacheForTests();
  assert.equal(ledger.balance('pool'), before.pool + 7);
  const diff = await checkLedger({ attempts: 2, gapMs: 10 });
  assert.equal(diff[0].account, 'pool');
  assert.ok(db.all('securityEvents').some((e) => e.type === 'ledger_mismatch'));
  assert.equal(ledger.balance('pool'), before.pool, 'repaired from PostgreSQL');
  assert.deepEqual(await ledger.verifyAgainstDatabase(), []);
});
