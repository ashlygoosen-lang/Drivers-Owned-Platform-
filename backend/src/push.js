import { db, id, now } from './db.js';
import { log } from './monitor.js';

/**
 * Push notifications to the DROP Passenger and DROP Driver apps through the Expo push service,
 * which delivers through FCM (Android) and APNs (iOS). The apps register their Expo push token at
 * sign-in (POST /api/devices). Tokens the stores report as invalid are removed automatically.
 * EXPO_ACCESS_TOKEN (optional) enables Expo's enhanced push security, so only DROP's server can
 * send to DROP's apps.
 */
const ENDPOINT = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

export function registerDevice(userId, { token, platform, app }) {
  const existing = db.find('devices', (d) => d.token === token);
  if (existing) return db.update('devices', existing.id, { userId, platform, app, lastSeenAt: now(), disabled: false });
  return db.insert('devices', { id: id(), userId, token, platform, app, createdAt: now(), lastSeenAt: now() });
}
export function removeDevice(token, userId) {
  const list = db.all('devices');
  const i = list.findIndex((d) => d.token === token && (!userId || d.userId === userId));
  if (i >= 0) { list.splice(i, 1); db.save(); }
}
export function removeUserDevices(userId) {
  const list = db.all('devices');
  const keep = list.filter((d) => d.userId !== userId);
  if (keep.length !== list.length) { list.splice(0, list.length, ...keep); db.save(); }
}
export const hasDevices = (userId) => db.all('devices').some((d) => d.userId === userId && !d.disabled);

/**
 * Send a push to every device of a user. `data.type` tells the app what to open
 * (trip, message, call, verification, wallet). Calls use the time-sensitive priority so they ring.
 */
export async function pushTo(userId, { title, body, data = {}, priority = 'default', ttl = 3600, sound = 'default', channelId = 'default' }) {
  const devices = db.filter('devices', (d) => d.userId === userId && !d.disabled);
  if (!devices.length || process.env.PUSH === 'off') return { sent: 0 };
  const messages = devices.map((d) => ({ to: d.token, title, body, data, sound, priority: priority === 'call' ? 'high' : priority, ttl, channelId: priority === 'call' ? 'calls' : channelId, ...(priority === 'call' && { interruptionLevel: 'time-sensitive' }) }));
  try {
    const res = await fetch(ENDPOINT(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN && { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }) },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8000),
    });
    const out = await res.json().catch(() => ({}));
    (out.data || []).forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') removeDevice(messages[i].to);
    });
    return { sent: messages.length };
  } catch (err) {
    log('warn', 'push failed', { error: err.message });
    return { sent: 0 };
  }
}
