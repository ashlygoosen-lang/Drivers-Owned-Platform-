import crypto from 'node:crypto';
import { db, id, now } from './db.js';

/**
 * Monitoring and detection (Phase 4, layer 7).
 * - Structured JSON request logs: no bodies, no query strings, no tokens; IP addresses are hashed.
 * - Security events are stored (latest 5,000), logged, and sent to ALERT_WEBHOOK_URL (Slack, Teams or
 *   any webhook that accepts {"text": "..."}) when severe or when a threshold is crossed.
 * - Spike detection: failed sign-ins, 5xx errors and 429s are counted in 5-minute windows.
 * - Optional error tracking: set SENTRY_DSN and install @sentry/node.
 */
const LOG = String(process.env.LOG_REQUESTS || 'on').toLowerCase() !== 'off';
const ipHash = (ip) => crypto.createHash('sha256').update(`drop-ip:${ip || ''}`).digest('hex').slice(0, 12);
export const log = (level, msg, fields = {}) => { if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ t: now(), level, msg, ...fields })); };

const THRESHOLDS = { login_failed: 50, server_error: 20, rate_limited: 200, mfa_failed: 20 }; // per 5 minutes
const windows = new Map(); // type -> { start, count, alerted }
function count(type) {
  const w = windows.get(type) || { start: Date.now(), count: 0, alerted: false };
  if (Date.now() - w.start > 5 * 60_000) Object.assign(w, { start: Date.now(), count: 0, alerted: false });
  w.count += 1;
  windows.set(type, w);
  if (THRESHOLDS[type] && w.count >= THRESHOLDS[type] && !w.alerted) {
    w.alerted = true;
    securityEvent(`${type}_spike`, { count: String(w.count), window: '5 min' }, 'high');
  }
}

let lastAlert = 0;
async function alert(text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || Date.now() - lastAlert < 10_000) return;
  lastAlert = Date.now();
  try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) }); } catch { /* best effort */ }
}

/** Record a security-relevant event. severity: info | medium | high */
export function securityEvent(type, detail = {}, severity = 'info') {
  const e = { id: id(), type, severity, detail, at: now() };
  db.insert('securityEvents', e);
  const list = db.all('securityEvents');
  if (list.length > 5500) { const cut = list[list.length - 5000].at; db.remove('securityEvents', (x) => x.at < cut); }
  log(severity === 'high' ? 'warn' : 'info', `security.${type}`, { severity, ...detail });
  if (severity === 'high') void alert(`DROP security alert: ${type} ${JSON.stringify(detail)}`);
  if (['login_failed', 'mfa_failed', 'rate_limited', 'server_error'].includes(type)) count(type);
  return e;
}

/** Counted only (not stored individually) to avoid flooding the event log. */
export const countOnly = (type) => count(type);

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  req.id = req.get('x-request-id')?.slice(0, 64) || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  res.on('finish', () => {
    if (res.statusCode === 429) countOnly('rate_limited');
    if (res.statusCode >= 500) countOnly('server_error');
    const urlPath = req.originalUrl.split('?')[0]; // req.path is rewritten inside mounted routers
    if (!LOG || !urlPath.startsWith('/api') || urlPath === '/api/health' || urlPath === '/api/comms/stream') return;
    log(res.statusCode >= 500 ? 'error' : 'info', 'http', {
      id: req.id, method: req.method, path: req.route ? req.baseUrl + req.route.path : urlPath.replace(/[0-9a-f-]{36}/g, ':id'),
      status: res.statusCode, ms: Number((process.hrtime.bigint() - start) / 1_000_000n), ip: ipHash(req.ip), user: req.user?.id?.slice(0, 8) || undefined,
    });
  });
  next();
}

let sentry = null;
export async function initErrorTracking() {
  if (!process.env.SENTRY_DSN) return;
  try {
    sentry = await import('@sentry/node');
    sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, tracesSampleRate: 0.05, sendDefaultPii: false });
    log('info', 'Error tracking enabled');
  } catch { log('warn', 'SENTRY_DSN is set but @sentry/node is not installed'); }
}
export function reportError(err, req) {
  log('error', err.message, { id: req?.id, path: req?.path, stack: err.stack?.split('\n').slice(0, 4).join(' | ') });
  sentry?.captureException(err);
}
