import { Router } from 'express';
import { db, id, now, nextRef } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { str, oneOf, wrap, bad, HttpError } from '../validate.js';
import { notify } from '../kyc.js';
import { securityEvent } from '../monitor.js';
import { verificationGate } from './bookings.js';
import { getLocation } from '../tracking/locations.js';
import * as paystack from '../money/paystack.js';
import { cents } from '../money/ledger.js';
import {
  KINDS, MAX_RIDERS, SKIP_NOTICE_HOURS, CANCEL_NOTICE_HOURS, pricePlan, planView, addHistory, scholarEligibility, clashes,
  sastDate, sastTime,
} from '../plans.js';
import { locate, distanceKm } from '../tracking/geo.js';

const router = Router();
const PUBLIC_URL = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');
export const GUARDIAN_CONSENT_VERSION = 'scholar-2026-11';
const HANDOVER = ['Hand over to a staff member at school', 'Learner may walk from the drop-off point alone', 'Hand over to the parent or guardian only'];
const RELATIONSHIP = ['Parent', 'Legal guardian', 'Grandparent or family member with parental responsibility', 'Foster parent'];
const GRADES = ['Grade R', ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
const time = (v, label) => {
  const t = String(v || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw bad(`${label}: use a 24-hour time like 06:45.`);
  if (t < '05:00' || t > '20:00') throw bad(`${label}: trips run between 05:00 and 20:00.`);
  return t;
};
const OPEN_STATUSES = ['awaiting_payment', 'awaiting_driver', 'active'];

/** Validate and normalise a plan request. Used by quote and create. */
function planInput(user, b, { forQuote = false } = {}) {
  const kind = oneOf(b.kind, Object.keys(KINDS), 'Plan type');
  if (kind === 'scholar' && user.role !== 'passenger') throw new HttpError(403, 'Scholar transport is booked by a parent or guardian from a personal DROP account.');
  if (kind === 'staff' && user.role !== 'business') throw new HttpError(403, 'Staff transport is booked from a DROP business account.');
  const category = oneOf(b.category || 'Comfort', Object.keys(MAX_RIDERS), 'Vehicle');
  const pickup = str(b.pickup, kind === 'scholar' ? 'Home pickup address' : 'Pickup point', { min: 3, max: 160 });
  const destination = str(b.destination, kind === 'scholar' ? 'School address' : 'Workplace address', { min: 3, max: 160 });
  if (pickup.toLowerCase() === destination.toLowerCase()) throw bad('The pickup and destination must be different.');
  const outTime = time(b.outTime, kind === 'scholar' ? 'Morning pickup time' : 'Pickup time');
  const returnTime = b.returnTime ? time(b.returnTime, kind === 'scholar' ? 'Afternoon pickup time at school' : 'Return pickup time') : null;
  if (returnTime && returnTime <= outTime) throw bad('The return trip must be later in the day than the first trip.');
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  if (returnTime && mins(returnTime) - mins(outTime) < 90) throw bad('Leave at least 90 minutes between the two trips.');
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].filter((d) => d >= 1 && d <= 7).sort();
  if (!days.length) throw bad('Choose at least one day of the week.');
  const today = sastDate();
  const startDate = String(b.startDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) throw bad('Choose a start date.');
  if (startDate <= today) throw bad('Plans start tomorrow at the earliest, so a driver can accept it.');
  if (Date.parse(startDate) - Date.parse(today) > 62 * 86_400_000) throw bad('Plans can be booked up to two months ahead.');
  const legs = [{ key: 'out', label: kind === 'scholar' ? 'Morning: home to school' : 'Morning: pickup to work', from: pickup, to: destination, time: outTime }];
  if (returnTime) legs.push({ key: 'back', label: kind === 'scholar' ? 'Afternoon: school to home' : 'Evening: work to pickup', from: destination, to: pickup, time: returnTime });
  const ridersIn = forQuote ? Array.from({ length: Math.max(1, Number(b.riderCount) || 1) }, () => ({ name: 'Rider', grade: 'Grade 1' })) : Array.isArray(b.riders) ? b.riders : [];
  if (!ridersIn.length) throw bad(kind === 'scholar' ? 'Add at least one learner.' : 'Add at least one staff member.');
  if (ridersIn.length > MAX_RIDERS[category]) throw bad(`A ${category} vehicle takes up to ${MAX_RIDERS[category]} ${kind === 'scholar' ? 'learners' : 'passengers'}. Choose XL or split the group into two plans.`);
  const riders = ridersIn.map((r, i) => ({
    name: str(r?.name, `${kind === 'scholar' ? 'Learner' : 'Staff member'} ${i + 1} name`, { min: 2, max: 60 }),
    ...(kind === 'scholar' && { grade: oneOf(r?.grade, GRADES, `Learner ${i + 1} grade`) }),
    ...(kind === 'staff' && r?.phone && { phone: str(r.phone, `Staff member ${i + 1} phone`, { max: 20 }) }),
    notes: str(r?.notes, 'Notes', { optional: true, max: 200 }),
  }));
  let guardian = null;
  if (kind === 'scholar' && !forQuote) {
    const g = b.guardian || {};
    if (g.consent !== true) throw bad('As the learner’s parent or guardian, please give consent for DROP to process the learner’s details for this service (POPIA section 35).');
    guardian = {
      relationship: oneOf(g.relationship, RELATIONSHIP, 'Your relationship to the learner'),
      emergencyName: str(g.emergencyName, 'Second emergency contact name', { min: 2, max: 60 }),
      emergencyPhone: str(g.emergencyPhone, 'Second emergency contact phone', { min: 9, max: 20 }),
      handover: oneOf(g.handover, HANDOVER, 'Drop-off handover'),
      consentAt: now(), consentVersion: GUARDIAN_CONSENT_VERSION,
    };
  }
  const school = kind === 'scholar' && !forQuote ? str(b.school, 'School name', { min: 2, max: 100 }) : '';
  return { kind, category, pickup, destination, legs, days, startDate, riders, guardian, school };
}

const endOfMonth = (date) => { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

router.post('/plans/quote', requireAuth, wrap(async (req, res) => {
  const p = planInput(req.user, req.body || {}, { forQuote: true });
  const pricing = pricePlan(p);
  res.json({ pricing, endDate: endOfMonth(p.startDate) });
}));

router.post('/plans', requireAuth, wrap(async (req, res) => {
  verificationGate(req.user);
  const input = planInput(req.user, req.body || {});
  const pricing = pricePlan(input);
  if (!pricing.trips) throw bad('There are no service days between the start date and the end of the month. Choose another start date.');
  const payment = input.kind === 'staff' ? oneOf(req.body?.payment || 'Business account', ['Business account', 'Card'], 'Payment method') : 'Card';
  if (payment === 'Card' && !paystack.paystackEnabled()) throw bad('Card payments are not available yet, so monthly plans can’t be paid online. Please contact us to arrange the plan.');
  const open = db.filter('plans', (x) => x.userId === req.user.id && OPEN_STATUSES.includes(x.status)).length;
  if (open >= 20) throw bad('You have 20 open plans. Please contact us for a larger contract.');
  const [pickupLoc, destinationLoc] = await Promise.all([locate(input.pickup), locate(input.destination)]);
  const plan = db.insert('plans', {
    id: id(), ref: nextRef('plan', 'MPL'), pickupLoc: pickupLoc || null, destinationLoc: destinationLoc || null, userId: req.user.id, kind: input.kind, category: input.category,
    pickup: input.pickup, destination: input.destination, school: input.school, company: req.user.company || '',
    legs: input.legs, days: input.days, riders: input.riders, guardian: input.guardian,
    startDate: input.startDate, endDate: endOfMonth(input.startDate), month: input.startDate.slice(0, 7),
    pricing, payment, paymentStatus: payment === 'Card' ? 'pending' : 'invoice',
    status: payment === 'Card' ? 'awaiting_payment' : 'awaiting_driver',
    driverId: null, skipDates: [], autoRenew: req.body?.autoRenew !== false, createdAt: now(),
    history: [{ status: payment === 'Card' ? 'awaiting_payment' : 'awaiting_driver', at: now() }],
  });
  if (plan.status === 'awaiting_driver') notifyDriversOfPlan(plan);
  res.status(201).json({ plan: planView(plan, req.user) });
}));

router.get('/plans', requireAuth, (req, res) => {
  const mine = db.filter('plans', (p) => p.userId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ plans: mine.map((p) => planView(p, req.user)) });
});

function ownPlan(req) {
  const p = db.byId('plans', String(req.params.id));
  if (!p || (p.userId !== req.user.id && !['admin', 'support'].includes(req.user.role))) throw new HttpError(404, 'Plan not found.');
  return p;
}

router.get('/plans/:id', requireAuth, (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || ![p.userId, p.driverId].includes(req.user.id) && !['admin', 'support', 'compliance', 'finance'].includes(req.user.role)) throw new HttpError(404, 'Plan not found.');
  const trips = db.filter('bookings', (b) => b.planId === p.id).sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)))
    .map((b) => ({ id: b.id, ref: b.ref, date: b.planDate, leg: b.planLeg, status: b.status, scheduledFor: b.scheduledFor, fare: b.fare }));
  res.json({ plan: planView(p, req.user), trips });
});

/** Skip a day (absence, school holiday). With enough notice the day is refunded at month end. */
router.post('/plans/:id/skip', requireAuth, wrap(async (req, res) => {
  const p = ownPlan(req);
  if (!['awaiting_driver', 'active', 'awaiting_payment'].includes(p.status)) throw bad('This plan is not running.');
  const date = String(req.body?.date || '');
  if (!p.pricing.dates.includes(date)) throw bad('That date is not a service day on this plan.');
  const first = sastTime(date, p.legs[0].time);
  if (first - Date.now() < SKIP_NOTICE_HOURS() * 3_600_000) throw bad(`Days can be skipped up to ${SKIP_NOTICE_HOURS()} hours before the first pickup. For today, cancel the trip in the app instead.`);
  const skipDates = req.body?.undo ? (p.skipDates || []).filter((d) => d !== date) : [...new Set([...(p.skipDates || []), date])].sort();
  const updated = db.update('plans', p.id, { skipDates, history: addHistory(p, p.status, `${req.body?.undo ? 'Restored' : 'Skipped'} ${date}`) });
  if (p.driverId) notify(p.driverId, `Plan ${p.ref}: ${req.body?.undo ? 'trip restored' : 'no trip'} on ${date}`, req.body?.undo ? 'The trips on this day are back on.' : 'The customer skipped this day. You will not be sent there.', 'plans');
  res.json({ plan: planView(updated, req.user) });
}));

/**
 * Cancel. Takes effect CANCEL_NOTICE_HOURS (24) after the request; trips after that do not run and are
 * refunded with everything else unused when the period closes (at the latest at month end).
 */
router.post('/plans/:id/cancel', requireAuth, wrap(async (req, res) => {
  const p = ownPlan(req);
  if (!OPEN_STATUSES.includes(p.status)) throw bad('This plan is already closed.');
  const reason = str(req.body?.reason, 'Reason', { optional: true, max: 200 });
  if (p.status === 'awaiting_payment') {
    const updated = db.update('plans', p.id, { status: 'cancelled', cancelEffective: now(), cancelReason: reason, history: addHistory(p, 'cancelled', 'Cancelled before payment') });
    return res.json({ plan: planView(updated, req.user) });
  }
  const effective = new Date(Math.max(Date.now() + CANCEL_NOTICE_HOURS() * 3_600_000, Date.parse(`${p.startDate}T00:00:00+02:00`))).toISOString();
  const updated = db.update('plans', p.id, { status: 'cancelled', cancelEffective: effective, cancelReason: reason, autoRenew: false, history: addHistory(p, 'cancelled', `Trips stop from ${effective}`) });
  if (p.driverId) notify(p.driverId, `Plan ${p.ref} cancelled`, `The customer cancelled. Trips stop after ${new Date(effective).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}.`, 'plans');
  if (p.renewedToId) {
    const next = db.byId('plans', p.renewedToId);
    if (next && OPEN_STATUSES.includes(next.status) && next.paymentStatus !== 'paid') db.update('plans', next.id, { status: 'cancelled', cancelEffective: now(), history: addHistory(next, 'cancelled', 'Previous month cancelled') });
  }
  res.json({ plan: planView(updated, req.user) });
}));

router.post('/plans/:id/auto-renew', requireAuth, wrap(async (req, res) => {
  const p = ownPlan(req);
  const updated = db.update('plans', p.id, { autoRenew: Boolean(req.body?.autoRenew) });
  res.json({ plan: planView(updated, req.user) });
}));

/* ---------------- Card payment for a plan (Paystack) ---------------- */
router.post('/payments/plans/:id/checkout', requireAuth, wrap(async (req, res) => {
  if (!paystack.paystackEnabled()) throw bad('Card payments are not available yet.');
  const p = ownPlan(req);
  if (p.paymentStatus === 'paid') throw bad('This plan is already paid.');
  if (p.status !== 'awaiting_payment') throw bad('This plan does not need a card payment.');
  const reference = `${p.ref}-${Date.now().toString(36)}`;
  const tx = await paystack.initialize({
    email: req.user.email, amountCents: cents(p.pricing.total), reference,
    callbackUrl: `${PUBLIC_URL() || `${req.protocol}://${req.get('host')}`}/?payment_ref=${encodeURIComponent(reference)}`,
    metadata: { planId: p.id, planRef: p.ref, userId: req.user.id },
  });
  db.update('plans', p.id, { pendingPaymentReference: reference });
  res.json({ authorizationUrl: tx.authorization_url, reference });
}));

/* ---------------- Drivers ---------------- */
const driverOnly = requireRole('driver');

/** Plans waiting for a driver that this driver may take (nearest first), and the driver's own plans. */
router.get('/drivers/plans', driverOnly, wrap(async (req, res) => {
  const me = db.byId('users', req.user.id);
  const scholar = scholarEligibility(me.id);
  const loc = await getLocation(me.id);
  const mine = db.filter('plans', (p) => p.driverId === me.id && ['active', 'awaiting_payment'].includes(p.status));
  const offers = db.filter('plans', (p) => p.status === 'awaiting_driver' && !p.driverId && (p.kind !== 'scholar' || scholar.eligible) && p.endDate >= sastDate())
    .map((p) => ({ p, km: loc && p.pickupLoc ? Math.round(distanceKm(loc, p.pickupLoc) * 10) / 10 : null, clash: mine.some((m) => clashes(m, p)) }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)).slice(0, 30);
  res.json({
    eligibility: { scholar: scholar.eligible, missing: scholar.missing },
    offers: offers.map(({ p, km, clash }) => ({ ...planView(p, req.user), distanceKm: km, clash, earnings: Math.round(p.pricing.perLeg.reduce((s, l) => s + l.driverEarnings, 0) * p.pricing.dates.length * 100) / 100 })),
    mine: mine.map((p) => planView(p, req.user)),
  });
}));

router.post('/drivers/plans/:id/accept', driverOnly, wrap(async (req, res) => {
  const me = db.byId('users', req.user.id);
  if (me.driverStatus !== 'approved') throw new HttpError(403, 'Your driver account is not active.');
  const p = await db.byIdFresh('plans', String(req.params.id));
  if (!p || p.status !== 'awaiting_driver' || p.driverId) throw new HttpError(409, 'This plan has already been taken.');
  if (p.kind === 'scholar') {
    const e = scholarEligibility(me.id);
    if (!e.eligible) throw new HttpError(403, `Scholar transport needs approved: ${e.missing.join(', ').replace(/_/g, ' ')}. Upload them under Verification.`);
  }
  const mine = db.filter('plans', (x) => x.driverId === me.id && ['active', 'awaiting_payment'].includes(x.status));
  if (mine.some((m) => clashes(m, p))) throw new HttpError(409, 'This plan overlaps the times of a plan you already drive.');
  const updated = await db.updateStrict('plans', p.id, { driverId: me.id, acceptedAt: now(), status: 'active', history: addHistory(p, 'active', `Accepted by ${me.name}`) },
    { when: { status: ['awaiting_driver'], driverId: null }, message: 'This plan has already been taken.' });
  if (!updated) throw new HttpError(409, 'This plan has already been taken.');
  notify(p.userId, `Driver confirmed for ${p.ref}`, `${me.name} (${me.vehicle || 'vehicle on file'}) will drive your ${KINDS[p.kind].toLowerCase()} from ${p.startDate}.`, 'plans');
  res.json({ plan: planView(updated, req.user) });
}));

router.post('/drivers/plans/:id/release', driverOnly, wrap(async (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || p.driverId !== req.user.id || p.status !== 'active') throw new HttpError(404, 'Plan not found.');
  const reason = str(req.body?.reason, 'Reason', { min: 3, max: 200 });
  const updated = await db.updateStrict('plans', p.id, { driverId: null, status: 'awaiting_driver', history: addHistory(p, 'awaiting_driver', `Driver released: ${reason}`) }, { when: { driverId: req.user.id } });
  if (!updated) throw new HttpError(409, 'This plan just changed. Please refresh.');
  notify(p.userId, `${p.ref}: finding a new driver`, 'Your driver can no longer do this plan. We are offering it to other vetted drivers now; trips still run with the nearest available driver.', 'plans');
  securityEvent('plan_driver_released', { plan: p.ref, driver: req.user.id, reason }, 'medium');
  notifyDriversOfPlan(updated);
  res.json({ ok: true });
}));

/** Tell nearby eligible drivers a plan is waiting (in-app notification, capped). */
export function notifyDriversOfPlan(p) {
  let n = 0;
  for (const d of db.filter('users', (u) => u.role === 'driver' && u.driverStatus === 'approved')) {
    if (n >= 25) break;
    if (p.kind === 'scholar' && !scholarEligibility(d.id).eligible) continue;
    notify(d.id, `New monthly ${KINDS[p.kind].toLowerCase()} plan`, `${p.legs.map((l) => l.time).join(' & ')} · ${p.days.length} days a week from ${p.startDate}. Open Monthly plans to accept.`, 'plans', { push: false });
    n++;
  }
}

/* ---------------- Staff view ---------------- */
router.get('/admin/plans', requireRole('admin', 'support', 'finance'), (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const list = db.filter('plans', (p) => !status || p.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
  res.json({ plans: list.map((p) => planView(p, req.user)) });
});

export default router;
