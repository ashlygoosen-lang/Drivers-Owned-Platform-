import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { JWT_SECRET, JWT_EXPIRES_IN } from './config.js';
import { db } from './db.js';

export const ROLES = ['passenger', 'driver', 'business', 'admin', 'compliance', 'support', 'finance'];
export const STAFF_ROLES = ['admin', 'compliance', 'support', 'finance'];

export const hashPassword = (pw) => bcrypt.hash(pw, 11);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);
export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

/** Strip secrets before a user leaves the server. */
export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

function readUser(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.find('users', (u) => u.id === payload.sub);
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
