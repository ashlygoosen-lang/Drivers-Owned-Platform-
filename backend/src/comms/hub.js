import crypto from 'node:crypto';

/**
 * Real-time event hub (Server-Sent Events). Each signed-in browser tab holds one stream; events are
 * pushed to every stream a user has open. In-memory, so it suits the single-service deployment.
 * To run several API instances, replace emit() with a Redis pub/sub fan-out.
 */
const streams = new Map(); // userId -> Set<res>
const tickets = new Map(); // ticket -> { userId, exp }

/** EventSource cannot send an Authorization header, so the browser swaps its token for a one-use, 60-second ticket. */
export function issueTicket(userId) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, { userId, exp: Date.now() + 60_000 });
  return ticket;
}

export function redeemTicket(ticket) {
  const t = tickets.get(String(ticket || ''));
  tickets.delete(String(ticket || ''));
  if (!t || t.exp < Date.now()) return null;
  return t.userId;
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
  write(res, 'ready', { at: new Date().toISOString() });
  const beat = setInterval(() => { res.write(': keep-alive\n\n'); res.flush?.(); }, 25_000);
  req.on('close', () => {
    clearInterval(beat);
    const set = streams.get(userId);
    set?.delete(res);
    if (set && !set.size) streams.delete(userId);
  });
}

export function emit(userId, event, data) {
  for (const res of streams.get(userId) || []) write(res, event, data);
}

export const isOnline = (userId) => Boolean(streams.get(userId)?.size);

setInterval(() => { const t = Date.now(); for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k); }, 60_000).unref();
