import { Router } from 'express';
import * as history from '../history.js';
import { invalidate as invalidateDispatch } from '../dispatch.js';
import { db, id, now, nextRef } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { quote, PLACES, CATEGORIES } from '../pricing.js';
import { str, int, oneOf, wrap, bad, HttpError } from '../validate.js';
import { PASSENGER_VERIFICATION } from '../config.js';
import { getVerification, recompute } from '../kyc.js';
import { paystackEnabled } from '../money/paystack.js';
import { phoneMode } from '../comms/phone.js';
import { commsOpen, onTripStatus } from './comms.js';
import { onTrackingStatus, tripPoints } from './tracking.js';
import { sameWorld } from '../demoPolicy.js';
import { transition, OPEN } from '../bookingState.js';

const router = Router();
const SERVICES = Object.keys(CATEGORIES);

export const STATUS_FLOW = ['requested', 'accepted', 'arriving', 'in_progress', 'completed'];

router.get('/places', (_req, res) => res.json({ places: PLACES.map((p) => p.name) }));
router.get('/services', (_req, res) => res.json({ services: CATEGORIES }));

function tripInput(body) {
  const service = oneOf(body.service, SERVICES, 'Service');
  const pickup = str(body.pickup, 'Pickup location', { min: 3, max: 160 });
  const destination = str(body.destination, 'Destination', { min: 3, max: 160 });
  if (pickup.toLowerCase() === destination.toLowerCase()) throw bad('Choose a destination different from your pickup.');
  return { service, pickup, destination, category: body.category ? String(body.category) : undefined };
}

router.post('/fares/estimate', optionalAuth, wrap(async (req, res) => {
  res.json(quote(tripInput(req.body || {})));
}));

/**
 * Strip driver/passenger contact details to what the other party needs. Registered phone numbers are
 * only shared in "direct" phone mode, and only while the two can still contact each other. With
 * masked calling (Twilio) neither side ever sees the other's number.
 */
export function view(b, viewer) {
  const driver = b.driverId ? db.byId('users', b.driverId) : null;
  const passenger = db.byId('users', b.userId);
  const staff = viewer && ['admin', 'support'].includes(viewer.role);
  const share = staff || (phoneMode() === 'direct' && commsOpen(b));
  const out = { ...b };
  out.driver = driver ? { name: driver.name, phone: share ? driver.phone : '', vehicle: driver.vehicle || '', rating: driver.rating || null } : null;
  if (viewer && (viewer.role === 'driver' || viewer.role === 'admin' || viewer.role === 'support')) {
    out.passenger = passenger ? { name: b.passengerName || passenger.name, phone: share ? passenger.phone : '' } : null;
  }
  out.comms = commsOpen(b);
  return out;
}

export function verificationGate(user) {
  if (PASSENGER_VERIFICATION === 'off') return;
  if (!['passenger', 'business'].includes(user.role)) throw new HttpError(403, 'Please book from a passenger or business account.');
  const v = getVerification(user.id);
  recompute(v);
  const ok = PASSENGER_VERIFICATION === 'verified' ? ['verified'] : ['submitted', 'verified'];
  if (!ok.includes(v.status)) {
    const err = new HttpError(403, PASSENGER_VERIFICATION === 'verified' && v.status === 'submitted'
      ? 'Your documents are being reviewed. You can book as soon as your account is verified.'
      : 'Please verify your identity before your first booking. It takes about 3 minutes.');
    err.code = 'verification_required';
    throw err;
  }
}

router.post('/bookings', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  verificationGate(req.user);
  const trip = tripInput(b);
  const q = quote(trip);
  const option = q.options.find((o) => o.category === trip.category);
  if (!option) throw bad('Please choose a vehicle or parcel category.');
  const scheduledFor = b.scheduledFor ? new Date(b.scheduledFor) : null;
  if (scheduledFor && (Number.isNaN(+scheduledFor) || scheduledFor < Date.now() - 5 * 60_000)) throw bad('Please choose a time in the future.');
  const preferred = req.user.paymentPreference === 'Card' && !paystackEnabled() ? 'Cash' : req.user.paymentPreference;
  const payment = oneOf(b.payment || preferred || 'Cash', ['Card', 'Cash', 'Business account'], 'Payment method');
  if (payment === 'Business account' && req.user.role !== 'business') throw bad('Business account payment is only available to business accounts.');
  if (payment === 'Card' && !paystackEnabled()) throw bad('Card payments are not available yet. Please choose cash.');

  const idemKey = req.get('idempotency-key') ? `${req.user.id}:${String(req.get('idempotency-key')).slice(0, 80)}` : null;
  const openSlot = req.user.role === 'passenger' && !scheduledFor ? req.user.id : null;
  const booking = await db.insertStrict('bookings', {
    id: id(),
    idemKey,
    openSlot,
    ref: nextRef('booking', 'DRP'),
    userId: req.user.id,
    service: trip.service,
    category: option.category,
    pickup: trip.pickup,
    destination: trip.destination,
    passengers: trip.service === 'Delivery' ? 0 : int(b.passengers ?? 1, 'Passengers', { min: 1, max: option.seats || 6 }),
    parcel: trip.service === 'Delivery' ? str(b.parcel, 'Parcel information', { min: 2, max: 200 }) : '',
    passengerName: req.user.role === 'business' ? str(b.passengerName, 'Traveller name', { optional: true, max: 80 }) : '',
    notes: str(b.notes, 'Notes', { optional: true, max: 300 }),
    scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
    payment,
    distanceKm: q.distanceKm,
    durationMin: q.durationMin,
    approximate: q.approximate,
    fare: option.fare,
    passengerCommission: 0,
    driverServiceFee: option.driverServiceFee,
    driverEarnings: option.driverEarnings,
    status: payment === 'Card' ? 'awaiting_payment' : 'requested',
    paymentStatus: payment === 'Card' ? 'pending' : payment === 'Cash' ? 'cash' : 'invoice',
    driverId: null,
    rating: null,
    feedback: '',
    history: [{ status: payment === 'Card' ? 'awaiting_payment' : 'requested', at: now() }],
    createdAt: now(),
  }, {
    // One open trip per passenger (business accounts book for several travellers; scheduled trips don't count).
    conflict: (b) => (openSlot && b.openSlot === openSlot && OPEN.includes(b.status)) || (idemKey && b.idemKey === idemKey),
    message: 'You already have a trip in progress. Finish or cancel it before booking another.',
  });
  await tripPoints(booking); // coordinates for the live map and for nearest-driver dispatch
  if (booking.status === 'requested') invalidateDispatch();
  res.status(201).json({ booking: view(booking, req.user) });
}));

// Trip history, newest first, including trips older than the in-memory window (?limit, ?offset).
router.get('/bookings', requireAuth, wrap(async (req, res) => {
  const where = req.user.role === 'driver' ? { driverId: req.user.id } : { userId: req.user.id };
  const mine = await history.list('bookings', where, { limit: req.query.limit, offset: req.query.offset });
  res.json({ bookings: mine.map((b) => view(b, req.user)) });
}));

async function load(req) {
  const booking = await db.byIdFresh('bookings', req.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const u = req.user;
  const allowed = u.role === 'admin' || booking.userId === u.id || booking.driverId === u.id
    || (u.role === 'driver' && booking.status === 'requested' && sameWorld(u, db.byId('users', booking.userId)));
  if (!allowed) throw new HttpError(404, 'Booking not found.');
  return booking;
}

router.get('/bookings/:id', requireAuth, wrap(async (req, res) => {
  res.json({ booking: view(await load(req), req.user) });
}));

/** @deprecated use transition() from bookingState.js */
const setStatus = (booking, status, extra = {}, opts = {}) => transition(booking, status, extra, opts);

router.post('/bookings/:id/cancel', requireAuth, wrap(async (req, res) => {
  const booking = await load(req);
  const isOwner = booking.userId === req.user.id || req.user.role === 'admin';
  if (isOwner) {
    if (!['awaiting_payment', 'requested', 'accepted', 'arriving'].includes(booking.status)) throw bad('This booking can no longer be cancelled.');
    let cancelled = await transition(booking, 'cancelled', { cancelReason: str(req.body?.reason, 'Reason', { optional: true, max: 200 }) }, { from: ['awaiting_payment', 'requested', 'accepted', 'arriving'] });
    if (cancelled.paymentStatus === 'paid') {
      const { refundBooking } = await import('./money.js');
      cancelled = await refundBooking(cancelled);
    }
    return res.json({ booking: view(cancelled, req.user) });
  }
  // A driver releasing an accepted trip puts it back in the queue.
  if (booking.driverId === req.user.id && ['accepted', 'arriving'].includes(booking.status)) {
    return res.json({ booking: view(await transition(booking, 'requested', { driverId: null }, { from: ['accepted', 'arriving'], when: { driverId: req.user.id }, note: 'Released by driver' }), req.user) });
  }
  throw bad('This booking can no longer be cancelled.');
}));

router.post('/bookings/:id/rate', requireAuth, wrap(async (req, res) => {
  const booking = await load(req);
  if (booking.userId !== req.user.id) throw new HttpError(403, 'Only the passenger can rate this trip.');
  if (booking.status !== 'completed') throw bad('You can rate a trip once it is complete.');
  const rating = int(req.body?.rating, 'Rating', { min: 1, max: 5 });
  const updated = db.update('bookings', booking.id, { rating, feedback: str(req.body?.feedback, 'Feedback', { optional: true, max: 600 }) });
  if (booking.driverId) {
    db.update('users', booking.driverId, { rating: await history.driverRating(booking.driverId) });
  }
  res.json({ booking: view(updated, req.user) });
}));

export { setStatus };
export default router;
