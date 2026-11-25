import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

/* Stand-ins: Expo push service and Google Play Integrity decode API. */
const pushes = [];
const integrityVerdicts = new Map();
const stub = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/push') { const msgs = JSON.parse(body); pushes.push(...msgs); return res.end(JSON.stringify({ data: msgs.map((m) => (m.to.includes('dead') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) })); }
    const m = /^\/v1\/(.+):decodeIntegrityToken$/.exec(req.url);
    if (m) return res.end(JSON.stringify({ tokenPayloadExternal: integrityVerdicts.get(JSON.parse(body).integrity_token) }));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => stub.listen(0, r));
const stubBase = `http://127.0.0.1:${stub.address().port}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-mob-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false',
  NODE_ENV: 'test', EXPO_PUSH_URL: `${stubBase}/push`, PLAY_INTEGRITY_API_BASE: stubBase, PLAY_INTEGRITY_ACCESS_TOKEN: 'test', APPLE_TEAM_ID: 'TEAM123456',
  MOBILE_MIN_VERSION: '1.2.0', MOBILE_LATEST_VERSION: '1.3.0', ATTESTATION_MODE: 'enforce',
});

const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { cborDecode } = await import('../src/attest.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await (await import('../src/db.js')).initDb(); await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); stub.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Forgotten password: generic answer, single-use 30-minute link, signs out every device', async () => {
  const reg = await call('POST', '/auth/register', { body: { name: 'Fay Forget', email: 'fay@example.com', password: 'Old-Horse-2026' } });
  const r1 = await call('POST', '/auth/password/forgot', { body: { email: 'fay@example.com' } });
  const r2 = await call('POST', '/auth/password/forgot', { body: { email: 'nobody@example.com' } });
  assert.equal(r1.data.message, r2.data.message, 'same answer whether or not the account exists');
  assert.equal(r2.data.devToken, undefined);
  const token = r1.data.devToken;
  assert.ok(token);
  assert.ok(!JSON.stringify(db.all('passwordResets')).includes(token), 'only a hash is stored');
  assert.equal((await call('POST', '/auth/password/reset', { body: { token: 'nope', newPassword: 'New-Horse-2026' } })).status, 400);
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, newPassword: 'New-Horse-2026' } })).status, 200);
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, newPassword: 'Another-Horse-2026' } })).status, 400, 'single use');
  assert.equal((await call('GET', '/auth/me', { token: reg.data.token })).status, 401, 'old sessions ended');
  assert.ok((await call('POST', '/auth/login', { body: { email: 'fay@example.com', password: 'New-Horse-2026' } })).data.token);
  // Expired link
  const t2 = (await call('POST', '/auth/password/forgot', { body: { email: 'fay@example.com' } })).data.devToken;
  db.all('passwordResets').at(-1).expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call('POST', '/auth/password/reset', { body: { token: t2, newPassword: 'Third-Horse-2026' } })).status, 400);
});

test('Push devices: calls and messages reach the phone; dead tokens are removed', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'pat@example.com');
  const d = await verifiedDriver(call, admin, 'dee@example.com');
  assert.equal((await call('POST', '/devices', { token: d.token, body: { token: 'not a token!', platform: 'android', app: 'driver' } })).status, 400);
  await call('POST', '/devices', { token: d.token, body: { token: 'ExponentPushToken[driver-phone-1]', platform: 'android', app: 'driver' } });
  await call('POST', '/devices', { token: d.token, body: { token: 'ExponentPushToken[dead-old-phone]', platform: 'ios', app: 'driver' } });
  await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  const b = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Gardens', destination: 'Sea Point Promenade', passengers: 1, payment: 'Cash' } })).data.booking;
  await call('POST', `/drivers/bookings/${b.id}/accept`, { token: d.token });
  // Driver's app is in the background (no live stream), but it has a device: the call rings by push
  const c = await call('POST', `/bookings/${b.id}/calls`, { token: p.token, body: { kind: 'video' } });
  assert.equal(c.status, 201);
  await wait(100);
  const ring = pushes.find((m) => m.data?.type === 'call' && m.to === 'ExponentPushToken[driver-phone-1]');
  assert.ok(ring, 'incoming call pushed');
  assert.equal(ring.priority, 'high');
  assert.equal(ring.channelId, 'calls');
  assert.ok(!db.find('devices', (x) => x.token.includes('dead')), 'DeviceNotRegistered token removed');
  await call('POST', `/calls/${c.data.call.id}/end`, { token: p.token });
  await call('POST', `/bookings/${b.id}/messages`, { token: p.token, body: { text: 'At the gate' } });
  await wait(100);
  assert.ok(pushes.find((m) => m.data?.type === 'message' && m.body === 'At the gate'));
  await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token });
  await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token });
  await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token });
});

test('Account deletion: blocked while money or trips are open, then anonymises and signs out', async () => {
  const p = (await call('POST', '/auth/login', { body: { email: 'pat@example.com', password: 'Passw0rd!' } })).data.token;
  assert.equal((await call('POST', '/auth/delete-account', { token: p, body: { password: 'wrong', confirm: 'DELETE' } })).status, 400);
  const d = (await call('POST', '/auth/login', { body: { email: 'dee@example.com', password: 'Driver123' } })).data.token;
  const dd = await call('POST', '/auth/delete-account', { token: d, body: { password: 'Driver123', confirm: 'DELETE' } });
  assert.equal(dd.status, 400, 'driver with unpaid service fees (cash trip) cannot delete yet');
  assert.match(dd.data.error, /owes|withdraw/);
  const user = db.find('users', (u) => u.email === 'pat@example.com');
  const ok = await call('POST', '/auth/delete-account', { token: p, body: { password: 'Passw0rd!', confirm: 'delete' } });
  assert.equal(ok.status, 200);
  const after = db.find('users', (u) => u.id === user.id);
  assert.equal(after.name, 'Deleted user');
  assert.ok(!after.email.includes('pat@'));
  assert.equal(after.phone, '');
  assert.equal((await call('GET', '/auth/me', { token: p })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'pat@example.com', password: 'Passw0rd!' } })).status, 401);
  const v = db.find('verifications', (x) => x.userId === user.id);
  assert.ok(v.retainUntil, 'KYC kept only until the legal retention date');
  assert.ok(db.filter('bookings', (b) => b.userId === user.id).length > 0, 'trip records kept (tax), unlinked from contact details');
  const { purgeExpiredKyc } = await import('../src/routes/account.js');
  v.retainUntil = new Date(Date.now() - 1000).toISOString();
  assert.equal(purgeExpiredKyc(), 1);
  assert.equal(db.find('verifications', (x) => x.userId === user.id).documents.length, 0);
});

test('App version policy (force update)', async () => {
  assert.equal((await call('GET', '/app/config?app=driver&platform=android&version=1.1.9')).data.forceUpdate, true);
  const ok = (await call('GET', '/app/config?app=driver&platform=android&version=1.2.0')).data;
  assert.equal(ok.forceUpdate, false);
  assert.equal(ok.updateAvailable, true);
  assert.match(ok.storeUrl, /za\.co\.drop\.driver/);
});

test('App attestation: Play Integrity and App Attest, enforced on mobile sign-in', async () => {
  const mobile = { 'x-drop-client': 'mobile', 'x-drop-app': 'passenger' };
  const login = { email: 'fay@example.com', password: 'New-Horse-2026' };
  // No proof: blocked in enforce mode; the website (no mobile header) is unaffected
  assert.equal((await call('POST', '/auth/login', { body: login, headers: mobile })).data.code, 'integrity');
  assert.ok((await call('POST', '/auth/login', { body: login })).data.token);

  // Android: genuine app on a genuine device
  let ch = (await call('POST', '/app/attest/challenge')).data.challenge;
  integrityVerdicts.set('good-token', { requestDetails: { requestPackageName: 'za.co.drop.passenger', requestHash: ch, timestampMillis: String(Date.now()) }, appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' }, deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] } });
  assert.ok((await call('POST', '/auth/login', { body: login, headers: { ...mobile, 'x-drop-challenge': ch, 'x-drop-integrity': 'android good-token' } })).data.token);
  assert.equal((await call('POST', '/auth/login', { body: login, headers: { ...mobile, 'x-drop-challenge': ch, 'x-drop-integrity': 'android good-token' } })).status, 403, 'challenge is single-use');
  ch = (await call('POST', '/app/attest/challenge')).data.challenge;
  integrityVerdicts.set('repackaged', { requestDetails: { requestPackageName: 'za.co.drop.passenger', nonce: ch, timestampMillis: String(Date.now()) }, appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' }, deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] } });
  assert.equal((await call('POST', '/auth/login', { body: login, headers: { ...mobile, 'x-drop-challenge': ch, 'x-drop-integrity': 'android repackaged' } })).status, 403, 'modified app blocked');

  // iOS: build an App Attest attestation with a test CA (stands in for Apple's root)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-aa-'));
  const ssl = (...a) => execFileSync('openssl', a, { cwd: tmp, stdio: 'pipe' });
  ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key');
  ssl('req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Test App Attest Root', '-days', '2', '-out', 'root.pem');
  ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'inter.key');
  ssl('req', '-new', '-key', 'inter.key', '-subj', '/CN=Test App Attest CA 1', '-out', 'inter.csr');
  fs.writeFileSync(path.join(tmp, 'ca.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  ssl('x509', '-req', '-in', 'inter.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '2', '-extfile', 'ca.ext', '-out', 'inter.pem');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(path.join(tmp, 'leaf.key'), privateKey.export({ type: 'sec1', format: 'pem' }));
  const point = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  const keyIdBuf = crypto.createHash('sha256').update(point).digest();
  const keyId = keyIdBuf.toString('base64');
  const sha = (...p) => { const h = crypto.createHash('sha256'); p.forEach((x) => h.update(x)); return h.digest(); };
  const rp = sha('TEAM123456.za.co.drop.passenger');
  const authData = Buffer.concat([rp, Buffer.from([0x41]), Buffer.alloc(4), Buffer.from('appattestdevelop'), Buffer.from([0, 32]), keyIdBuf, Buffer.from([0xa5])]);
  ch = (await call('POST', '/app/attest/challenge')).data.challenge;
  const nonce = sha(authData, sha(ch));
  fs.writeFileSync(path.join(tmp, 'leaf.ext'), `1.2.840.113635.100.8.2=DER:30:24:A1:22:04:20:${[...nonce].map((x) => x.toString(16).padStart(2, '0')).join(':')}\n`);
  ssl('req', '-new', '-key', 'leaf.key', '-subj', '/CN=device', '-out', 'leaf.csr');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'inter.pem', '-CAkey', 'inter.key', '-CAcreateserial', '-days', '2', '-extfile', 'leaf.ext', '-outform', 'DER', '-out', 'leaf.der');
  ssl('x509', '-in', 'inter.pem', '-outform', 'DER', '-out', 'inter.der');
  process.env.APPLE_APP_ATTEST_ROOT_PEM = fs.readFileSync(path.join(tmp, 'root.pem'), 'utf8');
  // CBOR encode { fmt, attStmt: { x5c: [leaf, inter], receipt }, authData }
  const enc = {
    head: (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255])),
    bytes(b) { return Buffer.concat([this.head(2, b.length), b]); },
    text(s) { const b = Buffer.from(s); return Buffer.concat([this.head(3, b.length), b]); },
  };
  const leafDer = fs.readFileSync(path.join(tmp, 'leaf.der'));
  const interDer = fs.readFileSync(path.join(tmp, 'inter.der'));
  const attestation = Buffer.concat([enc.head(5, 3), enc.text('fmt'), enc.text('apple-appattest'), enc.text('attStmt'), enc.head(5, 2), enc.text('x5c'), enc.head(4, 2), enc.bytes(leafDer), enc.bytes(interDer), enc.text('receipt'), enc.bytes(Buffer.from('r')), enc.text('authData'), enc.bytes(authData)]);
  assert.equal(cborDecode(attestation).fmt, 'apple-appattest');
  const reg = await call('POST', '/app/attest/ios/register', { body: { keyId, attestation: attestation.toString('base64'), challenge: ch }, headers: mobile });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  // The same attestation replayed with a different challenge fails the nonce check
  const ch2 = (await call('POST', '/app/attest/challenge')).data.challenge;
  assert.equal((await call('POST', '/app/attest/ios/register', { body: { keyId, attestation: attestation.toString('base64'), challenge: ch2 }, headers: mobile })).status, 400);
  const realRoot = process.env.APPLE_APP_ATTEST_ROOT_PEM;
  // Assertions: signed by the device key over a fresh challenge with a rising counter
  const assertion = async (counter) => {
    const c = (await call('POST', '/app/attest/challenge')).data.challenge;
    const ad = Buffer.concat([rp, Buffer.from([0x01]), Buffer.from([0, 0, 0, counter])]);
    const sig = crypto.createSign('SHA256').update(sha(ad, sha(c))).sign(privateKey);
    const cbor = Buffer.concat([enc.head(5, 2), enc.text('signature'), enc.bytes(sig), enc.text('authenticatorData'), enc.bytes(ad)]);
    return { c, proof: `ios ${keyId}.${cbor.toString('base64')}` };
  };
  let a = await assertion(1);
  assert.ok((await call('POST', '/auth/login', { body: login, headers: { ...mobile, 'x-drop-challenge': a.c, 'x-drop-integrity': a.proof } })).data.token);
  a = await assertion(1);
  assert.equal((await call('POST', '/auth/login', { body: login, headers: { ...mobile, 'x-drop-challenge': a.c, 'x-drop-integrity': a.proof } })).status, 403, 'replayed counter refused');
  a = await assertion(2);
  assert.ok((await call('POST', '/auth/login', { body: login, headers: { ...mobile, 'x-drop-challenge': a.c, 'x-drop-integrity': a.proof } })).data.token);
  process.env.APPLE_APP_ATTEST_ROOT_PEM = realRoot;
  fs.rmSync(tmp, { recursive: true, force: true });
});
