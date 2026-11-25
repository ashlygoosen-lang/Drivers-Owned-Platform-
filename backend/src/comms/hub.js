import crypto from 'node:crypto';
import * as kv from '../kv.js';
import { instanceId } from '../db.js';

/**
 * Real-time event hub (Server-Sent Events). Each signed-in browser tab holds one stream; events are
 * pushed to every stream a user has open. In-memory, so it suits the single-service deployment.
 * To run several API instances, replace emit() with a Redis pub/sub fan-out.
 */
const streams = new Map(); // userId -> Set<res>


/** EventSource cannot send an Authorization header, so the browser swaps its token for a one-use, 60-second ticket. */
export async function issueTicket(userId) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  await kv.set(`ticket:${ticket}`, userId, 60);
  return ticket;
}

export async function redeemTicket(ticket) {
  const key = `ticket:${String(ticket || '').slice(0, 64)}`;
  const userId = await kv.get(key);
  if (userId) await kv.del(key); // one use only
  return userId || null;
}

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.flush?.(); // compression middleware buffers otherwise
}

export function subscribe(userId, req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);
  void kv.set(presenceKey(userId), instanceId, 40);
  write(res, 'ready', { at: new Date().toISOString() });
  const beat = setInterval(() => { res.write(': keep-alive\n\n'); res.flush?.(); }, 25_000);
  req.on('close', () => {
    clearInterval(beat);
    const set = streams.get(userId);
    set?.delete(res);
    if (set && !set.size) {
      streams.delete(userId);
      void kv.get(`online:${userId}`).then((v) => (v === instanceId ? kv.del(`online:${userId}`) : null)).catch(() => undefined);
    }
  });
}

function deliver(userId, event, data) {
  for (const res of streams.get(userId) || []) write(res, event, data);
}
/** Send an event to a user on whichever server their app is connected to. */
export function emit(userId, event, data) {
  deliver(userId, event, data);
  if (kv.redis()) void kv.publish('drop:events', JSON.stringify({ o: instanceId, u: userId, e: event, d: data })).catch(() => undefined);
}
void kv.subscribe('drop:events', (msg) => {
  try { const m = JSON.parse(msg); if (m.o !== instanceId) deliver(m.u, m.e, m.d); } catch { /* ignore */ }
});
/** Users with an open stream on any server (Redis), or on this one. */
const presenceKey = (userId) => `online:${userId}`;
export async function isOnlineAnywhere(userId) { return isOnline(userId) || Boolean(await kv.get(presenceKey(userId))); }
setInterval(() => { for (const uid of streams.keys()) void kv.set(presenceKey(uid), instanceId, 40); }, 20_000).unref();

export const isOnline = (userId) => Boolean(streams.get(userId)?.size);

