import crypto from 'node:crypto';

/**
 * Phone calls between driver and passenger, on the numbers they registered with DROP.
 *
 * masked (Twilio configured): DROP rings the caller's registered number, then connects them to the
 *   other person's registered number. Both people see the DROP number, never each other's.
 * direct: the app opens the phone dialler with the other person's registered number, shown only
 *   while the trip is open.
 * off: no phone calls; in-app voice and video still work.
 */
const env = (k, d = '') => (process.env[k] ?? d).trim();

export function twilioConfigured() {
  return Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM_NUMBER'));
}

export function phoneMode() {
  const m = env('PHONE_CALLS').toLowerCase();
  if (m === 'off') return 'off';
  if (m === 'direct') return 'direct';
  if (m === 'masked') return twilioConfigured() ? 'masked' : 'off';
  return twilioConfigured() ? 'masked' : 'direct';
}

/** South African local numbers (0821234567) to E.164 (+27821234567). */
export function e164(raw) {
  let n = String(raw || '').replace(/[^\d+]/g, '');
  if (!n) return '';
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (n.startsWith('0')) n = `+27${n.slice(1)}`;
  if (!n.startsWith('+')) n = `+${n}`;
  return /^\+\d{9,15}$/.test(n) ? n : '';
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** Ask Twilio to ring `from`, then bridge to `to`. Returns the provider call id. */
export async function bridgeCall({ from, to, ref }) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const caller = env('TWILIO_FROM_NUMBER');
  const limit = Number(env('PHONE_CALL_MAX_SECONDS', '1800')) || 1800;
  const twiml = `<Response><Say>Connecting your DROP trip ${xml(ref.replace(/-/g, ' '))}. Please hold.</Say><Dial callerId="${xml(caller)}" timeLimit="${limit}" timeout="30">${xml(to)}</Dial></Response>`;
  const body = new URLSearchParams({ To: from, From: caller, Twiml: twiml });
  const base = env('TWILIO_API_BASE', 'https://api.twilio.com').replace(/\/$/, '');
  const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Twilio ${res.status}: ${data.message || 'call failed'}`);
    err.status = 502;
    err.expose = 'We could not place the call right now. Please try again, or use an in-app voice call.';
    throw err;
  }
  return data.sid || '';
}

/** Short-lived TURN credentials (coturn "use-auth-secret" / TURN REST API). */
export function iceServers(userId) {
  const list = [];
  const stun = env('STUN_URLS', 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) list.push({ urls: stun });
  const turn = env('TURN_URLS').split(',').map((s) => s.trim()).filter(Boolean);
  if (turn.length) {
    if (env('TURN_SECRET')) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
      const credential = crypto.createHmac('sha1', env('TURN_SECRET')).update(username).digest('base64');
      list.push({ urls: turn, username, credential });
    } else {
      list.push({ urls: turn, username: env('TURN_USERNAME'), credential: env('TURN_CREDENTIAL') });
    }
  }
  return list;
}
