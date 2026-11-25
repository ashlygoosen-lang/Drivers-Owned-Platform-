/** Shared test helpers: API calls, valid SA ID numbers, document uploads and verified accounts. */
export function makeClient(getBase) {
  return async function call(method, url, { token, body, form, raw, headers: extra } = {}) {
    const headers = { ...(extra || {}) };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(getBase() + url, { method, headers, body: raw ?? form ?? (body && JSON.stringify(body)) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  };
}

export function saId(yymmdd, serial = '5009087') {
  const partial = yymmdd + serial.slice(0, 6);
  for (let c = 0; c < 10; c++) {
    const n = partial + c;
    let sum = 0;
    for (let i = 0; i < 13; i++) { let d = Number(n[12 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    if (sum % 10 === 0) return n;
  }
}

export const PDF = Buffer.from('%PDF-1.4\n% test\n');
export const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export async function upload(call, token, type, { file = PDF, mime = 'application/pdf', name = 'doc.pdf', expiresAt, issuedAt } = {}) {
  const form = new FormData();
  form.append('type', type);
  if (expiresAt) form.append('expiresAt', expiresAt);
  if (issuedAt) form.append('issuedAt', issuedAt);
  form.append('file', new Blob([file], { type: mime }), name);
  return call('POST', '/verification/documents', { token, form });
}

const profile = (name, idNumber, extra = {}) => ({ legalName: name, idType: 'sa_id', idNumber, nationality: 'South African', addressLine1: '1 Main Road', city: 'Cape Town', province: 'Western Cape', postalCode: '8001', ...extra });

async function approveAll(call, adminToken, userId) {
  const file = await call('GET', `/compliance/verifications/${userId}`, { token: adminToken });
  for (const d of file.data.verification.documents) await call('POST', `/compliance/documents/${d.id}/review`, { token: adminToken, body: { decision: 'approved' } });
  const r = await call('POST', `/compliance/verifications/${userId}/decision`, { token: adminToken, body: { decision: 'approve' } });
  if (r.data.verification?.status !== 'verified') throw new Error(`verification failed: ${JSON.stringify(r.data)}`);
}

export async function verifiedPassenger(call, adminToken, email, yymmdd = '900101', serial = '5009087') {
  const reg = await call('POST', '/auth/register', { body: { name: 'Pat Passenger', email, password: 'Passw0rd!', phone: '+27821234567' } });
  const t = reg.data.token;
  await call('PUT', '/verification/profile', { token: t, body: profile('Pat Passenger', saId(yymmdd, serial)) });
  await upload(call, t, 'id_document');
  await upload(call, t, 'proof_of_address', { issuedAt: day(-5) });
  await call('POST', '/verification/submit', { token: t, body: { consent: true } });
  await approveAll(call, adminToken, reg.data.user.id);
  return { token: t, id: reg.data.user.id };
}

export async function verifiedDriver(call, adminToken, email, yymmdd = '880505', serial = '5123085') {
  const a = await call('POST', '/drivers/apply', { body: { name: 'Dee Driver', email, phone: '0821112222', password: 'Driver123', vehicle: 'Toyota Corolla · CA 1', vehicleYear: 2019, consent: true } });
  const t = a.data.token;
  await call('PUT', '/verification/profile', { token: t, body: profile('Dee Driver', saId(yymmdd, serial), { emergencyName: 'Kin', emergencyPhone: '0829998888' }) });
  for (const [type, o] of [['id_document', {}], ['proof_of_address', { issuedAt: day(-3) }], ['selfie', { file: JPG, mime: 'image/jpeg', name: 's.jpg' }], ['drivers_licence', { expiresAt: day(900) }], ['prdp', { expiresAt: day(400) }], ['vehicle_registration', { expiresAt: day(200) }], ['vehicle_insurance', { expiresAt: day(300) }]]) await upload(call, t, type, o);
  await call('POST', '/verification/submit', { token: t, body: { consent: true } });
  await approveAll(call, adminToken, a.data.user.id);
  return { token: t, id: a.data.user.id };
}

/** Staff are invited, not given a password (SEC-020): create the account, then accept the invitation as them. */
export async function createStaff(call, adminToken, { name, email, role, password }) {
  const r = await call('POST', '/admin/staff', { token: adminToken, body: { name, email, role } });
  if (r.status !== 201) return r;
  const token = new URL(r.data.invite.url).searchParams.get('token');
  const set = await call('POST', '/auth/password/reset', { body: { token, newPassword: password } });
  return { ...r, accepted: set };
}
