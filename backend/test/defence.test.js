import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { makeClient, verifiedPassenger } from './helpers.js';

/* Stand-in Cloudflare Turnstile: token "good" passes. */
const turnstile = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => { const p = new URLSearchParams(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(p.get('secret') === 'ts-secret' && p.get('response') === 'good' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] })); });
});
await new Promise((r) => turnstile.listen(0, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-def-'));
// A data file written by an older version, with a plain-text ID number, to prove the migration.
fs.writeFileSync(path.join(dir, 'drop-db.json'), JSON.stringify({ users: [], verifications: [{ id: 'legacy-v', userId: 'legacy-u', role: 'passenger', status: 'not_started', profile: { legalName: 'Old Record', idType: 'sa_id', idNumber: '8001015009087' }, documents: [], history: [] }] }));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  TURNSTILE_VERIFY_URL: `http://127.0.0.1:${turnstile.address().port}`, RATE_LIMIT_BOOKINGS: '3',
});

const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { verifyAuditChain, revealIdNumber } = await import('../src/kyc.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); turnstile.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const cookieOf = (res) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('drop_rt='))?.split(';')[0] || '';
async function raw(method, url, { body, cookie, headers = {} } = {}) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: cookieOf(res), headers: res.headers };
}

test('SEC-008: identity numbers are encrypted at rest (and old records are migrated)', async () => {
  const legacy = db.find('verifications', (v) => v.id === 'legacy-v');
  assert.equal(legacy.profile.idNumber, undefined);
  assert.ok(legacy.profile.idNumberEnc && legacy.profile.idNumberHash);
  assert.equal(revealIdNumber(legacy.profile), '8001015009087');
  // SEC-024: a truncated ciphertext (short GCM tag) must be rejected, not accepted with a weak tag
  const { encryptText, decryptText } = await import('../src/kyc.js');
  const good = Buffer.from(encryptText('secret'), 'base64');
  assert.throws(() => decryptText(good.subarray(0, 20).toString('base64')));

  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'pat@example.com');
  await db.flush();
  const onDisk = fs.readFileSync(path.join(dir, 'drop-db.json'), 'utf8');
  assert.ok(!onDisk.includes('9001015009'), 'no plain ID number in the data file');
  const own = (await call('GET', '/verification', { token: p.token })).data.verification;
  assert.match(own.profile.idNumber, /•|\*/, 'owner sees a masked number');
  const staffView = (await call('GET', `/compliance/verifications/${p.id}`, { token: admin })).data.verification;
  assert.match(staffView.profile.idNumber, /^\d{13}$/, 'compliance review sees the full number');
});

test('SEC-017: refresh tokens rotate in an httpOnly cookie; a reused token revokes the session family', async () => {
  const reg = await raw('POST', '/auth/register', { body: { name: 'Rhea Fresh', email: 'rhea@example.com', password: 'Fresh-Horse-2026' } });
  assert.match(reg.headers.get('set-cookie'), /drop_rt=.*HttpOnly.*SameSite=Strict/);
  const c1 = reg.cookie;
  assert.equal((await raw('POST', '/auth/refresh', { cookie: c1 })).status, 403, 'CSRF header required');
  const r1 = await raw('POST', '/auth/refresh', { cookie: c1, headers: { 'x-drop-csrf': '1' } });
  assert.equal(r1.status, 200);
  assert.ok(r1.data.token && r1.cookie && r1.cookie !== c1, 'rotated');
  const r2 = await raw('POST', '/auth/refresh', { cookie: r1.cookie, headers: { 'x-drop-csrf': '1' } });
  assert.equal(r2.status, 200);
  // Attacker replays the first (already rotated) cookie: everything in the family dies
  assert.equal((await raw('POST', '/auth/refresh', { cookie: c1, headers: { 'x-drop-csrf': '1' } })).status, 401);
  assert.equal((await raw('POST', '/auth/refresh', { cookie: r2.cookie, headers: { 'x-drop-csrf': '1' } })).status, 401, 'legitimate chain revoked too');
  assert.ok(db.find('securityEvents', (e) => e.type === 'refresh_token_reuse'));

  // Mobile apps get the refresh token in the body
  const m = await raw('POST', '/auth/login', { body: { email: 'rhea@example.com', password: 'Fresh-Horse-2026' }, headers: { 'x-drop-client': 'mobile' } });
  assert.ok(m.data.refreshToken);
  const mr = await raw('POST', '/auth/refresh', { body: { refreshToken: m.data.refreshToken }, headers: { 'x-drop-client': 'mobile' } });
  assert.ok(mr.data.refreshToken && mr.data.refreshToken !== m.data.refreshToken);
  // Logout ends the session
  await raw('POST', '/auth/logout', { body: { refreshToken: mr.data.refreshToken }, headers: { 'x-drop-client': 'mobile' } });
  assert.equal((await raw('POST', '/auth/refresh', { body: { refreshToken: mr.data.refreshToken }, headers: { 'x-drop-client': 'mobile' } })).status, 401);

  // Platform-wide sign-out by changing SESSION_EPOCH
  const t = m.data.token;
  assert.equal((await call('GET', '/auth/me', { token: t })).status, 200);
  process.env.SESSION_EPOCH = '2';
  try { assert.equal((await call('GET', '/auth/me', { token: t })).status, 401); } finally { delete process.env.SESSION_EPOCH; }
});

test('SEC-013: audit log is hash-chained and tampering is detected', async () => {
  assert.equal(verifyAuditChain().ok, true);
  const entries = db.all('audit');
  assert.ok(entries.length >= 3);
  const original = entries[1].detail;
  entries[1].detail = { ...original, decision: 'edited' };
  assert.equal(verifyAuditChain().ok, false);
  entries[1].detail = original;
  assert.equal(verifyAuditChain().ok, true);
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  assert.equal((await call('GET', '/admin/security', { token: admin })).data.audit.ok, true);
});

test('Bot check, booking rate limit with Retry-After, and maintenance mode', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = (await call('POST', '/auth/login', { body: { email: 'pat@example.com', password: 'Passw0rd!' } })).data.token;
  const trip = { service: 'Ride', category: 'Comfort', pickup: 'Gardens', destination: 'Sea Point Promenade', passengers: 1, payment: 'Cash' };

  // Turnstile on: requests without a valid token are refused
  Object.assign(process.env, { TURNSTILE_SECRET_KEY: 'ts-secret', TURNSTILE_SITE_KEY: 'ts-site' });
  try {
    assert.equal((await call('GET', '/security/config')).data.turnstileSiteKey, 'ts-site');
    assert.equal((await call('POST', '/auth/login', { body: { email: 'pat@example.com', password: 'Passw0rd!' } })).data.code, 'bot_check');
    assert.equal((await call('POST', '/auth/login', { body: { email: 'pat@example.com', password: 'Passw0rd!', turnstileToken: 'bad' } })).status, 400);
    assert.ok((await call('POST', '/auth/login', { body: { email: 'pat@example.com', password: 'Passw0rd!', turnstileToken: 'good' } })).data.token);
    assert.equal((await call('POST', '/bookings', { token: p, body: trip })).data.code, 'bot_check');
  } finally { delete process.env.TURNSTILE_SECRET_KEY; delete process.env.TURNSTILE_SITE_KEY; }

  // Per-user booking limit (set to 3 for the test); the bot-check attempt above counted as one
  let last;
  for (let i = 0; i < 4; i++) { last = await raw('POST', '/bookings', { body: trip, headers: { authorization: `Bearer ${p}` } }); if (i < 2) await call('POST', `/bookings/${last.data.booking.id}/cancel`, { token: p }); }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);

  // Maintenance: customers get 503, staff keep working, payment callbacks still reach the server
  await call('POST', '/admin/maintenance', { token: admin, body: { on: true, message: 'Upgrading, back soon' } });
  const m = await call('GET', '/bookings', { token: p });
  assert.equal(m.status, 503);
  assert.equal(m.data.error, 'Upgrading, back soon');
  assert.equal((await call('GET', '/admin/users', { token: admin })).status, 200);
  assert.notEqual((await call('POST', '/payments/paystack/webhook', { body: {} })).status, 503);
  await call('POST', '/admin/maintenance', { token: admin, body: { on: false } });
  assert.equal((await call('GET', '/bookings', { token: p })).status, 200);
  assert.ok(db.find('audit', (a) => a.action === 'maintenance_on'));
});

test('Backups: encrypted, tamper-evident, uploaded off-site, and restorable into a fresh folder', { skip: Boolean(process.env.DATABASE_URL) && 'PostgreSQL mode uses managed database backups (point-in-time recovery)' }, async () => {
  const { runBackup, restoreBackup, decryptBackup } = await import('../src/backup.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-bk-'));
  const target = path.join(os.tmpdir(), `drop-restore-${Date.now()}`);
  try {
    const puts = [];
    const s3 = http.createServer((req, res) => { let n = 0; req.on('data', (c) => { n += c.length; }); req.on('end', () => { puts.push({ url: req.url, auth: req.headers.authorization, bytes: n }); res.end(); }); });
    await new Promise((ok) => s3.listen(0, ok));
    Object.assign(process.env, { BACKUP_S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, BACKUP_S3_BUCKET: 'drop-bk', BACKUP_S3_ACCESS_KEY: 'AK', BACKUP_S3_SECRET_KEY: 'SK' });
    const r = await runBackup({ key: 'backup-secret', outDir: out });
    s3.close();
    for (const k of ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY']) delete process.env[k];
    assert.equal(puts.length, 1);
    assert.match(puts[0].url, /^\/drop-bk\/drop-backups\/drop-.*\.dropbk$/);
    assert.match(puts[0].auth, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.equal(puts[0].bytes, r.bytes);
    const buf = fs.readFileSync(r.file);
    assert.ok(!buf.includes(Buffer.from('pat@example.com')), 'backup is encrypted');
    assert.throws(() => decryptBackup(buf, 'wrong-key'));
    const tampered = Buffer.from(buf); tampered[tampered.length - 5] ^= 1;
    assert.throws(() => decryptBackup(tampered, 'backup-secret'), 'tampering is detected');
    restoreBackup(r.file, target, 'backup-secret');
    const restored = JSON.parse(fs.readFileSync(path.join(target, 'drop-db.json'), 'utf8'));
    assert.ok(restored.users.find((u) => u.email === 'pat@example.com'));
    assert.equal(restored.verifications.length, db.all('verifications').length);
    assert.ok(fs.readdirSync(path.join(target, 'uploads', 'kyc')).length > 0, 'KYC documents included');
  } finally { fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(target, { recursive: true, force: true }); }
});
