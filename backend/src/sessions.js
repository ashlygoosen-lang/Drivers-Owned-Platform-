import crypto from 'node:crypto';
import { db, id, now } from './db.js';
import { IS_PROD } from './config.js';
import { signToken, STAFF_ROLES, sessionEpoch } from './auth.js';

/**
 * Sessions (SEC-017). Sign-in returns a short-lived access token (15 min, kept in memory by the
 * website) plus a refresh token in an httpOnly, Secure, SameSite=Strict cookie that page scripts can
 * never read. Each refresh rotates the token; presenting an already-used refresh token means it was
 * stolen, so the whole session family is revoked (reuse detection).
 * Native apps (Phase 5) send `X-DROP-Client: mobile` and receive the refresh token in the response
 * body instead, storing it in the device keychain.
 */
export const COOKIE = 'drop_rt';
const DAY = 86_400_000;
const lifetime = (user) => (STAFF_ROLES.includes(user.role) ? Number(process.env.STAFF_SESSION_HOURS || 12) * 3_600_000 : Number(process.env.SESSION_DAYS || 30) * DAY);
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const isMobile = (req) => String(req.get('x-drop-client') || '').toLowerCase() === 'mobile';

function cookieHeader(value, maxAgeMs) {
  return [`${COOKIE}=${value}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`, ...(IS_PROD ? ['Secure'] : [])].join('; ');
}

function create(user, req, family = id()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const s = db.insert('sessions', {
    id: id(), userId: user.id, family, hash: hash(token), tv: user.tokenVersion || 0, ep: sessionEpoch(),
    createdAt: now(), expiresAt: new Date(Date.now() + lifetime(user)).toISOString(), revokedAt: null, replacedBy: null,
    ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 160),
  });
  return { s, token };
}

/** Issue a session after sign-in. Returns the JSON fields to merge into the response. */
export function issueSession(req, res, user) {
  const { token } = create(user, req);
  res.append('Set-Cookie', cookieHeader(token, lifetime(user)));
  return { token: signToken(user), ...(isMobile(req) && { refreshToken: token }) };
}

function readRefresh(req) {
  if (req.body?.refreshToken && isMobile(req)) return String(req.body.refreshToken);
  const raw = req.get('cookie') || '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}

export function revokeFamily(family, reason) {
  for (const s of db.filter('sessions', (x) => x.family === family && !x.revokedAt)) db.update('sessions', s.id, { revokedAt: now(), revokeReason: reason });
}

/** Rotate a refresh token. Returns { user, json } or throws a 401-style error object. */
export function refresh(req, res) {
  const token = readRefresh(req);
  const fail = (why) => { res.append('Set-Cookie', cookieHeader('', 0)); return { error: why }; };
  if (!token) return fail('none');
  const s = db.find('sessions', (x) => x.hash === hash(token));
  if (!s) return fail('unknown');
  if (s.replacedBy || s.revokedAt) {
    // A rotated token was presented again: someone else has a copy. End the whole family.
    if (s.replacedBy) revokeFamily(s.family, 'reuse_detected');
    return fail(s.replacedBy ? 'reuse' : 'revoked');
  }
  const user = db.byId('users', s.userId);
  if (!user || user.disabled || Date.parse(s.expiresAt) < Date.now() || (user.tokenVersion || 0) !== s.tv || (s.ep || '1') !== sessionEpoch()) { db.update('sessions', s.id, { revokedAt: now() }); return fail('expired'); }
  const next = create(user, req, s.family);
  db.update('sessions', s.id, { replacedBy: next.s.id, rotatedAt: now() });
  res.append('Set-Cookie', cookieHeader(next.token, Date.parse(next.s.expiresAt) - Date.now()));
  return { user, json: { token: signToken(user), ...(isMobile(req) && { refreshToken: next.token }) } };
}

export function endSession(req, res) {
  const token = readRefresh(req);
  const s = token && db.find('sessions', (x) => x.hash === hash(token));
  if (s) revokeFamily(s.family, 'logout');
  res.append('Set-Cookie', cookieHeader('', 0));
}

/** Housekeeping: drop sessions that expired more than a week ago. */
export function pruneSessions() {
  const cutoff = Date.now() - 7 * DAY;
  db.remove('sessions', (s) => Date.parse(s.expiresAt) <= cutoff);
}
