import crypto from 'node:crypto';
import { IS_PROD } from './config.js';
import * as kv from './kv.js';

/* ---------------- Login throttling per account (SEC-004, SEC-012) ----------------
 * On top of the per-IP limiter: after 5 failed attempts for one account the account is locked for
 * 15 minutes, doubling up to 4 hours. It applies whether or not the email exists, so it reveals
 * nothing. Stored in Redis when configured (shared by all instances), else in memory.
 */
const MAX_FAILS = () => Number(process.env.LOGIN_MAX_FAILS || 5);

export async function loginLocked(key) {
  const left = await kv.ttl(`lock:${key}`);
  return left > 0 ? Math.ceil(left / 60) : 0;
}

/** Returns true when this failure locked the account. */
export async function loginFailed(key) {
  const n = await kv.incr(`fail:${key}`, 15 * 60);
  if (n < MAX_FAILS()) return false;
  const level = Math.min(await kv.incr(`lvl:${key}`, 24 * 3600), 5);
  await kv.set(`lock:${key}`, '1', Math.min(15 * 60 * 2 ** (level - 1), 4 * 3600));
  await kv.del(`fail:${key}`);
  return true;
}

export const loginSucceeded = (key) => kv.del(`fail:${key}`);

/* ---------------- Breached-password check (SEC-004) ----------------
 * Have I Been Pwned "range" API with k-anonymity: only the first 5 characters of the password's
 * SHA-1 leave the server. Fails open (allows the password) if the service is slow or unreachable.
 * On by default in production; PWNED_CHECK=on|off overrides.
 */
const pwnedOn = () => { const v = (process.env.PWNED_CHECK || '').toLowerCase(); return v ? v === 'on' || v === 'true' : IS_PROD; };

export async function passwordBreachCount(password) {
  if (!pwnedOn()) return 0;
  const sha = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const base = process.env.PWNED_API_BASE || 'https://api.pwnedpasswords.com';
    const res = await fetch(`${base}/range/${sha.slice(0, 5)}`, { headers: { 'Add-Padding': 'true', 'user-agent': 'DROP-platform' }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return 0;
    const line = (await res.text()).split('\n').find((l) => l.startsWith(sha.slice(5)));
    return line ? Number(line.split(':')[1]) || 0 : 0;
  } catch { return 0; }
}

/* ---------------- TOTP two-step sign-in (SEC-003) ----------------
 * RFC 6238 (SHA-1, 6 digits, 30 s), compatible with Google Authenticator, Microsoft Authenticator,
 * Authy and 1Password. One step of clock drift either side is accepted and a code can't be reused.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(crypto.randomBytes(20));

export function totp(secret, step = Math.floor(Date.now() / 30_000)) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Returns the matched time step, or null. Pass lastStep to refuse replays. */
export function verifyTotp(secret, code, lastStep = -1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(Date.now() / 30_000);
  for (const s of [now, now - 1, now + 1]) {
    if (s <= lastStep) continue;
    const expected = totp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
  }
  return null;
}

export const otpauthUrl = (secret, account) => `otpauth://totp/${encodeURIComponent(`DROP:${account}`)}?secret=${secret}&issuer=DROP&algorithm=SHA1&digits=6&period=30`;

export function recoveryCodes(n = 8) {
  return Array.from({ length: n }, () => { const r = crypto.randomBytes(5).toString('hex').toUpperCase(); return `${r.slice(0, 5)}-${r.slice(5)}`; });
}
export const hashCode = (code) => crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
