import * as kv from '../kv.js';
import { db } from '../db.js';

/**
 * Live driver locations: the hottest data in the system (one fix every ~4 seconds per online driver).
 * They live in Redis (shared by all servers), or memory without Redis, and are copied to the
 * driver's record at most once a minute, so GPS traffic never floods the main database.
 */
const HASH = 'drop:locations';
const local = new Map(); // userId -> location (this server's latest copy)
const persistedAt = new Map();

export async function setLocation(userId, loc) {
  local.set(userId, loc);
  await kv.hset(HASH, userId, JSON.stringify(loc));
  if (Date.now() - (persistedAt.get(userId) || 0) > 60_000) {
    persistedAt.set(userId, Date.now());
    db.update('users', userId, { location: loc });
  }
}

export async function getLocation(userId) {
  const raw = await kv.hget(HASH, userId).catch(() => null);
  if (raw) { try { return JSON.parse(raw); } catch { /* fall through */ } }
  return local.get(userId) || db.byId('users', userId)?.location || null;
}

export async function allLocations() {
  const out = new Map();
  for (const [k, v] of Object.entries(await kv.hgetall(HASH).catch(() => ({})))) { try { out.set(k, JSON.parse(v)); } catch { /* skip */ } }
  for (const [k, v] of local) if (!out.has(k)) out.set(k, v);
  return out;
}

export async function clearLocation(userId) { local.delete(userId); await kv.hdel(HASH, userId); }
