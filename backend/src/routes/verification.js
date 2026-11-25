import { Router } from 'express';
import * as history from '../history.js';
import multer from 'multer';
import { db, id, now } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import {
  DOC_TYPES, PROVINCES, requirementsFor, getVerification, currentDocs, recompute, missingProfile,
  checkSaId, sniff, storeEncrypted, readDecrypted, removeFile, mask, sealIdNumber, revealIdNumber, idHash,
} from '../kyc.js';
import { str, phone, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();
export const STAFF = ['admin', 'compliance'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/** What the owner (or staff) sees. ID numbers are masked except for staff reviewing the file. */
export function present(v, { reveal = false } = {}) {
  const req = requirementsFor(v.role) || { required: [], optional: [] };
  const { idNumberEnc, idNumberHash, idNumberMasked, ...profile } = v.profile || {}; // eslint-disable-line no-unused-vars
  const full = revealIdNumber(v.profile);
  if (full) profile.idNumber = reveal ? full : idNumberMasked || mask(full);
  return {
    id: v.id,
    userId: v.userId,
    role: v.role,
    status: v.status,
    profile,
    missingProfile: missingProfile(v.role, v.profile),
    documents: currentDocs(v).map(({ file, ...d }) => d),
    history: v.history || [],
    consentAt: v.consentAt,
    submittedAt: v.submittedAt,
    decidedAt: v.decidedAt,
    decisionNote: v.decisionNote || '',
    requirements: [...req.required.map((t) => ({ type: t, required: true })), ...req.optional.map((t) => ({ type: t, required: false }))]
      .map((r) => ({ ...r, ...DOC_TYPES[r.type] })),
  };
}

function own(req) {
  if (!requirementsFor(req.user.role)) throw new HttpError(403, 'Staff accounts do not need verification.');
  const v = getVerification(req.user.id);
  if (v.role !== req.user.role) db.update('verifications', v.id, { role: req.user.role });
  recompute(v);
  return v;
}

router.get('/verification', requireAuth, wrap(async (req, res) => {
  res.json({ verification: present(own(req)), provinces: PROVINCES });
}));

router.put('/verification/profile', requireAuth, wrap(async (req, res) => {
  const v = own(req);
  if (v.status === 'verified' || v.status === 'submitted') throw bad('Your details are locked while they are under review or verified. Contact support to change them.');
  const b = req.body || {};
  const idType = oneOf(b.idType, ['sa_id', 'passport'], 'Identity document type');
  // A blank ID field keeps the saved number (the form never receives the full number back).
  const saved = revealIdNumber(v.profile);
  const keep = !String(b.idNumber || '').trim() && saved && v.profile.idType === idType;
  let idNumber = keep ? saved : str(b.idNumber, idType === 'sa_id' ? 'ID number' : 'Passport number', { min: 5, max: 20 }).replace(/\s/g, '').toUpperCase();
  let dateOfBirth = str(b.dateOfBirth, 'Date of birth', { optional: true, max: 10 });
  if (idType === 'sa_id') dateOfBirth = checkSaId(idNumber);
  else if (!/^[A-Z0-9]{5,20}$/.test(idNumber)) throw bad('Passport numbers contain only letters and digits.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw bad('Please enter your date of birth.');
  const age = (Date.now() - Date.parse(dateOfBirth)) / (365.25 * 86_400_000);
  const minAge = v.role === 'driver' ? 21 : 18;
  if (age < minAge) throw bad(`You must be at least ${minAge} to ${v.role === 'driver' ? 'drive with' : 'use'} DROP.`);
  if (age > 110) throw bad('Please check your date of birth.');
  const profile = {
    legalName: str(b.legalName, 'Full legal name', { min: 3, max: 100 }),
    idType, idNumber, dateOfBirth,
    nationality: str(b.nationality, 'Nationality', { min: 2, max: 60 }),
    addressLine1: str(b.addressLine1, 'Street address', { min: 3, max: 120 }),
    addressLine2: str(b.addressLine2, 'Address line 2', { optional: true, max: 120 }),
    suburb: str(b.suburb, 'Suburb', { optional: true, max: 60 }),
    city: str(b.city, 'City or town', { min: 2, max: 60 }),
    province: oneOf(b.province, PROVINCES, 'Province'),
    postalCode: str(b.postalCode, 'Postal code', { min: 4, max: 4 }),
    emergencyName: str(b.emergencyName, 'Emergency contact name', { optional: v.role !== 'driver', max: 80 }),
    emergencyPhone: phone(b.emergencyPhone, 'Emergency contact number', v.role !== 'driver'),
    companyName: v.role === 'business' ? str(b.companyName, 'Registered company name', { min: 2, max: 120 }) : '',
    registrationNumber: v.role === 'business' ? str(b.registrationNumber, 'Company registration number', { min: 6, max: 20 }) : '',
    vatNumber: v.role === 'business' ? str(b.vatNumber, 'VAT number', { optional: true, max: 15 }) : '',
  };
  if (!/^\d{4}$/.test(profile.postalCode)) throw bad('Postal codes have 4 digits.');
  if (profile.registrationNumber && !/^\d{4}\/\d{6}\/\d{2}$/.test(profile.registrationNumber)) throw bad('Company registration numbers look like 2018/079316/07.');
  const hash = idHash(idNumber);
  const dup = db.find('verifications', (x) => x.userId !== v.userId && (x.profile?.idNumberHash === hash || x.profile?.idNumber === idNumber) && x.status !== 'not_started');
  if (dup) throw bad('This identity number is already linked to another DROP account. Please contact support.');
  db.update('verifications', v.id, { profile: sealIdNumber(profile, idNumber) });
  recompute(v);
  res.json({ verification: present(v) });
}));

router.post('/verification/documents', requireAuth, upload.single('file'), wrap(async (req, res) => {
  const v = own(req);
  const req_ = requirementsFor(v.role);
  const type = oneOf(req.body?.type, [...req_.required, ...req_.optional], 'Document type');
  const meta = DOC_TYPES[type];
  if (!req.file) throw bad('Please choose a file to upload.');
  const kind = sniff(req.file.buffer);
  if (!kind) throw bad('Documents must be PDF, JPG or PNG files.');
  if (meta.imageOnly && kind.type === 'application/pdf') throw bad(`${meta.label} must be a photo (JPG or PNG).`);
  const existing = currentDocs(v).find((d) => d.type === type);
  if (existing?.status === 'approved' && v.status !== 'action_required' && !req.body?.replace) throw bad(`Your ${meta.label.toLowerCase()} is already approved.`);
  let expiresAt = null;
  if (meta.expires) {
    expiresAt = str(req.body?.expiresAt, 'Expiry date', { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) throw bad('Please enter the expiry date shown on the document.');
    if (expiresAt <= new Date().toISOString().slice(0, 10)) throw bad(`This ${meta.label.toLowerCase()} has expired. Please upload a current one.`);
  }
  let issuedAt = null;
  if (meta.maxAgeDays) {
    issuedAt = str(req.body?.issuedAt, 'Document date', { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) throw bad('Please enter the date on the document.');
    const ageDays = (Date.now() - Date.parse(issuedAt)) / 86_400_000;
    if (ageDays < -1) throw bad('The document date cannot be in the future.');
    if (ageDays > meta.maxAgeDays) throw bad(`Proof of address must be dated within the last ${Math.round(meta.maxAgeDays / 30)} months.`);
  }
  if (existing) existing.archived = true;
  const doc = {
    id: id(), type, file: storeEncrypted(req.file.buffer), mime: kind.type, ext: kind.ext,
    originalName: String(req.file.originalname || `${type}.${kind.ext}`).replace(/[^\w.\- ]/g, '').slice(0, 100),
    size: req.file.size, status: 'pending', reason: '', expiresAt, issuedAt, uploadedAt: now(), reviewedAt: null, reviewedBy: null,
  };
  v.documents.push(doc);
  // A new document after a decision needs a fresh review.
  const patch = { documents: v.documents };
  if (v.status === 'verified' || v.status === 'action_required') Object.assign(patch, { decision: null });
  db.update('verifications', v.id, patch);
  recompute(v);
  const { file, ...safe } = doc;
  res.status(201).json({ document: safe, verification: present(v) });
}));

router.delete('/verification/documents/:docId', requireAuth, wrap(async (req, res) => {
  const v = own(req);
  const doc = currentDocs(v).find((d) => d.id === req.params.docId);
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (doc.status === 'approved') throw bad('Approved documents cannot be removed.');
  if (v.status === 'submitted') throw bad('You cannot remove documents while they are under review.');
  v.documents = v.documents.filter((d) => d.id !== doc.id);
  removeFile(doc.file);
  db.update('verifications', v.id, { documents: v.documents });
  recompute(v);
  res.json({ verification: present(v) });
}));

/** Stream a decrypted document to its owner or to verification staff. */
router.get('/verification/documents/:docId/file', requireAuth, wrap(async (req, res) => {
  const v = db.find('verifications', (x) => x.documents.some((d) => d.id === req.params.docId));
  const doc = v?.documents.find((d) => d.id === req.params.docId);
  if (!doc || (v.userId !== req.user.id && !STAFF.includes(req.user.role))) throw new HttpError(404, 'Document not found.');
  const data = readDecrypted(doc.file);
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${doc.type}.${doc.ext}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}));

router.post('/verification/submit', requireAuth, wrap(async (req, res) => {
  const v = own(req);
  if (v.status === 'submitted') throw bad('Your documents are already with our verification team.');
  if (v.status === 'verified') throw bad('Your account is already verified.');
  const missing = missingProfile(v.role, v.profile);
  if (missing.length) throw bad('Please complete your personal details first.');
  const docs = currentDocs(v);
  const req_ = requirementsFor(v.role);
  const absent = req_.required.filter((t) => !docs.some((d) => d.type === t && ['pending', 'approved'].includes(d.status)));
  if (absent.length) throw bad(`Still needed: ${absent.map((t) => DOC_TYPES[t].label).join(', ')}.`);
  if (req.body?.consent !== true) throw bad('Please confirm the declaration and consent to continue.');
  const history = [...(v.history || []), { status: 'submitted', at: now() }];
  db.update('verifications', v.id, { submittedAt: now(), consentAt: now(), decision: null, changesRequested: false, history });
  recompute(v);
  for (const staff of db.filter('users', (u) => STAFF.includes(u.role) && !u.disabled)) {
    db.insert('notifications', { id: id(), userId: staff.id, title: 'New verification to review', body: `${v.profile.legalName} (${v.role}) submitted documents.`, link: 'queue', read: false, createdAt: now() });
  }
  res.json({ verification: present(v) });
}));

/* ---------------- Notifications ---------------- */
router.get('/notifications', requireAuth, wrap(async (req, res) => {
  const list = await history.list('notifications', { userId: req.user.id }, { limit: 50 });
  res.json({ notifications: list, unread: list.filter((n) => !n.read).length });
}));

router.post('/notifications/read', requireAuth, wrap(async (req, res) => {
  await db.patchWhere('notifications', 'userId', req.user.id, { read: true });
  res.json({ ok: true });
}));

export { requireRole };
export default router;
