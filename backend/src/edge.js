import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { JWT_SECRET } from './config.js';
import { settings } from './db.js';
import { redis } from './kv.js';
import * as kv from './kv.js';
import { HttpError } from './validate.js';
import { securityEvent } from './monitor.js';

/* ---------------- Rate limiting (Phase 4, layer 3) ----------------
 * Keyed per signed-in user where there is a valid token, otherwise per IP. Backed by Redis when
 * REDIS_URL is set, so every instance shares one count. Responses are 429 with Retry-After and
 * RateLimit headers (IETF draft-7).
 */
function keyOf(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) {
    try { const p = jwt.verify(h.slice(7), JWT_SECRET); if (p.sub) return `u:${p.sub}`; } catch { /* fall back to IP */ }
  }
  return `ip:${req.ip}`;
}

export function limiter(name, max, windowMin, { byIp = false, message } = {}) {
  const r = redis();
  return rateLimit({
    windowMs: windowMin * 60_000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: byIp ? (req) => `ip:${req.ip}` : keyOf,
    store: r ? new RedisStore({ sendCommand: (...args) => r.sendCommand(args), prefix: `rl:${name}:` }) : undefined,
    message: { error: message || 'Too many requests. Please wait a few minutes and try again.', code: 'rate_limited' },
    validate: { trustProxy: false, xForwardedForHeader: false },
  });
}

/* ---------------- Bot defence (Phase 4, layer 2) ----------------
 * Cloudflare Turnstile (invisible/managed challenge) on sign-up, sign-in, driver applications,
 * enquiries and booking. On when TURNSTILE_SECRET_KEY is set; the website reads the site key from
 * /api/security/config. Native apps (Phase 5) will use Play Integrity / App Attest instead.
 */
export const turnstileOn = () => Boolean(process.env.TURNSTILE_SECRET_KEY);
export function botCheck() {
  return async (req, _res, next) => {
    if (!turnstileOn()) return next();
    try {
      const token = String(req.body?.turnstileToken || req.get('cf-turnstile-response') || '');
      if (!token) throw new HttpError(400, 'Please complete the security check and try again.');
      const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: req.ip });
      const res = await fetch(process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        securityEvent('bot_check_failed', { path: req.path, codes: (data['error-codes'] || []).join(',') }, 'info');
        throw new HttpError(400, 'The security check failed. Please refresh the page and try again.');
      }
      next();
    } catch (err) {
      if (err instanceof HttpError) { err.code = 'bot_check'; return next(err); }
      next(); // Cloudflare unreachable: fail open rather than block every customer
    }
  };
}

/* ---------------- Maintenance mode (incident response) ----------------
 * MAINTENANCE_MODE=on (or the admin switch) returns 503 to customers while staff can still sign in
 * and work. Payment provider callbacks are always accepted so no payment is lost.
 */
export const maintenanceOn = () => String(process.env.MAINTENANCE_MODE || '').toLowerCase() === 'on' || Boolean(settings().maintenance?.on);
const STAFF = ['admin', 'compliance', 'support', 'finance'];
export function maintenance(req, res, next) {
  if (!maintenanceOn()) return next();
  if (/^\/api\/(health|company|app\/config|maps\/config|security\/config|auth\/(login|mfa|refresh|logout|me)|payments\/paystack\/webhook|paymentology\/remote)/.test(req.originalUrl)) return next();
  const h = req.get('authorization') || '';
  try {
    const p = h.startsWith('Bearer ') ? jwt.verify(h.slice(7), JWT_SECRET) : null;
    if (p && STAFF.includes(p.role)) return next();
  } catch { /* not staff */ }
  res.setHeader('Retry-After', '600');
  res.status(503).json({ error: settings().maintenance?.message || 'DROP is down for a short maintenance break. Please try again in a few minutes.', code: 'maintenance' });
}

/* ---------------- Idempotency keys (booking, checkout, withdrawals) ----------------
 * Clients send `Idempotency-Key: <uuid>` per user action. A retry or double tap with the same key
 * gets the first response back (header Idempotent-Replay: true) instead of a second booking or
 * withdrawal; a retry while the first is still running gets 409.
 */
export function idempotent() {
  return async (req, res, next) => {
    const raw = req.get('idempotency-key');
    if (!raw) return next();
    if (!/^[\w-]{8,80}$/.test(raw)) return next(new HttpError(400, 'Invalid Idempotency-Key.'));
    const k = `idem:${keyOf(req)}:${req.method}:${req.originalUrl.split('?')[0]}:${raw}`;
    const cached = await kv.get(k);
    if (cached) {
      const c = JSON.parse(cached);
      if (c.pending) return next(Object.assign(new HttpError(409, 'This request is still being processed.'), { code: 'in_progress' }));
      res.set('Idempotent-Replay', 'true');
      return res.status(c.status).json(c.body);
    }
    if (!(await kv.setNx(k, JSON.stringify({ pending: true }), 120))) return next(Object.assign(new HttpError(409, 'This request is still being processed.'), { code: 'in_progress' }));
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 500 && res.statusCode !== 429) void kv.set(k, JSON.stringify({ status: res.statusCode, body }), 24 * 3600);
      else void kv.del(k);
      return json(body);
    };
    next();
  };
}
