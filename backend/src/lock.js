import crypto from 'node:crypto';
import { db, catchUp, instanceId } from './db.js';
import { redis } from './kv.js';
import * as kv from './kv.js';

/**
 * Critical sections that must be correct across every app instance (money movements, card
 * authorisations). With Redis the lock is shared by all instances (SET NX PX with a token, released
 * only by its owner); without Redis it is a per-process mutex, which is correct for a single instance.
 * Inside the lock, queued writes are flushed and other instances' committed writes pulled in first,
 * so the code sees the latest data.
 */
const local = new Map(); // key -> Promise chain

async function acquireRedis(r, key, token, ttlMs, waitMs) {
  const end = Date.now() + waitMs;
  let delay = 10;
  while (Date.now() < end) {
    if ((await r.set(`lock:${key}`, token, { NX: true, PX: ttlMs })) === 'OK') return true;
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 2, 100);
  }
  return false;
}
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export async function withLock(key, fn, { ttlMs = 15_000, waitMs = 10_000 } = {}) {
  const r = redis();
  if (r) {
    const token = `${instanceId}:${crypto.randomUUID()}`;
    if (!(await acquireRedis(r, key, token, ttlMs, waitMs))) { const e = new Error('The system is busy. Please try again.'); e.status = 503; throw e; }
    try { await db.flush(); await catchUp(); const out = await fn(); await db.flush(); return out; }
    finally { await r.eval(RELEASE, { keys: [`lock:${key}`], arguments: [token] }).catch(() => undefined); }
  }
  const prev = local.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((res) => { release = res; });
  local.set(key, prev.then(() => mine));
  await prev;
  try { await db.flush(); await catchUp(); return await fn(); }
  finally { release(); if (local.get(key) === mine) local.delete(key); }
}

/** One instance runs scheduled jobs (simulator, reconciliation, backups): a renewable leader lease. */
let leader = false;
export const isLeader = () => leader;
export function startLeaderElection(onChange) {
  const tick = async () => {
    const r = redis();
    if (!r) { if (!leader) { leader = true; onChange?.(true); } return; }
    const ok = (await r.set('drop:leader', instanceId, { NX: true, PX: 30_000 }).catch(() => null)) === 'OK'
      || ((await r.get('drop:leader').catch(() => null)) === instanceId && (await r.pExpire('drop:leader', 30_000).catch(() => 0)));
    if (Boolean(ok) !== leader) { leader = Boolean(ok); onChange?.(leader); }
  };
  void tick();
  const t = setInterval(() => { void tick(); }, 10_000);
  t.unref();
  return t;
}
export { kv };
