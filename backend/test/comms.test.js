import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { makeClient, verifiedPassenger, verifiedDriver } from './helpers.js';

/* ---- Stand-in Twilio API ---- */
const twilioCalls = [];
const twilio = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Basic ${Buffer.from('AC_test:tw_secret').toString('base64')}`) { res.statusCode = 401; return res.end('{"message":"auth"}'); }
    twilioCalls.push(Object.fromEntries(new URLSearchParams(body)));
    res.statusCode = 201; res.end(JSON.stringify({ sid: `CA${twilioCalls.length}` }));
  });
});
await new Promise((r) => twilio.listen(0, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-comms-'));
Object.assign(process.env, {
  DATA_DIR: dir, ADMIN_EMAIL: 'admin@drop.test', ADMIN_PASSWORD: 'AdminPass123', FRONTEND_DIST: path.join(dir, 'none'), FILE_ENCRYPTION_KEY: 'k',
  DEMO_MODE: 'false', PHONE_CALLS: 'direct',
});

const { createApp, seedAdmin } = await import('../src/app.js');
const { db } = await import('../src/db.js');
let server, base;
const call = makeClient(() => base);
before(async () => { await seedAdmin(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.closeAllConnections(); server.close(); twilio.close(); await db.flush(); fs.rmSync(dir, { recursive: true, force: true }); });

/** Open the live event stream for a user and collect events. */
async function stream(token) {
  const { ticket } = (await call('POST', '/comms/ticket', { token })).data;
  const ctrl = new AbortController();
  const res = await fetch(`${base}/comms/stream?ticket=${ticket}`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  const events = [];
  const waiters = [];
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) { events.push({ event: ev, data: JSON.parse(data) }); waiters.splice(0).forEach((w) => w()); }
        }
      }
    } catch { /* aborted */ }
  })();
  const next = async (name, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = events.findIndex((e) => e.event === name);
      if (i >= 0) return events.splice(i, 1)[0].data;
      if (Date.now() > end) throw new Error(`no ${name} event`);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 100); });
    }
  };
  await next('ready');
  return { next, close: () => ctrl.abort(), events };
}

test('driver and passenger chat, call each other in the app, and phone on registered numbers', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const p = await verifiedPassenger(call, admin, 'pat@example.com');
  const d = await verifiedDriver(call, admin, 'dee@example.com');
  const outsider = await verifiedPassenger(call, admin, 'olly@example.com', '910202', '5009087');

  const b = (await call('POST', '/bookings', { token: p.token, body: { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'Sea Point', passengers: 1, payment: 'Cash' } })).data.booking;
  assert.equal(b.comms, false);
  let r = await call('POST', `/bookings/${b.id}/messages`, { token: p.token, body: { text: 'hello?' } });
  assert.equal(r.status, 400, 'no chat before a driver accepts');
  assert.equal(b.driver, null);

  const ps = await stream(p.token);
  const ds = await stream(d.token);
  await call('POST', '/drivers/online', { token: d.token, body: { online: true } });
  const accepted = (await call('POST', `/drivers/bookings/${b.id}/accept`, { token: d.token })).data.booking;
  assert.equal(accepted.comms, true);
  assert.equal(accepted.passenger.phone, '+27821234567', 'direct mode shares the registered number while the trip is open');
  assert.equal((await ps.next('trip')).status, 'accepted');
  assert.match((await ps.next('message')).text, /Driver assigned/);
  assert.match((await ds.next('message')).text, /Driver assigned/);

  // Chat
  r = await call('POST', `/bookings/${b.id}/messages`, { token: p.token, body: { text: 'I am at the main gate' } });
  assert.equal(r.status, 201);
  const got = await ds.next('message');
  assert.equal(got.text, 'I am at the main gate');
  assert.equal(got.from, 'passenger');
  await call('POST', `/bookings/${b.id}/messages/read`, { token: d.token });
  assert.equal((await ps.next('read')).bookingId, b.id);
  r = await call('GET', `/bookings/${b.id}/messages`, { token: p.token });
  assert.equal(r.data.with.role, 'driver');
  assert.ok(r.data.messages.find((m) => m.text === 'I am at the main gate' && m.from === 'me' && m.readAt));

  // Strangers can't read or post; support can read (and it is audited)
  assert.equal((await call('GET', `/bookings/${b.id}/messages`, { token: outsider.token })).status, 404);
  assert.equal((await call('POST', `/bookings/${b.id}/messages`, { token: outsider.token, body: { text: 'hi' } })).status, 404);
  assert.equal((await call('GET', `/bookings/${b.id}/messages`, { token: admin })).status, 200);
  assert.ok(db.find('audit', (a) => a.action === 'trip_messages_viewed'));

  // In-app video call with WebRTC signalling relayed
  r = await call('POST', `/bookings/${b.id}/calls`, { token: d.token, body: { kind: 'video' } });
  assert.equal(r.status, 201);
  const callId = r.data.call.id;
  const ring = await ps.next('call:ring');
  assert.equal(ring.kind, 'video');
  assert.equal((await call('POST', `/bookings/${b.id}/calls`, { token: p.token, body: { kind: 'audio' } })).status, 409, 'one call at a time');
  await call('POST', `/calls/${callId}/accept`, { token: p.token });
  await ds.next('call:accepted');
  await call('POST', `/calls/${callId}/signal`, { token: d.token, body: { signal: { type: 'offer', sdp: 'v=0 fake' } } });
  assert.equal((await ps.next('call:signal')).signal.sdp, 'v=0 fake');
  await call('POST', `/calls/${callId}/signal`, { token: p.token, body: { signal: { type: 'answer', sdp: 'v=0 ans' } } });
  assert.equal((await ds.next('call:signal')).signal.type, 'answer');
  assert.equal((await call('POST', `/calls/${callId}/signal`, { token: outsider.token, body: { signal: { type: 'ice' } } })).status, 404);
  await call('POST', `/calls/${callId}/end`, { token: p.token });
  assert.equal((await ds.next('call:ended')).status, 'completed');
  assert.equal((await ps.next('call:ended')).by, 'me');
  assert.equal(db.find('calls', (c) => c.id === callId).status, 'completed');

  // Declined voice call
  const c2 = (await call('POST', `/bookings/${b.id}/calls`, { token: p.token, body: { kind: 'audio' } })).data.call.id;
  await ds.next('call:ring');
  await call('POST', `/calls/${c2}/decline`, { token: d.token });
  assert.equal((await ps.next('call:ended')).status, 'declined');

  // Calling someone who is offline becomes a notification
  ds.close();
  await new Promise((res) => setTimeout(res, 150));
  r = await call('POST', `/bookings/${b.id}/calls`, { token: p.token, body: { kind: 'audio' } });
  assert.equal(r.status, 409);
  assert.ok(db.find('notifications', (n) => n.userId === d.id && /Missed call/.test(n.title)));

  // Phone, direct mode: returns the registered number to dial
  r = await call('POST', `/bookings/${b.id}/phone`, { token: p.token });
  assert.equal(r.data.mode, 'direct');
  assert.equal(r.data.dial, '+27821112222');

  // Phone, masked mode via Twilio: rings the caller, bridges to the other number; numbers stay hidden
  Object.assign(process.env, { PHONE_CALLS: '', TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'tw_secret', TWILIO_FROM_NUMBER: '+27870000000', TWILIO_API_BASE: `http://127.0.0.1:${twilio.address().port}` });
  r = await call('GET', `/bookings/${b.id}`, { token: p.token });
  assert.equal(r.data.booking.driver.phone, '', 'masked mode never shows the driver number');
  r = await call('POST', `/bookings/${b.id}/phone`, { token: d.token });
  assert.equal(r.data.mode, 'masked');
  assert.equal(r.data.dial, undefined);
  assert.equal(twilioCalls[0].To, '+27821112222');
  assert.equal(twilioCalls[0].From, '+27870000000');
  assert.match(twilioCalls[0].Twiml, /<Dial callerId="\+27870000000"[^>]*>\+27821234567<\/Dial>/);

  // After the trip, chat stays open for the lost-items window, then closes
  for (let i = 0; i < 3; i++) await call('POST', `/drivers/bookings/${b.id}/advance`, { token: d.token });
  assert.equal((await call('POST', `/bookings/${b.id}/messages`, { token: p.token, body: { text: 'Left my umbrella' } })).status, 201);
  db.update('bookings', b.id, { completedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() });
  assert.equal((await call('POST', `/bookings/${b.id}/messages`, { token: p.token, body: { text: 'hello?' } })).status, 400);
  assert.equal((await call('GET', `/bookings/${b.id}`, { token: p.token })).data.booking.driver.phone, '');
  ps.close();
});
