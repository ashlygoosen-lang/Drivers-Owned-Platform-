/**
 * DROP identity verification (KYC).
 *
 * - Which documents each role must provide, and which details.
 * - South African ID number validation (date of birth + Luhn checksum).
 * - Encrypted document storage: files are AES-256-GCM encrypted at rest and only decrypted
 *   for the owner or verification staff.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, JWT_SECRET, IS_PROD } from './config.js';
import { db, id, now } from './db.js';
import { bad } from './validate.js';

export const DOC_TYPES = {
  id_document: { label: 'Identity document', hint: 'Green ID book, smart ID card (both sides) or the photo page of your passport.', expires: false },
  proof_of_address: { label: 'Proof of address', hint: 'Utility bill, bank statement, lease or municipal account in your name, dated within the last 3 months.', expires: false, maxAgeDays: 90 },
  selfie: { label: 'Selfie holding your ID', hint: 'A clear, well-lit photo of your face next to your identity document.', expires: false, imageOnly: true },
  drivers_licence: { label: 'Driving licence', hint: 'Valid South African driving licence card (front and back).', expires: true },
  prdp: { label: 'Professional Driving Permit (PrDP)', hint: 'PrDP category P, required to carry passengers for reward.', expires: true },
  vehicle_registration: { label: 'Vehicle registration / licence disc', hint: 'Registration certificate (RC1) or a current licence disc for the vehicle you will drive.', expires: true },
  vehicle_insurance: { label: 'Vehicle insurance', hint: 'Insurance schedule showing passenger liability cover for e-hailing use.', expires: true },
  roadworthy: { label: 'Roadworthy certificate', hint: 'Recommended. Valid roadworthy certificate for the vehicle.', expires: true },
  operating_licence: { label: 'E-hailing operating licence', hint: 'Recommended. Provincial operating licence or proof of application.', expires: true },
  police_clearance: { label: 'Police clearance certificate', hint: 'Recommended. SAPS clearance certificate issued within the last 6 months.', expires: false },
  company_registration: { label: 'Company registration (CIPC)', hint: 'CIPC registration certificate (CoR14.3) for the business.', expires: false },
};

export const REQUIREMENTS = {
  passenger: { required: ['id_document', 'proof_of_address'], optional: [] },
  driver: { required: ['id_document', 'proof_of_address', 'selfie', 'drivers_licence', 'prdp', 'vehicle_registration', 'vehicle_insurance'], optional: ['roadworthy', 'operating_licence', 'police_clearance'] },
  business: { required: ['id_document', 'proof_of_address', 'company_registration'], optional: [] },
};

export const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

/** South African ID: YYMMDD SSSS C A Z — valid date and Luhn checksum. Returns the date of birth (YYYY-MM-DD). */
export function checkSaId(value) {
  const n = String(value || '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(n)) throw bad('A South African ID number has 13 digits.');
  const yy = Number(n.slice(0, 2)), mm = Number(n.slice(2, 4)), dd = Number(n.slice(4, 6));
  const thisYY = new Date().getFullYear() % 100;
  const year = yy > thisYY ? 1900 + yy : 2000 + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) throw bad('That ID number does not contain a valid date of birth.');
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let digit = Number(n[12 - i]);
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  if (sum % 10 !== 0) throw bad('That ID number is not valid. Please check it and try again.');
  return d.toISOString().slice(0, 10);
}

/** Show only the last 4 characters of an ID or passport number. */
export const mask = (v) => (v ? `${'•'.repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}` : '');

/* ---------------- Encrypted storage ---------------- */
if (IS_PROD && !process.env.FILE_ENCRYPTION_KEY) {
  console.warn('[drop] FILE_ENCRYPTION_KEY is not set. Documents are encrypted with a key derived from JWT_SECRET; set a dedicated key and keep it safe.');
}
const KEY = crypto.createHash('sha256').update(process.env.FILE_ENCRYPTION_KEY || `drop-files:${JWT_SECRET}`).digest();
export const KYC_DIR = path.join(UPLOAD_DIR, 'kyc');
fs.mkdirSync(KYC_DIR, { recursive: true });

const MAGIC = [
  { type: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];

/** Identify a file by its content, not its name. */
export function sniff(buffer) {
  return MAGIC.find((m) => m.test(buffer)) || null;
}

export function storeEncrypted(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const name = `${crypto.randomUUID()}.bin`;
  fs.writeFileSync(path.join(KYC_DIR, name), Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
  return name;
}

export function readDecrypted(name) {
  if (!/^[0-9a-f-]{36}\.bin$/.test(name)) throw bad('Invalid file.');
  const raw = fs.readFileSync(path.join(KYC_DIR, name));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12), { authTagLength: 16 });
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

export function removeFile(name) {
  if (/^[0-9a-f-]{36}\.bin$/.test(name || '')) fs.promises.unlink(path.join(KYC_DIR, name)).catch(() => {});
}

/** Encrypt short sensitive text (e.g. bank account numbers) for storage. */
export function encryptText(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv, { authTagLength: 16 });
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
export function decryptText(b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12), { authTagLength: 16 });
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/* ---------------- Identity numbers at rest (SEC-008) ----------------
 * ID / passport numbers are stored encrypted (idNumberEnc), with a keyed hash (idNumberHash) for the
 * duplicate-ID check and a masked copy for display. Only compliance review and card issuing decrypt them.
 */
const ID_HASH_KEY = crypto.createHmac('sha256', KEY).update('drop:id-number-hash').digest();
export const idHash = (n) => crypto.createHmac('sha256', ID_HASH_KEY).update(String(n).toUpperCase()).digest('hex');
export function sealIdNumber(profile, idNumber) {
  const { idNumber: _plain, ...rest } = profile; // eslint-disable-line no-unused-vars
  return { ...rest, idNumberEnc: encryptText(idNumber), idNumberHash: idHash(idNumber), idNumberMasked: mask(idNumber) };
}
export function revealIdNumber(profile = {}) {
  if (profile.idNumberEnc) return decryptText(profile.idNumberEnc);
  return profile.idNumber || '';
}
/** One-off migration of any plain-text ID numbers already stored. Safe to run on every start. */
export function migrateIdNumbers() {
  let n = 0;
  for (const v of db.all('verifications')) if (v.profile?.idNumber) { v.profile = sealIdNumber(v.profile, v.profile.idNumber); n++; }
  if (n) { db.save(); console.log(`[drop] Encrypted ${n} stored identity number(s).`); }
  return n;
}

/* ---------------- Records ---------------- */
export function requirementsFor(role) {
  return REQUIREMENTS[role] || null;
}

export function getVerification(userId, create = true) {
  let v = db.find('verifications', (x) => x.userId === userId);
  if (!v && create) {
    const user = db.find('users', (u) => u.id === userId);
    v = db.insert('verifications', { id: id(), userId, role: user?.role, profile: {}, documents: [], status: 'not_started', consentAt: null, submittedAt: null, decidedAt: null, history: [], createdAt: now() });
  }
  return v;
}

/** Current (non-archived) document of each type. */
export const currentDocs = (v) => v.documents.filter((d) => !d.archived);

/**
 * Work out the overall status from the documents. Marks documents past their expiry date as expired.
 * Returns true if something changed.
 */
export function recompute(v) {
  const before = JSON.stringify([v.status, v.documents.map((d) => d.status)]);
  const req = requirementsFor(v.role) || { required: [], optional: [] };
  const today = new Date().toISOString().slice(0, 10);
  for (const d of currentDocs(v)) {
    if (d.status === 'approved' && d.expiresAt && d.expiresAt < today) { d.status = 'expired'; d.reason = 'This document has expired. Please upload a current one.'; }
  }
  const docs = currentDocs(v);
  const byType = Object.fromEntries(docs.map((d) => [d.type, d]));
  const required = req.required.map((t) => byType[t]);
  const relevant = docs.filter((d) => req.required.includes(d.type) || req.optional.includes(d.type));
  let status;
  if (!docs.length && !Object.keys(v.profile || {}).length) status = 'not_started';
  else if (relevant.some((d) => d.status === 'rejected' || d.status === 'expired')) status = 'action_required';
  else if (v.changesRequested && !v.submittedAt) status = 'action_required';
  else if (v.submittedAt && required.every((d) => d?.status === 'approved') && v.decision === 'approved') status = 'verified';
  else if (v.submittedAt) status = 'submitted';
  else status = 'in_progress';
  v.status = status;
  const changed = before !== JSON.stringify([v.status, v.documents.map((d) => d.status)]);
  if (changed) {
    db.update('verifications', v.id, { status: v.status, documents: v.documents });
    syncUser(v);
  }
  return changed;
}

/** Mirror the verification status onto the user, and switch drivers on or off. */
export function syncUser(v) {
  const user = db.find('users', (u) => u.id === v.userId);
  if (!user) return;
  const patch = { verificationStatus: v.status };
  if (user.role === 'driver') {
    if (v.status === 'verified' && user.driverStatus !== 'suspended') patch.driverStatus = 'approved';
    if (v.status !== 'verified') { patch.online = false; if (user.driverStatus === 'approved') patch.driverStatus = 'pending'; }
  }
  db.update('users', user.id, patch);
}

export function notify(userId, title, body, link = 'verification') {
  db.insert('notifications', { id: id(), userId, title, body, link, read: false, createdAt: now() });
}

/**
 * Append-only, hash-chained audit log (SEC-013). Each entry stores the hash of the previous one, so
 * editing or deleting any past entry breaks the chain, which verifyAuditChain() and the daily
 * check report.
 */
const auditHash = (e) => crypto.createHash('sha256').update(JSON.stringify([e.prevHash, e.id, e.actorId, e.actorRole, e.action, e.subjectId, e.detail, e.at])).digest('hex');
export function audit(actor, action, subjectId, detail = {}) {
  const list = db.all('audit');
  const prev = list.at(-1);
  const e = { id: id(), actorId: actor?.id || 'system', actorName: actor?.name || 'System', actorRole: actor?.role || 'system', action, subjectId, detail: Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, String(v)])), at: now(), prevHash: prev?.hash || 'genesis' };
  e.hash = auditHash(e);
  db.insert('audit', e);
  return e;
}
export function verifyAuditChain() {
  let prev = null;
  let legacy = 0;
  for (const [i, e] of db.all('audit').entries()) {
    if (!e.hash) { legacy++; prev = null; continue; } // entries written before chaining existed
    if (prev !== null && e.prevHash !== prev) return { ok: false, brokenAt: i, id: e.id, legacy };
    if (auditHash(e) !== e.hash) return { ok: false, brokenAt: i, id: e.id, legacy };
    prev = e.hash;
  }
  return { ok: true, entries: db.all('audit').length, legacy };
}

/** Profile completeness rules per role. */
export function missingProfile(role, p = {}) {
  const need = ['legalName', 'idType', 'idNumber', 'dateOfBirth', 'nationality', 'addressLine1', 'city', 'province', 'postalCode'];
  if (role === 'driver') need.push('emergencyName', 'emergencyPhone');
  if (role === 'business') need.push('companyName', 'registrationNumber');
  return need.filter((k) => (k === 'idNumber' ? !(p.idNumberEnc || p.idNumber) : !p[k]));
}
