import { Router } from 'express';
import { db, id, now, nextRef } from '../db.js';
import { getVerification, recompute } from '../kyc.js';
import { settleTrip } from '../money/settlement.js';
import { walletBalance, cents } from '../money/ledger.js';
import { optionalAuth, requireRole, publicUser } from '../auth.js';
import { issueSession } from '../sessions.js';
import { createUser } from './auth.js';
import { sameWorld } from '../demoPolicy.js';
import { requestsFor } from '../dispatch.js';
import { getLocation } from '../tracking/locations.js';
import { view } from './bookings.js';
import { transition, ACTIVE } from '../bookingState.js';
import { str, email, phone, password, oneOf, int, wrap, bad, HttpError } from '../validate.js';

const router = Router();

export const PARTICIPATION = ['Driver-owner programme', 'Delivery partner', 'Fleet owner'];

// Apply to join. Creates a driver account if needed and records the vehicle. Documents are uploaded
// next, through the verification centre (/api/verification).
router.post('/drivers/apply', optionalAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.consent !== true && String(b.consent) !== 'true') throw bad('Please accept the programme terms to continue.');
  let user = req.user;
  let token = null;
  let refreshToken;
  if (!user) {
    user = await createUser({
      name: str(b.name, 'Full name', { min: 2, max: 80 }),
      emailAddress: email(b.email),
      mobile: phone(b.phone),
      pw: password(b.password),
      role: 'driver',
    });
    ({ token, refreshToken } = issueSession(req, res, user));
  } else if (user.role !== 'driver') {
    if (user.role !== 'passenger') throw bad('Business and staff accounts cannot apply as drivers. Please use a personal account.');
    user = db.update('users', user.id, { role: 'driver', driverStatus: 'pending', online: false });
    const v = db.find('verifications', (x) => x.userId === user.id);
    if (v) db.update('verifications', v.id, { role: 'driver', decision: null });
    ({ token, refreshToken } = issueSession(req, res, user));
  }
  if (db.find('applications', (a) => a.userId === user.id && ['submitted', 'under_review', 'approved'].includes(a.status))) {
    throw new HttpError(409, 'You already have an application on file. You can track it in your dashboard.');
  }
  const vehicle = str(b.vehicle, 'Vehicle make, model & registration', { min: 3, max: 120 });
  const year = b.vehicleYear ? Number(b.vehicleYear) : null;
  if (year && (year < 2008 || year > new Date().getFullYear() + 1)) throw bad('E-hailing vehicles must be 2008 or newer.');
  const application = db.insert('applications', {
    id: id(),
    ref: nextRef('application', 'APP'),
    userId: user.id,
    participation: oneOf(b.participation || PARTICIPATION[0], PARTICIPATION, 'Participation type'),
    city: str(b.city, 'City', { optional: true, max: 60 }),
    vehicle,
    vehicleYear: year,
    vehicleColour: str(b.vehicleColour, 'Vehicle colour', { optional: true, max: 30 }),
    seats: b.seats ? int(b.seats, 'Seats', { min: 2, max: 8 }) : null,
    documents: {},
    status: 'submitted',
    checks: { identity: 'pending', inspection: 'not scheduled', activation: 'pending review' },
    notes: '',
    createdAt: now(),
  });
  db.update('users', user.id, { vehicle, driverStatus: 'pending' });
  res.status(201).json({ application, token, ...(refreshToken && { refreshToken }), user: publicUser(db.byId('users', user.id)) });
}));

router.get('/drivers/application', requireRole('driver'), (req, res) => {
  const list = db.filter('applications', (a) => a.userId === req.user.id);
  res.json({ application: list[list.length - 1] || null });
});

const approved = (req) => {
  const v = getVerification(req.user.id);
  recompute(v);
  if (v.status !== 'verified') {
    const err = new HttpError(403, v.status === 'submitted' ? 'Your documents are being reviewed. You can go online once they are approved.' : 'Complete your verification to go online. Upload your documents in the Verification tab.');
    err.code = 'verification_required';
    throw err;
  }
  const fresh = db.byId('users', req.user.id);
  if (fresh.driverStatus !== 'approved') throw new HttpError(403, 'Your driver account is not active. Please contact DROP support.');
};

router.post('/drivers/online', requireRole('driver'), wrap(async (req, res) => {
  approved(req);
  const user = db.update('users', req.user.id, { online: Boolean(req.body?.online) });
  res.json({ user: publicUser(user) });
}));

router.get('/drivers/requests', requireRole('driver'), wrap(async (req, res) => {
  const v = getVerification(req.user.id);
  recompute(v);
  const me = db.byId('users', req.user.id);
  if (me.driverStatus !== 'approved' || !me.online) return res.json({ requests: [], active: null });
  const active = db.find('bookings', (b) => b.driverId === req.user.id && ['accepted', 'arriving', 'in_progress'].includes(b.status));
  // Nearest drivers first (Phase 6B-2): see src/dispatch.js.
  const requests = await requestsFor(me, await getLocation(me.id));
  res.json({ requests: requests.map(({ booking, km }) => ({ ...view(booking, req.user), pickupDistanceKm: km })), active: active ? view(active, req.user) : null });
}));

const NEXT = { accepted: 'arriving', arriving: 'in_progress', in_progress: 'completed' };

router.post('/drivers/bookings/:id/accept', requireRole('driver'), wrap(async (req, res) => {
  approved(req);
  const booking = await db.byIdFresh('bookings', req.params.id);
  if (!booking || booking.status !== 'requested' || !sameWorld(req.user, db.byId('users', booking.userId))) throw new HttpError(409, 'This request is no longer available.');
  if (db.find('bookings', (b) => b.driverId === req.user.id && ['accepted', 'arriving', 'in_progress'].includes(b.status))) {
    throw bad('Finish your current trip before accepting another.');
  }
  if (booking.userId === req.user.id) throw bad('You cannot accept your own booking.');
  const debtLimit = cents(process.env.CASH_DEBT_LIMIT || 300);
  if (booking.payment === 'Cash' && walletBalance(req.user.id) < -debtLimit) throw bad('Your wallet owes more than the cash limit in DROP service fees. Card and business trips will top it up, or contact support.');
  // Decided by the database: only one driver can win, and a driver can hold only one active trip.
  res.json({ booking: view(await transition(booking, 'accepted', { driverId: req.user.id, acceptedAt: now() }, { from: 'requested', when: { driverId: null } }), req.user) });
}));

router.post('/drivers/bookings/:id/advance', requireRole('driver'), wrap(async (req, res) => {
  const booking = await db.byIdFresh('bookings', req.params.id).then((b) => (b?.driverId === req.user.id ? b : undefined));
  if (!booking || !NEXT[booking.status]) throw bad('This trip cannot be updated.');
  const next = NEXT[booking.status];
  const updated = await transition(booking, next, next === 'completed' ? { completedAt: now() } : {}, { from: booking.status, when: { driverId: req.user.id } });
  if (next === 'completed') settleTrip(updated);
  res.json({ booking: view(db.byId('bookings', updated.id), req.user) });
}));

export default router;
