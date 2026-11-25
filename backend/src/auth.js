import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { JWT_SECRET, JWT_EXPIRES_IN } from './config.js';
import { db } from './db.js';
import { demoSessionAllowed } from './demoPolicy.js';

export const ROLES = ['passenger', 'driver', 'business', 'admin', 'compliance', 'support', 'finance'];
export const STAFF_ROLES = ['admin', 'compliance', 'support', 'finance'];

export const hashPassword = (pw) => bcrypt.hash(pw, 11);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);
/**
 * Session tokens (SEC-002). `tv` is the user's token version: bumping it (password change, "sign out
 * everywhere", an admin ending sessions, suspension) invalidates every token issued before.
 * Staff sessions are short (STAFF_SESSION_HOURS, default 12 h); customers keep JWT_EXPIRES_IN.
 */
const STAFF_SESSION = `${Number(process.env.STAFF_SESSION_HOURS || 12)}h`;
export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion || 0, typ: 'session' }, JWT_SECRET, { expiresIn: STAFF_ROLES.includes(user.role) ? STAFF_SESSION : JWT_EXPIRES_IN });
/** Short-lived token for a pending second sign-in step (MFA). Not accepted as a session. */
export const signStepToken = (user, step) => jwt.sign({ sub: user.id, tv: user.tokenVersion || 0, typ: step }, JWT_SECRET, { expiresIn: '5m' });
export function readStepToken(token, step) {
  try {
    const p = jwt.verify(String(token || ''), JWT_SECRET);
    if (p.typ !== step) return null;
    const user = db.find('users', (u) => u.id === p.sub);
    return user && !user.disabled && (user.tokenVersion || 0) === (p.tv || 0) ? user : null;
  } catch { return null; }
}
export function endAllSessions(userId) {
  const u = db.find('users', (x) => x.id === userId);
  if (u) db.update('users', userId, { tokenVersion: (u.tokenVersion || 0) + 1 });
}

/** Strip secrets before a user leaves the server. */
export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, tokenVersion, mfa, mfaPending, bankAccount, ...rest } = u; // eslint-disable-line no-unused-vars
  if (bankAccount) { const { accountEnc, ...safeBank } = bankAccount; rest.bankAccount = safeBank; } // eslint-disable-line no-unused-vars
  rest.mfaEnabled = Boolean(mfa?.enabledAt);
  return rest;
}

function readUser(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ && payload.typ !== 'session') return null; // MFA step tokens are not sessions
    const user = db.find('users', (u) => u.id === payload.sub);
    if (user && (user.tokenVersion || 0) !== (payload.tv || 0)) return null; // revoked
    if (user && payload.role && payload.role !== user.role) return null; // role changed since sign-in
    if (user && !demoSessionAllowed(user)) return null; // demo switched off (or staff demo locked): demo sessions end
    return user && !user.disabled ? user : null;
  } catch {
    return null;
  }
}

export function optionalAuth(req, _res, next) {
  req.user = readUser(req);
  next();
}

export function requireAuth(req, res, next) {
  req.user = readUser(req);
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

export const requireRole = (...roles) => (req, res, next) =>
  requireAuth(req, res, () => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this area.' });
    next();
  });
