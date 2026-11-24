import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, id, now, nextRef } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { optionalAuth, requireRole, signToken, publicUser } from '../auth.js';
import { createUser } from './auth.js';
import { view, setStatus } from './bookings.js';
import { str, email, phone, password, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();

const ALLOWED = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED[ext] && ALLOWED[ext] === file.mimetype) return cb(null, true);
    cb(new HttpError(400, 'Documents must be PDF, JPG or PNG files under 5 MB.'));
  },
});
const docFields = upload.fields([
  { name: 'identityDocument', maxCount: 1 },
  { name: 'drivingLicence', maxCount: 1 },
  { name: 'vehicleDocument', maxCount: 1 },
]);

export const PARTICIPATION = ['Driver-owner programme', 'Delivery partner', 'Fleet owner'];

// Apply to join. Creates a driver account if the applicant is not signed in.
router.post('/drivers/apply', optionalAuth, docFields, wrap(async (req, res) => {
  const b = req.body || {};
  const files = req.files || {};
  for (const [field, label] of [['identityDocument', 'Identity document'], ['drivingLicence', 'Driving licence'], ['vehicleDocument', 'Vehicle documentation']]) {
    if (!files[field]?.[0]) throw bad(`${label} is required.`);
  }
  if (String(b.consent) !== 'true') throw bad('Please accept the programme terms to continue.');

  let user = req.user;
  let token = null;
  if (!user) {
    user = await createUser({
      name: str(b.name, 'Full name', { min: 2, max: 80 }),
      emailAddress: email(b.email),
      mobile: phone(b.phone),
      pw: password(b.password),
      role: 'driver',
    });
    token = signToken(user);
  } else if (user.role !== 'driver') {
    if (user.role !== 'passenger') throw bad('Business and admin accounts cannot apply as drivers. Please use a personal account.');
    user = db.update('users', user.id, { role: 'driver', driverStatus: 'pending' });
    token = signToken(user);
  }
  if (db.find('applications', (a) => a.userId === user.id && ['submitted', 'under_review', 'approved'].includes(a.status))) {
    throw new HttpError(409, 'You already have an application on file. You can track it in your dashboard.');
  }

  const doc = (f) => ({ file: f.filename, originalName: f.originalname.slice(0, 120), size: f.size, type: f.mimetype });
  const vehicle = str(b.vehicle, 'Vehicle make & registration', { min: 3, max: 120 });
  const application = db.insert('applications', {
    id: id(),
    ref: nextRef('application', 'APP'),
    userId: user.id,
    participation: oneOf(b.participation || PARTICIPATION[0], PARTICIPATION, 'Participation type'),
    city: str(b.city, 'City', { optional: true, max: 60 }),
    vehicle,
    documents: {
      identityDocument: doc(files.identityDocument[0]),
      drivingLicence: doc(files.drivingLicence[0]),
      vehicleDocument: doc(files.vehicleDocument[0]),
    },
    status: 'submitted',
    checks: { identity: 'pending', inspection: 'not scheduled', activation: 'pending review' },
    notes: '',
    createdAt: now(),
  });
  db.update('users', user.id, { vehicle, driverStatus: 'pending' });
  res.status(201).json({ application, token, user: publicUser(db.find('users', (u) => u.id === user.id)) });
}));

router.get('/drivers/application', requireRole('driver'), (req, res) => {
  const list = db.filter('applications', (a) => a.userId === req.user.id);
  res.json({ application: list[list.length - 1] || null });
});

const approved = (req) => {
  if (req.user.driverStatus !== 'approved') throw new HttpError(403, 'Your driver account is awaiting approval. You can go online once it is activated.');
};

router.post('/drivers/online', requireRole('driver'), wrap(async (req, res) => {
  approved(req);
  const user = db.update('users', req.user.id, { online: Boolean(req.body?.online) });
  res.json({ user: publicUser(user) });
}));

router.get('/drivers/requests', requireRole('driver'), wrap(async (req, res) => {
  if (req.user.driverStatus !== 'approved' || !req.user.online) return res.json({ requests: [], active: null });
  const active = db.find('bookings', (b) => b.driverId === req.user.id && ['accepted', 'arriving', 'in_progress'].includes(b.status));
  const requests = db.filter('bookings', (b) => b.status === 'requested').slice(-20).reverse();
  res.json({ requests: requests.map((b) => view(b, req.user)), active: active ? view(active, req.user) : null });
}));

const NEXT = { accepted: 'arriving', arriving: 'in_progress', in_progress: 'completed' };

router.post('/drivers/bookings/:id/accept', requireRole('driver'), wrap(async (req, res) => {
  approved(req);
  const booking = db.find('bookings', (b) => b.id === req.params.id);
  if (!booking || booking.status !== 'requested') throw new HttpError(409, 'This request is no longer available.');
  if (db.find('bookings', (b) => b.driverId === req.user.id && ['accepted', 'arriving', 'in_progress'].includes(b.status))) {
    throw bad('Finish your current trip before accepting another.');
  }
  if (booking.userId === req.user.id) throw bad('You cannot accept your own booking.');
  res.json({ booking: view(setStatus(booking, 'accepted', { driverId: req.user.id }), req.user) });
}));

router.post('/drivers/bookings/:id/advance', requireRole('driver'), wrap(async (req, res) => {
  const booking = db.find('bookings', (b) => b.id === req.params.id && b.driverId === req.user.id);
  if (!booking || !NEXT[booking.status]) throw bad('This trip cannot be updated.');
  const next = NEXT[booking.status];
  res.json({ booking: view(setStatus(booking, next, next === 'completed' ? { completedAt: now() } : {}), req.user) });
}));

export default router;
