import crypto from 'node:crypto';
import { Router } from 'express';
import { db, id, now } from './db.js';
import { wrap, bad, HttpError } from './validate.js';
import { securityEvent } from './monitor.js';
import * as kv from './kv.js';

/**
 * App attestation (MASVS-RESILIENCE): proof that a sensitive request comes from a genuine, unmodified
 * DROP app on a real device, not a script or a repackaged app.
 *   Android: Google Play Integrity (standard request: requestHash = server challenge; classic nonce also accepted).
 *   iOS:     Apple App Attest (attestation registers a device key; each sensitive request carries an
 *            assertion signed by that key over the server challenge).
 * Flow: app gets a one-time challenge (POST /api/app/attest/challenge), then sends
 *   X-DROP-Challenge: <challenge>
 *   X-DROP-Integrity: android <integrity token>   |   ios <keyId>.<base64 assertion>
 * ATTESTATION_MODE: off | report (default: verify and log, never block) | enforce (block failures).
 * Applies only to requests that identify as the mobile app (X-DROP-Client: mobile).
 */
const MODE = () => (process.env.ATTESTATION_MODE || 'report').toLowerCase();
const sha256 = (...parts) => { const h = crypto.createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };

/* ---------- minimal CBOR decoder (enough for App Attest objects) ---------- */
export function cborDecode(buf) {
  let o = 0;
  const len = (info) => {
    if (info < 24) return info;
    if (info === 24) return buf[o++];
    if (info === 25) { const v = buf.readUInt16BE(o); o += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(o); o += 4; return v; }
    if (info === 27) { const v = Number(buf.readBigUInt64BE(o)); o += 8; return v; }
    throw new Error('Unsupported CBOR length');
  };
  const item = () => {
    const b = buf[o++]; const major = b >> 5; const info = b & 31;
    if (major === 0) return len(info);
    if (major === 1) return -1 - len(info);
    if (major === 2) { const n = len(info); const v = buf.subarray(o, o + n); o += n; return Buffer.from(v); }
    if (major === 3) { const n = len(info); const v = buf.toString('utf8', o, o + n); o += n; return v; }
    if (major === 4) { const n = len(info); return Array.from({ length: n }, item); }
    if (major === 5) { const n = len(info); const m = {}; for (let i = 0; i < n; i++) { const k = item(); m[k] = item(); } return m; }
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; }
    throw new Error('Unsupported CBOR type');
  };
  const out = item();
  return out;
}

/* ---------- challenges ---------- */
export async function newChallenge() {
  const c = crypto.randomBytes(24).toString('base64url');
  await kv.set(`attest:ch:${c}`, '1', 300);
  return c;
}
async function useChallenge(c) {
  if (!c || !(await kv.get(`attest:ch:${c}`))) return false;
  await kv.del(`attest:ch:${c}`); // one use only
  return true;
}

/* ---------- Android: Play Integrity ---------- */
async function googleAccessToken() {
  if (process.env.PLAY_INTEGRITY_ACCESS_TOKEN) return process.env.PLAY_INTEGRITY_ACCESS_TOKEN; // tests / short-lived override
  const cached = await kv.get('attest:gtoken');
  if (cached) return cached;
  const sa = JSON.parse(process.env.GOOGLE_PLAY_INTEGRITY_SA_JSON || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_PLAY_INTEGRITY_SA_JSON is not configured');
  const nowS = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity', aud: 'https://oauth2.googleapis.com/token', iat: nowS, exp: nowS + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google token exchange failed');
  await kv.set('attest:gtoken', data.access_token, Math.max(60, (data.expires_in || 3600) - 120));
  return data.access_token;
}

export async function verifyAndroid(token, challenge, app) {
  const pkg = app === 'driver' ? (process.env.ANDROID_PACKAGE_DRIVER || 'za.co.drop.driver') : (process.env.ANDROID_PACKAGE_PASSENGER || 'za.co.drop.passenger');
  const base = process.env.PLAY_INTEGRITY_API_BASE || 'https://playintegrity.googleapis.com';
  const res = await fetch(`${base}/v1/${pkg}:decodeIntegrityToken`, {
    method: 'POST', headers: { authorization: `Bearer ${await googleAccessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ integrity_token: token }), signal: AbortSignal.timeout(8000),
  });
  const p = (await res.json()).tokenPayloadExternal;
  if (!p) return { ok: false, reason: 'undecodable' };
  if (p.requestDetails?.requestPackageName !== pkg) return { ok: false, reason: 'package' };
  const bound = p.requestDetails?.requestHash ?? p.requestDetails?.nonce;
  if (bound !== challenge && bound !== Buffer.from(challenge).toString('base64url')) return { ok: false, reason: 'nonce' };
  if (Math.abs(Date.now() - Number(p.requestDetails?.timestampMillis || 0)) > 5 * 60_000) return { ok: false, reason: 'stale' };
  if (p.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return { ok: false, reason: 'app_not_recognized' };
  if (!(p.deviceIntegrity?.deviceRecognitionVerdict || []).includes('MEETS_DEVICE_INTEGRITY')) return { ok: false, reason: 'device_integrity' };
  return { ok: true };
}

/* ---------- iOS: App Attest ---------- */
let appleRoot = null;
async function appleRootCert() {
  if (appleRoot) return appleRoot;
  const pem = process.env.APPLE_APP_ATTEST_ROOT_PEM
    || await fetch('https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem', { signal: AbortSignal.timeout(8000) }).then((r) => r.text());
  appleRoot = new crypto.X509Certificate(pem);
  return appleRoot;
}
const bundleFor = (app) => (app === 'driver' ? (process.env.IOS_BUNDLE_DRIVER || 'za.co.drop.driver') : (process.env.IOS_BUNDLE_PASSENGER || 'za.co.drop.passenger'));
const rpIdHash = (app) => sha256(`${process.env.APPLE_TEAM_ID || ''}.${bundleFor(app)}`);
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

/** Verify a one-time attestation and remember the device's public key. */
export async function registerIosKey({ keyId, attestation, challenge, app, userId }) {
  const att = cborDecode(Buffer.from(attestation, 'base64'));
  if (att.fmt !== 'apple-appattest') throw bad('Invalid attestation format.');
  const [leafDer, interDer] = att.attStmt?.x5c || [];
  const leaf = new crypto.X509Certificate(leafDer);
  const inter = new crypto.X509Certificate(interDer);
  const root = await appleRootCert();
  const t = Date.now();
  for (const c of [leaf, inter]) if (Date.parse(c.validFrom) > t || Date.parse(c.validTo) < t) throw bad('Attestation certificate expired.');
  if (!leaf.verify(inter.publicKey) || !inter.verify(root.publicKey)) throw bad('Attestation is not signed by Apple.');
  const nonce = sha256(att.authData, sha256(challenge));
  const der = leaf.raw;
  const at = der.indexOf(NONCE_OID);
  const inner = at >= 0 ? der.indexOf(Buffer.from([0x04, 0x20]), at) : -1;
  if (inner < 0 || !der.subarray(inner + 2, inner + 34).equals(nonce)) throw bad('Attestation nonce mismatch.');
  const point = leaf.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  if (sha256(point).toString('base64') !== keyId) throw bad('Attestation key mismatch.');
  const a = att.authData;
  if (!a.subarray(0, 32).equals(rpIdHash(app))) throw bad('Attestation is for a different app.');
  if (a.readUInt32BE(33) !== 0) throw bad('Attestation counter must be zero.');
  const aaguid = a.subarray(37, 53).toString('latin1').replace(/\0+$/, '');
  if (!['appattest', 'appattestdevelop'].includes(aaguid)) throw bad('Unexpected attestation environment.');
  if (aaguid === 'appattestdevelop' && process.env.NODE_ENV === 'production' && process.env.APP_ATTEST_ALLOW_DEVELOPMENT !== 'true') throw bad('Development attestation is not accepted.');
  const credLen = a.readUInt16BE(53);
  if (!a.subarray(55, 55 + credLen).equals(Buffer.from(keyId, 'base64'))) throw bad('Attestation credential mismatch.');
  const existing = db.find('attestKeys', (k) => k.keyId === keyId);
  const publicKeyPem = leaf.publicKey.export({ type: 'spki', format: 'pem' });
  if (existing) db.update('attestKeys', existing.id, { publicKeyPem, counter: 0, app, userId });
  else db.insert('attestKeys', { id: id(), keyId, publicKeyPem, counter: 0, app, userId: userId || null, environment: aaguid, createdAt: now() });
  return true;
}

/** Verify an assertion: signed by a registered key, over this challenge, with a rising counter. */
export function verifyIosAssertion(keyId, assertionB64, challenge, app) {
  const key = db.find('attestKeys', (k) => k.keyId === keyId);
  if (!key) return { ok: false, reason: 'unknown_key' };
  let a;
  try { a = cborDecode(Buffer.from(assertionB64, 'base64')); } catch { return { ok: false, reason: 'malformed' }; }
  const authData = a.authenticatorData;
  if (!Buffer.isBuffer(authData) || !Buffer.isBuffer(a.signature)) return { ok: false, reason: 'malformed' };
  const nonce = sha256(authData, sha256(challenge));
  const valid = crypto.createVerify('SHA256').update(nonce).verify(key.publicKeyPem, a.signature);
  if (!valid) return { ok: false, reason: 'signature' };
  if (!authData.subarray(0, 32).equals(rpIdHash(app || key.app))) return { ok: false, reason: 'app' };
  const counter = authData.readUInt32BE(33);
  if (counter <= key.counter) return { ok: false, reason: 'replay' };
  db.update('attestKeys', key.id, { counter, lastUsedAt: now() });
  return { ok: true };
}

/* ---------- middleware ---------- */
export function requireIntegrity() {
  return async (req, _res, next) => {
    const mode = MODE();
    if (mode === 'off' || String(req.get('x-drop-client') || '').toLowerCase() !== 'mobile') return next();
    const app = req.get('x-drop-app') === 'driver' ? 'driver' : 'passenger';
    const challenge = String(req.get('x-drop-challenge') || '');
    const [platform, proof = ''] = String(req.get('x-drop-integrity') || '').split(' ');
    let result = { ok: false, reason: 'missing' };
    try {
      if (proof && await useChallenge(challenge)) {
        if (platform === 'android') result = await verifyAndroid(proof, challenge, app);
        else if (platform === 'ios') { const [keyId, assertion] = proof.split('.'); result = verifyIosAssertion(keyId, assertion, challenge, app); }
      } else if (proof) result = { ok: false, reason: 'challenge' };
    } catch (err) { result = { ok: false, reason: `error:${err.message.slice(0, 60)}` }; }
    req.integrity = result;
    if (!result.ok) {
      securityEvent('app_integrity_failed', { path: req.path, platform: platform || 'none', reason: result.reason, mode }, mode === 'enforce' ? 'medium' : 'info');
      if (mode === 'enforce') { const e = new HttpError(403, 'Please update DROP from the official app store to continue.'); e.code = 'integrity'; return next(e); }
    }
    next();
  };
}

export const attestRouter = Router();
attestRouter.post('/app/attest/challenge', wrap(async (_req, res) => res.json({ challenge: await newChallenge() })));
attestRouter.post('/app/attest/ios/register', wrap(async (req, res) => {
  const { keyId, attestation, challenge } = req.body || {};
  if (typeof keyId !== 'string' || typeof attestation !== 'string' || !(await useChallenge(String(challenge || '')))) throw bad('Invalid or expired attestation request.');
  await registerIosKey({ keyId, attestation, challenge, app: req.get('x-drop-app') === 'driver' ? 'driver' : 'passenger', userId: null });
  res.json({ ok: true });
}));
