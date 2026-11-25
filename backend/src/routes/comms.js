import { Router } from 'express';
import { db, id, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { notify, audit } from '../kyc.js';
import { str, oneOf, wrap, bad, HttpError } from '../validate.js';
import { issueTicket, redeemTicket, subscribe, emit, isOnline } from '../comms/hub.js';
import { phoneMode, e164, bridgeCall, iceServers } from '../comms/phone.js';
import { pushTo, hasDevices } from '../push.js';

/**
 * Driver ↔ passenger communication for a trip: chat, in-app voice and video calls (WebRTC, signalled
 * through the server), and phone calls on registered numbers. Only the two people on the trip can use
 * it, from the moment a driver accepts until COMMS_WINDOW_HOURS after the trip ends (for lost items).
 */
const router = Router();
const ACTIVE = ['accepted', 'arriving', 'in_progress'];
const STAFF_READ = ['admin', 'support'];
const windowHours = () => Number(process.env.COMMS_WINDOW_HOURS ?? 2);
const RING_MS = 40_000;

export function commsOpen(b) {
  if (!b.driverId) return false;
  if (ACTIVE.includes(b.status)) return true;
  if (b.status === 'completed') {
    const done = Date.parse(b.completedAt || b.updatedAt || 0);
    return Date.now() - done < windowHours() * 3_600_000;
  }
  return false;
}

/** The booking plus who is on each side, for one of its two participants. */
function party(req, { staff = false } = {}) {
  const b = db.find('bookings', (x) => x.id === req.params.id || x.ref === req.params.id);
  const u = req.user;
  if (!b) throw new HttpError(404, 'Trip not found.');
  const side = b.userId === u.id ? 'passenger' : b.driverId === u.id ? 'driver' : null;
  if (!side && !(staff && STAFF_READ.includes(u.role))) throw new HttpError(404, 'Trip not found.');
  const otherId = side === 'passenger' ? b.driverId : side === 'driver' ? b.userId : null;
  const other = otherId ? db.find('users', (x) => x.id === otherId) : null;
  return { b, side, other };
}

function requireOpen(b) {
  if (!commsOpen(b)) {
    throw bad(b.driverId ? 'Messaging and calls close a little while after the trip ends. For anything else, contact DROP support.' : 'You can message and call once a driver accepts your trip.');
  }
}

const firstName = (n = '') => n.split(' ')[0] || 'DROP';
const shape = (m, viewerId) => ({ id: m.id, bookingId: m.bookingId, from: m.senderId === viewerId ? 'me' : m.senderRole, senderName: m.senderName, kind: m.kind, text: m.text, createdAt: m.createdAt, readAt: m.readAt || null });

// Simple per-user message rate limit.
const recent = new Map();
function throttle(userId, max = 20) {
  const t = Date.now();
  const list = (recent.get(userId) || []).filter((x) => t - x < 60_000);
  if (list.length >= max) throw new HttpError(429, 'You are sending messages very quickly. Please wait a moment.');
  list.push(t);
  recent.set(userId, list);
}

const lastPing = new Map();
function pushOrNotify(userId, booking, title, body) {
  if (isOnline(userId)) return;
  const key = `${userId}:${booking.id}`;
  if (Date.now() - (lastPing.get(key) || 0) < 5 * 60_000) return;
  lastPing.set(key, Date.now());
  notify(userId, title, body, 'trips', { push: false }); // chat pushes are sent per message
}

function system(b, text) {
  const m = db.insert('messages', { id: id(), bookingId: b.id, senderId: null, senderRole: 'system', senderName: 'DROP', kind: 'system', text, createdAt: now() });
  for (const uid of [b.userId, b.driverId].filter(Boolean)) emit(uid, 'message', shape(m, uid));
  return m;
}

/* ---------- configuration and live stream ---------- */

router.get('/comms/config', requireAuth, (req, res) => {
  res.json({ iceServers: iceServers(req.user.id), phone: phoneMode(), windowHours: windowHours(), ringSeconds: RING_MS / 1000 });
});

router.post('/comms/ticket', requireAuth, (req, res) => res.json({ ticket: issueTicket(req.user.id) }));

router.get('/comms/stream', (req, res) => {
  const userId = redeemTicket(req.query.ticket);
  const user = userId && db.find('users', (u) => u.id === userId && !u.disabled);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  subscribe(user.id, req, res);
});

/** Trips the signed-in user can talk on right now (for the notification badge and quick access). */
router.get('/comms/threads', requireAuth, (req, res) => {
  const mine = db.filter('bookings', (b) => (b.userId === req.user.id || b.driverId === req.user.id) && commsOpen(b));
  res.json({
    threads: mine.map((b) => {
      const msgs = db.filter('messages', (m) => m.bookingId === b.id);
      const otherId = b.userId === req.user.id ? b.driverId : b.userId;
      const other = db.find('users', (u) => u.id === otherId);
      return { bookingId: b.id, ref: b.ref, status: b.status, with: firstName(other?.name), unread: msgs.filter((m) => m.senderId && m.senderId !== req.user.id && !m.readAt).length, last: msgs.at(-1) ? shape(msgs.at(-1), req.user.id) : null };
    }),
  });
});

/* ---------- messages ---------- */

router.get('/bookings/:id/messages', requireAuth, wrap(async (req, res) => {
  const { b, side, other } = party(req, { staff: true });
  if (!side) audit(req.user, 'trip_messages_viewed', b.userId, { booking: b.ref });
  const messages = db.filter('messages', (m) => m.bookingId === b.id).map((m) => shape(m, req.user.id));
  const calls = db.filter('calls', (c) => c.bookingId === b.id).map((c) => ({ id: c.id, kind: c.kind, status: c.status, by: c.callerId === req.user.id ? 'me' : 'them', durationSec: c.durationSec || 0, createdAt: c.createdAt }));
  res.json({
    messages, calls, open: commsOpen(b), side, phone: phoneMode(),
    with: other ? { name: firstName(other.name), role: side === 'passenger' ? 'driver' : 'passenger', online: isOnline(other.id) } : null,
  });
}));

router.post('/bookings/:id/messages', requireAuth, wrap(async (req, res) => {
  const { b, side, other } = party(req);
  requireOpen(b);
  throttle(req.user.id);
  const text = str(req.body?.text, 'Message', { max: 1000 });
  const m = db.insert('messages', { id: id(), bookingId: b.id, senderId: req.user.id, senderRole: side, senderName: firstName(req.user.name), kind: 'text', text, createdAt: now() });
  emit(other.id, 'message', shape(m, other.id));
  pushOrNotify(other.id, b, `New message from ${firstName(req.user.name)}`, `${b.ref}: ${text.slice(0, 120)}`);
  if (!isOnline(other.id)) void pushTo(other.id, { title: firstName(req.user.name), body: text.slice(0, 140), data: { type: 'message', bookingId: b.id } });
  res.status(201).json({ message: shape(m, req.user.id) });
}));

router.post('/bookings/:id/messages/read', requireAuth, wrap(async (req, res) => {
  const { b, other } = party(req);
  const at = now();
  let n = 0;
  for (const m of db.filter('messages', (x) => x.bookingId === b.id && x.senderId && x.senderId !== req.user.id && !x.readAt)) { m.readAt = at; n++; }
  if (n) { db.save(); if (other) emit(other.id, 'read', { bookingId: b.id, at }); }
  res.json({ read: n });
}));

/* ---------- in-app voice and video calls ---------- */

const live = new Map(); // callId -> { timer }

function endCall(call, status, byId) {
  const t = live.get(call.id);
  if (t) { clearTimeout(t.timer); live.delete(call.id); }
  const durationSec = call.answeredAt ? Math.round((Date.now() - Date.parse(call.answeredAt)) / 1000) : 0;
  const updated = db.update('calls', call.id, { status, endedAt: now(), endedBy: byId || null, durationSec });
  for (const uid of [call.callerId, call.calleeId]) emit(uid, 'call:ended', { callId: call.id, bookingId: call.bookingId, status, by: byId === uid ? 'me' : 'them', durationSec });
  const b = db.find('bookings', (x) => x.id === call.bookingId);
  const label = call.kind === 'video' ? 'Video call' : 'Voice call';
  if (status === 'missed' || status === 'declined') {
    system(b, `${status === 'missed' ? 'Missed' : 'Declined'} ${label.toLowerCase()}`);
    if (status === 'missed') notify(call.calleeId, `Missed ${label.toLowerCase()}`, `${call.callerName} tried to reach you about ${b.ref}.`, 'trips');
  } else if (status === 'completed') {
    system(b, `${label} · ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`);
  }
  return updated;
}

function loadCall(req) {
  const call = db.find('calls', (c) => c.id === req.params.callId);
  if (!call || ![call.callerId, call.calleeId].includes(req.user.id)) throw new HttpError(404, 'Call not found.');
  return call;
}

router.post('/bookings/:id/calls', requireAuth, wrap(async (req, res) => {
  const { b, side, other } = party(req);
  requireOpen(b);
  const kind = oneOf(req.body?.kind || 'audio', ['audio', 'video'], 'Call type');
  // Clear calls left ringing or connected for too long (e.g. a closed tab).
  for (const c of db.filter('calls', (x) => x.bookingId === b.id && ['ringing', 'connected'].includes(x.status))) {
    if (!live.has(c.id) || Date.now() - Date.parse(c.createdAt) > 4 * 3_600_000) endCall(c, c.status === 'ringing' ? 'missed' : 'completed');
    else throw new HttpError(409, 'There is already a call on this trip.');
  }
  if (!isOnline(other.id) && !hasDevices(other.id)) {
    system(b, `${firstName(req.user.name)} tried to ${kind === 'video' ? 'video call' : 'call'}. ${side === 'passenger' ? 'Your driver' : 'Your passenger'} was offline, so we sent a notification.`);
    notify(other.id, `Missed ${kind === 'video' ? 'video call' : 'call'}`, `${firstName(req.user.name)} tried to reach you about ${b.ref}. Open DROP to reply.`, 'trips');
    throw new HttpError(409, `${side === 'passenger' ? 'Your driver' : 'Your passenger'} is not in the DROP app right now. We’ve let them know. You can send a message${phoneMode() !== 'off' ? ' or phone them' : ''}.`);
  }
  const call = db.insert('calls', { id: id(), bookingId: b.id, kind, callerId: req.user.id, calleeId: other.id, callerName: firstName(req.user.name), status: 'ringing', createdAt: now() });
  live.set(call.id, { timer: setTimeout(() => { const c = db.find('calls', (x) => x.id === call.id); if (c?.status === 'ringing') endCall(c, 'missed'); }, RING_MS) });
  emit(other.id, 'call:ring', { callId: call.id, bookingId: b.id, ref: b.ref, kind, from: firstName(req.user.name), fromRole: side });
  // The other person's phone app may be in the background: ring it with a time-sensitive push.
  void pushTo(other.id, { title: `${firstName(req.user.name)} is ${kind === 'video' ? 'video ' : ''}calling`, body: `DROP trip ${b.ref}. Tap to answer.`, data: { type: 'call', callId: call.id, bookingId: b.id, kind, from: firstName(req.user.name) }, priority: 'call', ttl: 40, sound: 'default' });
  res.status(201).json({ call: { id: call.id, kind, status: call.status, with: firstName(other.name) } });
}));

/** State of a call, for an app opened from a "calling" push notification. */
router.get('/calls/:callId', requireAuth, wrap(async (req, res) => {
  const c = loadCall(req);
  res.json({ call: { id: c.id, bookingId: c.bookingId, kind: c.kind, status: c.status, from: c.callerName, incoming: c.calleeId === req.user.id } });
}));

router.post('/calls/:callId/accept', requireAuth, wrap(async (req, res) => {
  const call = loadCall(req);
  if (call.calleeId !== req.user.id || call.status !== 'ringing') throw new HttpError(409, 'This call has ended.');
  const t = live.get(call.id);
  if (t) clearTimeout(t.timer);
  live.set(call.id, { timer: null });
  db.update('calls', call.id, { status: 'connected', answeredAt: now() });
  emit(call.callerId, 'call:accepted', { callId: call.id });
  res.json({ ok: true });
}));

router.post('/calls/:callId/decline', requireAuth, wrap(async (req, res) => {
  const call = loadCall(req);
  if (call.status === 'ringing') endCall(call, call.calleeId === req.user.id ? 'declined' : 'cancelled', req.user.id);
  res.json({ ok: true });
}));

router.post('/calls/:callId/end', requireAuth, wrap(async (req, res) => {
  const call = loadCall(req);
  if (call.status === 'ringing') endCall(call, call.callerId === req.user.id ? 'cancelled' : 'declined', req.user.id);
  else if (call.status === 'connected') endCall(call, 'completed', req.user.id);
  res.json({ ok: true });
}));

/** WebRTC offer / answer / ICE candidates, relayed to the other person on the call. */
router.post('/calls/:callId/signal', requireAuth, wrap(async (req, res) => {
  const call = loadCall(req);
  if (!['ringing', 'connected'].includes(call.status)) throw new HttpError(409, 'This call has ended.');
  const signal = req.body?.signal;
  if (!signal || !['offer', 'answer', 'ice', 'state'].includes(signal.type)) throw bad('Invalid call signal.');
  if (JSON.stringify(signal).length > 20_000) throw bad('Call signal too large.');
  const to = call.callerId === req.user.id ? call.calleeId : call.callerId;
  emit(to, 'call:signal', { callId: call.id, signal });
  res.json({ ok: true });
}));

/* ---------- phone calls on registered numbers ---------- */

router.post('/bookings/:id/phone', requireAuth, wrap(async (req, res) => {
  const { b, side, other } = party(req);
  requireOpen(b);
  const mode = phoneMode();
  if (mode === 'off') throw bad('Phone calls are switched off. Please use an in-app voice call.');
  const to = e164(other.phone);
  if (!to) throw bad(`${side === 'passenger' ? 'Your driver' : 'Your passenger'} has no registered number. Please send a message or use an in-app call.`);
  if (mode === 'direct') {
    db.insert('calls', { id: id(), bookingId: b.id, kind: 'phone', callerId: req.user.id, calleeId: other.id, callerName: firstName(req.user.name), status: 'dialled', createdAt: now() });
    return res.json({ mode, dial: to });
  }
  const from = e164(req.user.phone);
  if (!from) throw bad('Add your mobile number in your profile first. DROP rings that number to connect your call.');
  throttle(`${req.user.id}:phone`, 4);
  try {
    const providerId = await bridgeCall({ from, to, ref: b.ref });
    db.insert('calls', { id: id(), bookingId: b.id, kind: 'phone', callerId: req.user.id, calleeId: other.id, callerName: firstName(req.user.name), status: 'bridged', providerId, createdAt: now() });
    system(b, `${firstName(req.user.name)} started a phone call through DROP`);
    res.json({ mode, ringing: `•••• ${from.slice(-4)}` });
  } catch (err) {
    console.error('[drop] phone bridge failed', err.message);
    res.status(502).json({ error: err.expose || 'We could not place the call right now. Please try again.' });
  }
}));

/** When a trip closes, end any call still running and post a note in the chat. */
export function onTripStatus(b) {
  for (const c of db.filter('calls', (x) => x.bookingId === b.id && ['ringing', 'connected'].includes(x.status))) {
    if (['cancelled', 'requested'].includes(b.status)) endCall(c, c.status === 'ringing' ? 'missed' : 'completed');
  }
  for (const uid of [b.userId, b.driverId].filter(Boolean)) emit(uid, 'trip', { bookingId: b.id, status: b.status });
  if (!b.driverId) return;
  const note = { accepted: 'Driver assigned. You can message and call each other here. Your numbers stay private.', arriving: 'Driver on the way to the pickup.', in_progress: 'Trip started.', completed: `Trip complete. This chat stays open for ${windowHours()} hours in case anything was left behind.`, cancelled: 'This trip was cancelled.' }[b.status];
  if (note) system(b, note);
}

export default router;
