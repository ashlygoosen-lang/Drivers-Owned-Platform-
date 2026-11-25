import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStaff } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-test-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_EMAIL = 'admin@drop.test';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.FRONTEND_DIST = path.join(dir, 'no-frontend');
process.env.FILE_ENCRYPTION_KEY = 'test-key';

const { createApp, seedAdmin } = await import('../src/app.js');
const { KYC_DIR } = await import('../src/kyc.js');
const { db } = await import('../src/db.js');
let server, base;

before(async () => {
  await (await import('../src/db.js')).initDb(); await seedAdmin();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
  return { status: res.status, data: await res.json() };
}

/** Build a valid South African ID number (Luhn check digit) for a date of birth. */
function saId(yymmdd, serial = '5009087') {
  const partial = yymmdd + serial.slice(0, 6);
  for (let c = 0; c < 10; c++) {
    const n = partial + c;
    let sum = 0;
    for (let i = 0; i < 13; i++) { let d = Number(n[12 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    if (sum % 10 === 0) return n;
  }
}

const PDF = Buffer.from('%PDF-1.4\n% test document\n');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function uploadDoc(token, type, { file = PDF, mime = 'application/pdf', name = 'doc.pdf', expiresAt, issuedAt } = {}) {
  const form = new FormData();
  form.append('type', type);
  if (expiresAt) form.append('expiresAt', expiresAt);
  if (issuedAt) form.append('issuedAt', issuedAt);
  form.append('file', new Blob([file], { type: mime }), name);
  return call('POST', '/verification/documents', { token, form });
}

const profile = (over = {}) => ({ legalName: 'Lerato Mokoena', idType: 'sa_id', idNumber: saId('900101'), nationality: 'South African', addressLine1: '12 Long Street', suburb: 'City Centre', city: 'Cape Town', province: 'Western Cape', postalCode: '8001', ...over });

test('passenger: must verify before booking; documents are encrypted and reviewed', async () => {
  const reg = await call('POST', '/auth/register', { body: { name: 'Lerato M', email: 'lerato@example.com', password: 'Passw0rd!', phone: '+27821234567' } });
  assert.equal(reg.status, 201);
  const p = reg.data.token;
  const trip = { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', passengers: 1 };

  const blocked = await call('POST', '/bookings', { token: p, body: trip });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'verification_required');

  // Profile validation
  assert.equal((await call('PUT', '/verification/profile', { token: p, body: profile({ idNumber: '9001015009080' }) })).status, 400, 'bad Luhn rejected');
  const prof = await call('PUT', '/verification/profile', { token: p, body: profile() });
  assert.equal(prof.status, 200, JSON.stringify(prof.data));
  assert.equal(prof.data.verification.profile.dateOfBirth, '1990-01-01');
  assert.match(prof.data.verification.profile.idNumber, /^•+\d{4}$/, 'ID number masked for the owner view');

  // Uploads: content sniffing and proof-of-address age
  assert.equal((await uploadDoc(p, 'id_document', { file: Buffer.from('not a pdf'), name: 'x.pdf' })).status, 400);
  assert.equal((await uploadDoc(p, 'proof_of_address', { issuedAt: day(-120) })).status, 400);
  assert.equal((await uploadDoc(p, 'id_document')).status, 201);
  assert.equal((await uploadDoc(p, 'proof_of_address', { issuedAt: day(-10) })).status, 201);
  const stored = fs.readdirSync(KYC_DIR);
  assert.ok(stored.length >= 2 && !fs.readFileSync(path.join(KYC_DIR, stored[0])).includes('%PDF'), 'stored encrypted');

  assert.equal((await call('POST', '/verification/submit', { token: p, body: {} })).status, 400, 'consent required');
  const sub = await call('POST', '/verification/submit', { token: p, body: { consent: true } });
  assert.equal(sub.data.verification.status, 'submitted');

  // Booking allowed while under review (default PASSENGER_VERIFICATION=submitted)
  const book = await call('POST', '/bookings', { token: p, body: trip });
  assert.equal(book.status, 201, JSON.stringify(book.data));

  // Compliance officer created by admin reviews
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  assert.equal((await createStaff(call, admin, { name: 'Nomsa C', email: 'nomsa@drop.test', role: 'compliance', password: 'Compliance1' })).status, 201);
  const c = (await call('POST', '/auth/login', { body: { email: 'nomsa@drop.test', password: 'Compliance1' } })).data.token;
  assert.equal((await call('GET', '/admin/staff', { token: c })).status, 403, 'compliance cannot manage staff');

  const queue = await call('GET', '/compliance/queue', { token: c });
  const item = queue.data.queue.find((q) => q.email === 'lerato@example.com');
  assert.ok(item);
  const file = await call('GET', `/compliance/verifications/${item.userId}`, { token: c });
  assert.equal(file.data.verification.profile.idNumber, saId('900101'), 'staff see the full number');
  const [idDoc, poa] = file.data.verification.documents;

  const raw = await fetch(`${base}/verification/documents/${idDoc.id}/file`, { headers: { authorization: `Bearer ${c}` } });
  assert.equal(raw.status, 200);
  assert.ok(Buffer.from(await raw.arrayBuffer()).subarray(0, 5).toString() === '%PDF-', 'decrypted for staff');
  const other = (await call('POST', '/auth/register', { body: { name: 'Other Person', email: 'other@example.com', password: 'Passw0rd!' } })).data.token;
  assert.equal((await fetch(`${base}/verification/documents/${idDoc.id}/file`, { headers: { authorization: `Bearer ${other}` } })).status, 404, 'not visible to other users');

  // Reject proof of address → action required → user re-uploads → approve all
  await call('POST', `/compliance/documents/${idDoc.id}/review`, { token: c, body: { decision: 'approved' } });
  const rej = await call('POST', `/compliance/documents/${poa.id}/review`, { token: c, body: { decision: 'rejected', reason: 'The name on the bill does not match.' } });
  assert.equal(rej.data.verification.status, 'action_required');
  const notes = await call('GET', '/notifications', { token: p });
  assert.ok(notes.data.notifications.some((n) => /needs attention/.test(n.title)));
  assert.equal((await call('POST', `/compliance/verifications/${item.userId}/decision`, { token: c, body: { decision: 'approve' } })).status, 400, 'cannot approve with rejected doc');
  await uploadDoc(p, 'proof_of_address', { issuedAt: day(-5) });
  const again = await call('GET', `/compliance/verifications/${item.userId}`, { token: c });
  assert.equal(again.data.verification.status, 'submitted');
  const poa2 = again.data.verification.documents.find((d) => d.type === 'proof_of_address');
  await call('POST', `/compliance/documents/${poa2.id}/review`, { token: c, body: { decision: 'approved' } });
  const ok = await call('POST', `/compliance/verifications/${item.userId}/decision`, { token: c, body: { decision: 'approve' } });
  assert.equal(ok.data.verification.status, 'verified');
  assert.equal((await call('GET', '/auth/me', { token: p })).data.user.verificationStatus, 'verified');
  const log = await call('GET', '/compliance/audit', { token: c });
  assert.ok(log.data.entries.some((e) => e.action === 'verification.approved'));
});

test('driver: apply, verify documents with expiry, go online, complete a trip', async () => {
  const apply = await call('POST', '/drivers/apply', { body: { name: 'Thabo N', email: 'thabo@example.com', phone: '0821112222', password: 'Driver123', vehicle: 'Toyota Corolla · CA 123-456', vehicleYear: 2019, consent: true } });
  assert.equal(apply.status, 201, JSON.stringify(apply.data));
  const d = apply.data.token;

  const off = await call('POST', '/drivers/online', { token: d, body: { online: true } });
  assert.equal(off.status, 403);
  assert.equal(off.data.code, 'verification_required');

  assert.equal((await call('PUT', '/verification/profile', { token: d, body: profile({ legalName: 'Thabo Nkosi', idNumber: saId('880505', '5123085') }) })).status, 400, 'drivers need an emergency contact');
  assert.equal((await call('PUT', '/verification/profile', { token: d, body: profile({ legalName: 'Thabo Nkosi', idNumber: saId('880505', '5123085'), emergencyName: 'Zanele N', emergencyPhone: '0829998888' }) })).status, 200);

  assert.equal((await uploadDoc(d, 'drivers_licence', { expiresAt: day(-1) })).status, 400, 'expired licence rejected');
  assert.equal((await uploadDoc(d, 'selfie')).status, 400, 'selfie must be an image');
  for (const [type, opts] of [['id_document', {}], ['proof_of_address', { issuedAt: day(-3) }], ['selfie', { file: JPG, mime: 'image/jpeg', name: 's.jpg' }], ['drivers_licence', { expiresAt: day(900) }], ['prdp', { expiresAt: day(20) }], ['vehicle_registration', { expiresAt: day(200) }], ['vehicle_insurance', { expiresAt: day(300) }]]) {
    const r = await uploadDoc(d, type, opts);
    assert.equal(r.status, 201, `${type}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await call('POST', '/verification/submit', { token: d, body: { consent: true } })).data.verification.status, 'submitted');

  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const app = (await call('GET', '/admin/applications', { token: admin })).data.applications[0];
  assert.equal((await call('PATCH', `/admin/applications/${app.id}`, { token: admin, body: { status: 'approved' } })).status, 400, 'documents first');

  const me = (await call('GET', '/auth/me', { token: d })).data.user;
  const file = await call('GET', `/compliance/verifications/${me.id}`, { token: admin });
  for (const doc of file.data.verification.documents) await call('POST', `/compliance/documents/${doc.id}/review`, { token: admin, body: { decision: 'approved' } });
  const v = await call('POST', `/compliance/verifications/${me.id}/decision`, { token: admin, body: { decision: 'approve' } });
  assert.equal(v.data.verification.status, 'verified');

  // PrDP expires in 20 days → appears on the expiring list
  const exp = await call('GET', '/compliance/expiring', { token: admin });
  assert.ok(exp.data.documents.some((x) => x.type === 'prdp'));

  assert.equal((await call('POST', '/drivers/online', { token: d, body: { online: true } })).status, 200);
  const reqs = await call('GET', '/drivers/requests', { token: d });
  assert.ok(reqs.data.requests.length >= 1);
  const bookingId = reqs.data.requests[0].id;
  assert.equal((await call('POST', `/drivers/bookings/${bookingId}/accept`, { token: d })).status, 200);
  for (const s of ['arriving', 'in_progress', 'completed']) assert.equal((await call('POST', `/drivers/bookings/${bookingId}/advance`, { token: d })).data.booking.status, s);
  const dash = await call('GET', '/dashboard', { token: d });
  assert.equal(dash.data.stats.find((s) => s.label === 'Completed trips').value, 1);
});

test('stakeholder dashboards and access control', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  await createStaff(call, admin, { name: 'Sipho S', email: 'sipho@drop.test', role: 'support', password: 'Support123' });
  const s = (await call('POST', '/auth/login', { body: { email: 'sipho@drop.test', password: 'Support123' } })).data.token;
  assert.equal((await call('GET', '/admin/tickets', { token: s })).status, 200);
  assert.equal((await call('GET', '/admin/users', { token: s })).status, 200);
  assert.equal((await call('GET', '/compliance/queue', { token: s })).status, 403, 'support cannot see ID documents');
  assert.equal((await call('PATCH', '/admin/users/x', { token: s, body: {} })).status, 403);
  for (const t of [admin, s]) assert.ok((await call('GET', '/dashboard', { token: t })).data.stats.length >= 4);
  const p = (await call('POST', '/auth/login', { body: { email: 'lerato@example.com', password: 'Passw0rd!' } })).data.token;
  assert.equal((await call('GET', '/compliance/queue', { token: p })).status, 403);
  assert.equal((await call('POST', '/enquiries', { body: { topic: 'Business solutions', name: 'Acme', email: 'ops@acme.co.za', message: 'We need staff transport.' } })).status, 201);
});

test('staff are invited and choose their own password (SEC-020)', async () => {
  const admin = (await call('POST', '/auth/login', { body: { email: 'admin@drop.test', password: 'AdminPass123' } })).data.token;
  const r = await call('POST', '/admin/staff', { token: admin, body: { name: 'Invited Person', email: 'invited@drop.test', role: 'support', password: 'IgnoredPass1' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.invitePending, true);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'invited@drop.test', password: 'IgnoredPass1' } })).status, 401, 'an admin-supplied password is ignored');
  const first = new URL(r.data.invite.url).searchParams.get('token');
  const again = await call('POST', `/admin/staff/${r.data.user.id}/invite`, { token: admin });
  assert.equal(again.status, 200);
  assert.equal((await call('POST', '/auth/password/reset', { body: { token: first, newPassword: 'MyOwnPass77' } })).status, 400, 'a re-sent invitation cancels the old link');
  const second = new URL(again.data.invite.url).searchParams.get('token');
  const set = await call('POST', '/auth/password/reset', { body: { token: second, newPassword: 'MyOwnPass77' } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal((await call('POST', '/auth/login', { body: { email: 'invited@drop.test', password: 'MyOwnPass77' } })).status, 200);
  assert.equal((await call('POST', `/admin/staff/${r.data.user.id}/invite`, { token: admin })).status, 400, 'no new invitation once the password is set');
});
