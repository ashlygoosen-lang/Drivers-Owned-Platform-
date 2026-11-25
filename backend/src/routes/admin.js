import { Router } from 'express';
import * as history from '../history.js';
import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { requireRole, publicUser, hashPassword, STAFF_ROLES } from '../auth.js';
import { assertNotBreached } from './auth.js';
import { getVerification, recompute } from '../kyc.js';
import { id as newId } from '../db.js';
import { email, password } from '../validate.js';
import { view } from './bookings.js';
import { str, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();
const adminOnly = requireRole('admin');
const supportDesk = requireRole('admin', 'support');
const lookup = requireRole('admin', 'support', 'compliance', 'finance');
// Route-level access: support agents handle tickets, enquiries and look-ups; compliance reviews
// verification (routes/compliance.js); everything else is Super Admin only.
router.use('/admin', (req, res, next) => {
  const p = req.path;
  if (/^\/(tickets|enquiries)/.test(p)) return supportDesk(req, res, next);
  if (req.method === 'GET' && /^\/(users|bookings)/.test(p)) return lookup(req, res, next);
  return adminOnly(req, res, next);
});

const page = (list, req) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const filtered = q ? list.filter((x) => JSON.stringify(x).toLowerCase().includes(q)) : list;
  return filtered.slice().reverse().slice(0, Math.min(Number(req.query.limit) || 200, 500));
};

router.get('/admin/users', (req, res) => {
  const role = req.query.role;
  res.json({ users: page(db.filter('users', (u) => !role || u.role === role), req).map(publicUser) });
});

router.patch('/admin/users/:id', wrap(async (req, res) => {
  const user = db.byId('users', req.params.id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (user.id === req.user.id && req.body.disabled) throw bad('You cannot suspend your own account.');
  const patch = {};
  if (req.body.disabled !== undefined) patch.disabled = Boolean(req.body.disabled);
  if (req.body.endSessions || patch.disabled) patch.tokenVersion = (user.tokenVersion || 0) + 1;
  if (req.body.driverStatus !== undefined && user.role === 'driver') {
    patch.driverStatus = oneOf(req.body.driverStatus, ['pending', 'approved', 'suspended'], 'Driver status');
    if (patch.driverStatus === 'approved') {
      const v = getVerification(user.id);
      recompute(v);
      if (v.status !== 'verified') throw bad('This driver’s documents must be verified before they can drive.');
    }
    if (patch.driverStatus !== 'approved') patch.online = false;
  }
  res.json({ user: publicUser(db.update('users', user.id, patch)) });
}));

router.get('/admin/applications', (req, res) => {
  const apps = page(db.all('applications'), req).map((a) => {
    const u = db.byId('users', a.userId);
    return { ...a, applicant: u ? { name: u.name, email: u.email, phone: u.phone } : null, verificationStatus: u?.verificationStatus || 'not_started' };
  });
  res.json({ applications: apps });
});

router.patch('/admin/applications/:id', wrap(async (req, res) => {
  const app = db.byId('applications', req.params.id);
  if (!app) throw new HttpError(404, 'Application not found.');
  const status = oneOf(req.body.status, ['under_review', 'approved', 'rejected'], 'Status');
  if (status === 'approved') {
    const v = getVerification(app.userId);
    recompute(v);
    if (v.status !== 'verified') throw bad('Approve this driver’s identity documents in the Verification queue first.');
  }
  const checks = status === 'approved'
    ? { identity: 'verified', inspection: 'passed', activation: 'active' }
    : status === 'rejected' ? { ...app.checks, activation: 'declined' } : { ...app.checks, identity: 'in review' };
  const updated = db.update('applications', app.id, {
    status,
    checks,
    notes: str(req.body.notes, 'Notes', { optional: true, max: 1000 }),
    reviewedBy: req.user.email,
    reviewedAt: now(),
  });
  db.update('users', app.userId, { driverStatus: status === 'approved' ? 'approved' : 'pending', ...(status !== 'approved' && { online: false }) });
  if (status === 'rejected') db.insert('notifications', { id: newId(), userId: app.userId, title: 'Driver application update', body: updated.notes || 'Your application was not approved.', link: 'application', read: false, createdAt: now() });
  res.json({ application: updated });
}));

// Secure document download. Only the stored filename (a UUID) is accepted.
router.get('/admin/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  if (!/^[0-9a-f-]{36}\.(pdf|jpe?g|png)$/.test(name)) return res.status(400).json({ error: 'Invalid file.' });
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.sendFile(file);
});

router.get('/admin/bookings', wrap(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const list = await history.list('bookings', { status }, { limit: req.query.limit, offset: req.query.offset, q: req.query.q });
  res.json({ bookings: list.map((b) => view(b, req.user)) });
}));

router.get('/admin/tickets', (req, res) => {
  const tickets = page(db.all('tickets'), req).map((t) => {
    const u = db.byId('users', t.userId);
    return { ...t, user: u ? { name: u.name, email: u.email } : null };
  });
  res.json({ tickets });
});

router.patch('/admin/tickets/:id', wrap(async (req, res) => {
  const t = db.byId('tickets', req.params.id);
  if (!t) throw new HttpError(404, 'Ticket not found.');
  const patch = {};
  if (req.body.status) patch.status = oneOf(req.body.status, ['open', 'in_progress', 'resolved'], 'Status');
  if (req.body.reply) patch.replies = [...t.replies, { by: req.user.name, message: str(req.body.reply, 'Reply', { max: 2000 }), at: now() }];
  res.json({ ticket: db.update('tickets', t.id, patch) });
}));

router.get('/admin/enquiries', (req, res) => res.json({ enquiries: page(db.all('enquiries'), req) }));

router.patch('/admin/enquiries/:id', wrap(async (req, res) => {
  const e = db.byId('enquiries', req.params.id);
  if (!e) throw new HttpError(404, 'Enquiry not found.');
  res.json({ enquiry: db.update('enquiries', e.id, { status: oneOf(req.body.status, ['new', 'contacted', 'closed'], 'Status') }) });
}));

// Staff accounts: Super Admin creates compliance officers, support agents and other admins.
router.get('/admin/staff', (req, res) => {
  res.json({ staff: db.filter('users', (u) => STAFF_ROLES.includes(u.role)).map(publicUser) });
});

router.post('/admin/staff', wrap(async (req, res) => {
  const b = req.body || {};
  const addr = email(b.email);
  if (db.find('users', (u) => u.email === addr)) throw new HttpError(409, 'An account with this email already exists.');
  const user = db.insert('users', {
    id: newId(), name: str(b.name, 'Full name', { min: 2, max: 80 }), email: addr, phone: '',
    role: oneOf(b.role, STAFF_ROLES, 'Role'), passwordHash: await hashPassword(await (async (pw) => { await assertNotBreached(pw); return pw; })(password(b.password))), createdAt: now(), createdBy: req.user.email,
  });
  res.status(201).json({ user: publicUser(user) });
}));

router.patch('/admin/staff/:id', wrap(async (req, res) => {
  const user = db.find('users', (u) => u.id === req.params.id && STAFF_ROLES.includes(u.role));
  if (!user) throw new HttpError(404, 'Staff member not found.');
  if (user.id === req.user.id) throw bad('You cannot change your own staff role or access.');
  const patch = {};
  if (req.body.role) patch.role = oneOf(req.body.role, STAFF_ROLES, 'Role');
  if (req.body.disabled !== undefined) patch.disabled = Boolean(req.body.disabled);
  if (req.body.resetMfa) patch.mfa = null; // they set it up again at next sign-in
  if (patch.role || patch.disabled || req.body.resetMfa || req.body.endSessions) patch.tokenVersion = (user.tokenVersion || 0) + 1;
  res.json({ user: publicUser(db.update('users', user.id, patch)) });
}));

export default router;
