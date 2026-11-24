import { Router } from 'express';
import { db, now } from '../db.js';
import { requireRole, publicUser } from '../auth.js';
import { DOC_TYPES, requirementsFor, currentDocs, recompute, notify, audit } from '../kyc.js';
import { present, STAFF } from './verification.js';
import { str, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();
const staff = requireRole(...STAFF);

function load(userId) {
  const v = db.find('verifications', (x) => x.userId === userId);
  if (!v) throw new HttpError(404, 'Verification not found.');
  recompute(v);
  return v;
}

function summary(v) {
  const u = db.find('users', (x) => x.id === v.userId);
  const docs = currentDocs(v);
  return {
    userId: v.userId, role: v.role, status: v.status, submittedAt: v.submittedAt, decidedAt: v.decidedAt,
    name: v.profile?.legalName || u?.name, email: u?.email, phone: u?.phone,
    documents: { total: docs.length, pending: docs.filter((d) => d.status === 'pending').length, rejected: docs.filter((d) => ['rejected', 'expired'].includes(d.status)).length },
  };
}

router.get('/compliance/queue', staff, (req, res) => {
  const status = String(req.query.status || 'submitted');
  const role = req.query.role ? String(req.query.role) : null;
  const q = String(req.query.q || '').toLowerCase();
  db.all('verifications').forEach(recompute);
  let list = db.all('verifications').filter((v) => (status === 'all' || v.status === status) && (!role || v.role === role));
  list = list.map(summary).filter((s) => !q || `${s.name} ${s.email} ${s.phone}`.toLowerCase().includes(q));
  list.sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || ''))); // oldest first
  const counts = Object.fromEntries(['submitted', 'action_required', 'verified', 'in_progress', 'not_started'].map((s) => [s, db.filter('verifications', (v) => v.status === s).length]));
  res.json({ queue: list.slice(0, 300), counts });
});

router.get('/compliance/verifications/:userId', staff, wrap(async (req, res) => {
  const v = load(req.params.userId);
  const user = db.find('users', (u) => u.id === v.userId);
  const application = db.filter('applications', (a) => a.userId === v.userId).pop() || null;
  audit(req.user, 'verification.viewed', v.userId);
  res.json({ verification: present(v, { reveal: true }), user: publicUser(user), application, archived: v.documents.filter((d) => d.archived).map(({ file, ...d }) => d) });
}));

router.post('/compliance/documents/:docId/review', staff, wrap(async (req, res) => {
  const v = db.find('verifications', (x) => x.documents.some((d) => d.id === req.params.docId && !d.archived));
  if (!v) throw new HttpError(404, 'Document not found.');
  const doc = v.documents.find((d) => d.id === req.params.docId);
  const decision = oneOf(req.body?.decision, ['approved', 'rejected'], 'Decision');
  const reason = decision === 'rejected' ? str(req.body?.reason, 'Reason for rejection', { min: 5, max: 300 }) : '';
  if (req.body?.expiresAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.expiresAt)) throw bad('Expiry dates use the format YYYY-MM-DD.');
    doc.expiresAt = req.body.expiresAt;
  }
  Object.assign(doc, { status: decision, reason, reviewedAt: now(), reviewedBy: req.user.name });
  db.update('verifications', v.id, { documents: v.documents });
  audit(req.user, `document.${decision}`, v.userId, { type: doc.type, reason });
  if (decision === 'rejected') {
    db.update('verifications', v.id, { decision: null });
    notify(v.userId, `${DOC_TYPES[doc.type].label} needs attention`, reason);
  }
  recompute(v);
  res.json({ verification: present(v, { reveal: true }) });
}));

/** Final decision. Approving requires every required document to be approved. */
router.post('/compliance/verifications/:userId/decision', staff, wrap(async (req, res) => {
  const v = load(req.params.userId);
  const decision = oneOf(req.body?.decision, ['approve', 'request_changes'], 'Decision');
  const note = str(req.body?.note, 'Note', { optional: decision === 'approve', min: 5, max: 500 });
  if (!v.submittedAt) throw bad('This person has not submitted their verification yet.');
  const req_ = requirementsFor(v.role);
  const docs = currentDocs(v);
  if (decision === 'approve') {
    const notApproved = req_.required.filter((t) => !docs.some((d) => d.type === t && d.status === 'approved'));
    if (notApproved.length) throw bad(`Approve these documents first: ${notApproved.map((t) => DOC_TYPES[t].label).join(', ')}.`);
  }
  const history = [...(v.history || []), { status: decision === 'approve' ? 'verified' : 'action_required', at: now(), by: req.user.name, note }];
  db.update('verifications', v.id, {
    decision: decision === 'approve' ? 'approved' : null,
    decisionNote: note, decidedAt: now(), decidedBy: req.user.name, history,
    // Requesting changes reopens the file for the user.
    changesRequested: decision === 'request_changes',
    ...(decision === 'request_changes' && { submittedAt: null }),
  });
  recompute(v);
  if (decision === 'approve' && v.role === 'driver') {
    const app = db.filter('applications', (a) => a.userId === v.userId).pop();
    if (app && app.status !== 'approved') db.update('applications', app.id, { status: 'approved', checks: { identity: 'verified', inspection: 'passed', activation: 'active' }, reviewedBy: req.user.email, reviewedAt: now() });
  }
  audit(req.user, decision === 'approve' ? 'verification.approved' : 'verification.changes_requested', v.userId, { note });
  notify(v.userId, decision === 'approve' ? 'You’re verified' : 'Please update your verification', decision === 'approve'
    ? (v.role === 'driver' ? 'Your documents are approved. You can now go online and accept trips.' : 'Your identity is verified. Thank you for helping keep DROP safe.')
    : note);
  res.json({ verification: present(load(req.params.userId), { reveal: true }) });
}));

/** Approved documents expiring within the next N days (default 30), and already expired ones. */
router.get('/compliance/expiring', staff, (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const limit = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const out = [];
  for (const v of db.all('verifications')) {
    recompute(v);
    const u = db.find('users', (x) => x.id === v.userId);
    for (const d of currentDocs(v)) {
      if (d.expiresAt && d.expiresAt <= limit && ['approved', 'expired'].includes(d.status)) {
        out.push({ userId: v.userId, name: v.profile?.legalName || u?.name, email: u?.email, role: v.role, type: d.type, label: DOC_TYPES[d.type].label, expiresAt: d.expiresAt, status: d.status });
      }
    }
  }
  res.json({ documents: out.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)) });
});

router.post('/compliance/remind/:userId', staff, wrap(async (req, res) => {
  const v = load(req.params.userId);
  notify(v.userId, 'Document expiring soon', str(req.body?.message, 'Message', { optional: true, max: 300 }) || 'One of your documents is about to expire. Please upload a current copy to stay active on DROP.');
  audit(req.user, 'verification.reminder_sent', v.userId);
  res.json({ ok: true });
}));

router.get('/compliance/audit', requireRole('admin', 'compliance'), (req, res) => {
  const subject = req.query.userId ? String(req.query.userId) : null;
  const list = db.filter('audit', (a) => !subject || a.subjectId === subject).slice(-300).reverse();
  const names = Object.fromEntries(db.all('users').map((u) => [u.id, u.name]));
  res.json({ entries: list.map((a) => ({ ...a, subjectName: names[a.subjectId] || '' })) });
});

export default router;
