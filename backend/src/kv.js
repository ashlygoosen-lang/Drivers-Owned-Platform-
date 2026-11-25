import { createClient } from 'redis';

/**
 * Shared key-value store for rate limits, sign-in lockouts and (Phase 6) booking holds and
 * idempotency keys. Uses Redis when REDIS_URL is set, so limits hold across every app instance and
 * survive deploys; otherwise falls back to process memory (fine for a single instance and tests).
 */
let client = null;
let ready = false;

export async function initKv() {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(n * 200, 5000), connectTimeout: 5000 } });
  client.on('error', (err) => { if (ready) console.warn('[drop] redis:', err.message); });
  client.on('ready', () => { ready = true; });
  client.on('end', () => { ready = false; });
  try { await client.connect(); ready = true; console.log('[drop] Connected to Redis'); return true; }
  catch (err) { console.warn('[drop] Redis unavailable, using in-memory limits:', err.message); client = null; return false; }
}
export const redis = () => (ready ? client : null);

/* ---- in-memory fallback ---- */
const mem = new Map(); // key -> { v, exp }
const alive = (k) => { const e = mem.get(k); if (!e) return null; if (e.exp && e.exp < Date.now()) { mem.delete(k); return null; } return e; };
setInterval(() => { const t = Date.now(); for (const [k, e] of mem) if (e.exp && e.exp < t) mem.delete(k); }, 60_000).unref();

/** Increment a counter that expires ttlSec after it was first created. Returns the new value. */
export async function incr(key, ttlSec) {
  const r = redis();
  if (r) {
    const [n] = await r.multi().incr(key).expire(key, ttlSec, 'NX').exec();
    return Number(n);
  }
  const e = alive(key) || { v: 0, exp: Date.now() + ttlSec * 1000 };
  e.v += 1; mem.set(key, e);
  return e.v;
}

export async function get(key) {
  const r = redis();
  if (r) return r.get(key);
  return alive(key)?.v ?? null;
}

export async function set(key, value, ttlSec) {
  const r = redis();
  if (r) return ttlSec ? r.set(key, String(value), { EX: ttlSec }) : r.set(key, String(value));
  mem.set(key, { v: String(value), exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}

/** Set only if absent (atomic). Returns true when this call created it. */
export async function setNx(key, value, ttlSec) {
  const r = redis();
  if (r) return (await r.set(key, String(value), { NX: true, EX: ttlSec })) === 'OK';
  if (alive(key)) return false;
  mem.set(key, { v: String(value), exp: Date.now() + ttlSec * 1000 });
  return true;
}

export async function del(key) {
  const r = redis();
  if (r) return r.del(key);
  mem.delete(key);
}

export async function ttl(key) {
  const r = redis();
  if (r) return r.ttl(key);
  const e = alive(key);
  return e?.exp ? Math.ceil((e.exp - Date.now()) / 1000) : -1;
}
