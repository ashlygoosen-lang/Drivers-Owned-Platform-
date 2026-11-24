import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { requireRole, publicUser } from '../auth.js';
import { view } from './bookings.js';
import { str, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();
router.use('/admin', requireRole('admin'));

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
  const user = db.find('users', (u) => u.id === req.params.id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (user.id === req.user.id && req.body.disabled) throw bad('You cannot suspend your own account.');
  const patch = {};
  if (req.body.disabled !== undefined) patch.disabled = Boolean(req.body.disabled);
  if (req.body.driverStatus !== undefined && user.role === 'driver') {
    patch.driverStatus = oneOf(req.body.driverStatus, ['pending', 'approved', 'suspended'], 'Driver status');
    if (patch.driverStatus !== 'approved') patch.online = false;
  }
  res.json({ user: publicUser(db.update('users', user.id, patch)) });
}));

router.get('/admin/applications', (req, res) => {
  const apps = page(db.all('applications'), req).map((a) => {
    const u = db.find('users', (x) => x.id === a.userId);
    return { ...a, applicant: u ? { name: u.name, email: u.email, phone: u.phone } : null };
  });
  res.json({ applications: apps });
});

router.patch('/admin/applications/:id', wrap(async (req, res) => {
  const app = db.find('applications', (a) => a.id === req.params.id);
  if (!app) throw new HttpError(404, 'Application not found.');
  const status = oneOf(req.body.status, ['under_review', 'approved', 'rejected'], 'Status');
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

router.get('/admin/bookings', (req, res) => {
  const status = req.query.status;
  res.json({ bookings: page(db.filter('bookings', (b) => !status || b.status === status), req).map((b) => view(b, req.user)) });
});

router.get('/admin/tickets', (req, res) => {
  const tickets = page(db.all('tickets'), req).map((t) => {
    const u = db.find('users', (x) => x.id === t.userId);
    return { ...t, user: u ? { name: u.name, email: u.email } : null };
  });
  res.json({ tickets });
});

router.patch('/admin/tickets/:id', wrap(async (req, res) => {
  const t = db.find('tickets', (x) => x.id === req.params.id);
  if (!t) throw new HttpError(404, 'Ticket not found.');
  const patch = {};
  if (req.body.status) patch.status = oneOf(req.body.status, ['open', 'in_progress', 'resolved'], 'Status');
  if (req.body.reply) patch.replies = [...t.replies, { by: req.user.name, message: str(req.body.reply, 'Reply', { max: 2000 }), at: now() }];
  res.json({ ticket: db.update('tickets', t.id, patch) });
}));

router.get('/admin/enquiries', (req, res) => res.json({ enquiries: page(db.all('enquiries'), req) }));

router.patch('/admin/enquiries/:id', wrap(async (req, res) => {
  const e = db.find('enquiries', (x) => x.id === req.params.id);
  if (!e) throw new HttpError(404, 'Enquiry not found.');
  res.json({ enquiry: db.update('enquiries', e.id, { status: oneOf(req.body.status, ['new', 'contacted', 'closed'], 'Status') }) });
}));

export default router;
