import { imageFor } from '../vehicles.js';
import { Router } from 'express';
import { db, id, now, nextRef } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { str, oneOf, wrap, bad, HttpError } from '../validate.js';
import { notify, audit } from '../kyc.js';
import { securityEvent } from '../monitor.js';
import { verificationGate } from './bookings.js';
import { getLocation } from '../tracking/locations.js';
import * as paystack from '../money/paystack.js';
import { cents } from '../money/ledger.js';
import {
  KINDS, MAX_RIDERS, SKIP_NOTICE_HOURS, CANCEL_NOTICE_HOURS, pricePlan, planView, addHistory, scholarEligibility, clashes,
  sastDate, sastTime, publicHolidays,
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
  if (ridersIn.length > MAX_RIDERS[category]) throw bad(`A ${category} vehicle takes up to ${MAX_RIDERS[category]} ${kind === 'scholar' ? 'learners' : 'passengers'}. ${category === 'Minibus' ? 'Split the group into two plans.' : 'Choose a bigger vehicle (XL up to 6, Minibus up to 14) or split the group.'}`);
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

/* ---------------- Dashboards ---------------- */
const ACTIVE_TRIP = ['requested', 'accepted', 'arriving', 'in_progress'];
const ON_TIME_MIN = 10;
const startedAt = (b) => b.history?.find((h) => h.status === 'in_progress')?.at;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Everything a dashboard shows about one plan: trips by day and leg (for the calendar), what has been
 * driven and spent, punctuality (pickup started within 10 minutes of the planned time), and the next trip.
 */
export function planStats(p, nowMs = Date.now()) {
  const trips = db.filter('bookings', (b) => b.planId === p.id);
  const byDate = {};
  for (const t of trips) (byDate[t.planDate] ||= {})[t.planLeg] = { id: t.id, ref: t.ref, status: t.status, driverId: t.driverId || null, startedAt: startedAt(t) || null };
  const driven = trips.filter((t) => t.status === 'completed');
  const timed = driven.filter((t) => startedAt(t) && t.scheduledFor);
  const onTime = timed.filter((t) => Date.parse(startedAt(t)) <= Date.parse(t.scheduledFor) + ON_TIME_MIN * 60_000).length;
  const cutoff = p.cancelEffective ? Date.parse(p.cancelEffective) : Infinity;
  const planned = p.pricing.dates.filter((d) => !(p.skipDates || []).includes(d));
  let next = null;
  if (['active', 'awaiting_driver'].includes(p.status) || (p.status === 'cancelled' && cutoff > nowMs)) {
    for (const d of planned) {
      for (const l of p.legs) {
        const dep = sastTime(d, l.time);
        const done = byDate[d]?.[l.key] && !ACTIVE_TRIP.includes(byDate[d][l.key].status);
        if (dep + 20 * 60_000 > nowMs && dep < cutoff && !done) { next = { date: d, time: l.time, leg: l.key, label: l.label, departure: new Date(dep).toISOString(), bookingId: byDate[d]?.[l.key]?.id || null }; break; }
      }
      if (next) break;
    }
  }
  const [y, m] = p.startDate.split('-').map(Number);
  const holidays = [...publicHolidays(y)].filter((h) => h.startsWith(`${y}-${String(m).padStart(2, '0')}`)).sort();
  const tripsPlanned = planned.filter((d) => sastTime(d, p.legs[0].time) < cutoff).length * p.legs.length;
  return {
    byDate, holidays, next,
    tripsPlanned, tripsDriven: driven.length, tripsMissed: trips.filter((t) => t.status === 'cancelled').length,
    spent: r2(driven.reduce((s2, t) => s2 + t.fare, 0)),
    onTimeRate: timed.length ? Math.round((onTime / timed.length) * 100) : null,
  };
}

/** Owner dashboard: KPIs, today's trips (with live status), and every plan with its stats. */
router.get('/plans/dashboard', requireAuth, (req, res) => {
  const kind = req.user.role === 'business' ? 'staff' : 'scholar';
  const plans = db.filter('plans', (p) => p.userId === req.user.id && p.kind === kind).sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  const today = sastDate();
  const month = today.slice(0, 7);
  const withStats = plans.map((p) => ({ ...planView(p, req.user), stats: planStats(p) }));
  const live = withStats.filter((p) => ['active', 'awaiting_driver', 'awaiting_payment'].includes(p.status));
  const todayTrips = [];
  for (const p of withStats) {
    if (!p.pricing.dates.includes(today) || p.skipDates.includes(today) || !['active', 'awaiting_driver', 'cancelled'].includes(p.status)) continue;
    for (const l of p.legs) {
      const dep = sastTime(today, l.time);
      if (p.cancelEffective && dep >= Date.parse(p.cancelEffective)) continue;
      const t = p.stats.byDate[today]?.[l.key];
      const b = t ? db.byId('bookings', t.id) : null;
      const driver = b?.driverId ? db.byId('users', b.driverId) : null;
      todayTrips.push({ planId: p.id, planRef: p.ref, title: p.kind === 'scholar' ? p.school : p.destination, time: l.time, label: l.label, from: l.from, to: l.to,
        riders: (p.riders || []).map((r) => r.name), status: t?.status || 'scheduled', bookingId: t?.id || null,
        driver: driver ? { name: driver.name, vehicle: driver.vehicle || '' } : p.driver, departure: new Date(dep).toISOString() });
    }
  }
  todayTrips.sort((a, b) => a.departure.localeCompare(b.departure));
  const thisMonth = withStats.filter((p) => p.month === month);
  const timedRates = withStats.filter((p) => p.stats.onTimeRate != null);
  const nextUp = live.map((p) => p.stats.next && { ...p.stats.next, planId: p.id, planRef: p.ref, title: p.kind === 'scholar' ? p.school : p.destination, riders: (p.riders || []).map((r) => r.name), driver: p.driver })
    .filter(Boolean).sort((a, b) => a.departure.localeCompare(b.departure))[0] || null;
  res.json({
    kind, today,
    kpis: {
      activePlans: live.filter((p) => p.status === 'active').length,
      awaitingDriver: live.filter((p) => p.status === 'awaiting_driver').length,
      awaitingPayment: live.filter((p) => p.status === 'awaiting_payment').length,
      riders: new Set(live.flatMap((p) => (p.riders || []).map((r) => r.name.toLowerCase()))).size,
      tripsDrivenThisMonth: thisMonth.reduce((s2, p) => s2 + p.stats.tripsDriven, 0),
      tripsPlannedThisMonth: thisMonth.reduce((s2, p) => s2 + p.stats.tripsPlanned, 0),
      spentThisMonth: r2(thisMonth.reduce((s2, p) => s2 + p.stats.spent, 0)),
      committedThisMonth: r2(thisMonth.filter((p) => p.paymentStatus !== 'pending').reduce((s2, p) => s2 + p.pricing.total, 0)),
      refunded: r2(withStats.reduce((s2, p) => s2 + (p.refundedAmount || 0), 0)),
      onTimeRate: timedRates.length ? Math.round(timedRates.reduce((s2, p) => s2 + p.stats.onTimeRate * p.stats.tripsDriven, 0) / Math.max(1, timedRates.reduce((s2, p) => s2 + p.stats.tripsDriven, 0))) : null,
    },
    nextUp, todayTrips, plans: withStats,
  });
});

router.get('/plans/:id', requireAuth, (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || ![p.userId, p.driverId].includes(req.user.id) && !['admin', 'support', 'compliance', 'finance'].includes(req.user.role)) throw new HttpError(404, 'Plan not found.');
  const trips = db.filter('bookings', (b) => b.planId === p.id).sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)))
    .map((b) => ({ id: b.id, ref: b.ref, date: b.planDate, leg: b.planLeg, status: b.status, scheduledFor: b.scheduledFor, fare: b.fare }));
  res.json({ plan: planView(p, req.user), trips });
});

/**
 * Map for a plan: pickup and destination, the vehicle picture (the driver's own vehicle type, or the
 * plan's category), and the vehicle's live position while one of the plan's trips is under way.
 */
router.get('/plans/:id/map', requireAuth, wrap(async (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || ![p.userId, p.driverId].includes(req.user.id) && !['admin', 'support', 'compliance', 'finance'].includes(req.user.role)) throw new HttpError(404, 'Plan not found.');
  const leg = p.legs[0];
  const [pickup, destination] = await Promise.all([locate(leg.from), locate(leg.to)]);
  const driver = p.driverId ? db.byId('users', p.driverId) : null;
  const trip = db.find('bookings', (b) => b.planId === p.id && ['accepted', 'arriving', 'in_progress'].includes(b.status));
  const tripDriver = trip?.driverId ? db.byId('users', trip.driverId) : driver;
  const loc = trip?.driverId ? await getLocation(trip.driverId) : null;
  res.json({
    pickup: pickup && { lat: pickup.lat, lng: pickup.lng, label: leg.from }, destination: destination && { lat: destination.lat, lng: destination.lng, label: leg.to },
    vehicleType: imageFor(tripDriver, { category: p.category }), vehicle: tripDriver?.vehicle || '',
    live: trip && loc ? { lat: loc.lat, lng: loc.lng, heading: loc.heading || 0, at: loc.at, bookingId: trip.id, status: trip.status } : null,
  });
}));

/** A plan's statement (every trip with status and fare) as CSV, for records or the accounts department. */
router.get('/plans/:id/statement.csv', requireAuth, (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || (p.userId !== req.user.id && !['admin', 'support', 'finance'].includes(req.user.role))) throw new HttpError(404, 'Plan not found.');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const trips = db.filter('bookings', (b) => b.planId === p.id).sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const lines = [['Plan', 'Date', 'Trip', 'Booking', 'Status', 'Driver', 'Planned pickup', 'Pickup started', 'Fare (R)'].map(esc).join(',')];
  for (const t of trips) {
    const d = t.driverId ? db.byId('users', t.driverId) : null;
    lines.push([p.ref, t.planDate, p.legs.find((l) => l.key === t.planLeg)?.label, t.ref, t.status, d?.name || '', t.scheduledFor, startedAt(t) || '', t.status === 'completed' ? t.fare.toFixed(2) : '0.00'].map(esc).join(','));
  }
  const used = trips.filter((t) => t.status === 'completed').reduce((s2, t) => s2 + t.fare, 0);
  lines.push('', [p.ref, 'Totals', `${trips.filter((t) => t.status === 'completed').length} trips driven`, '', '', '', '', 'Paid / invoiced', used.toFixed(2)].map(esc).join(','));
  if (p.paymentStatus !== 'invoice') lines.push([p.ref, '', '', '', '', '', '', 'Paid in advance', p.pricing.total.toFixed(2)].map(esc).join(','), [p.ref, '', '', '', '', '', '', 'Refunded', (p.refundedAmount || 0).toFixed(2)].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${p.ref}-statement.csv"`);
  res.send(lines.join('\n'));
});

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

/* ---------------- Operations console (DROP staff) ---------------- */
const opsRead = requireRole('admin', 'support', 'finance');
const opsWrite = requireRole('admin', 'support');

router.get('/admin/plans', opsRead, (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const kind = req.query.kind ? String(req.query.kind) : null;
  const q = String(req.query.q || '').toLowerCase().trim();
  const today = sastDate();
  const soon = sastDate(Date.now() + 7 * 86_400_000);
  const all = db.filter('plans', () => true);
  const list = all.filter((p) => (!status || p.status === status) && (!kind || p.kind === kind)
    && (!q || [p.ref, p.school, p.destination, p.pickup, db.byId('users', p.userId)?.name, db.byId('users', p.driverId || '')?.name].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
  const risks = all.filter((p) => !p.closedAt && (
    (p.status === 'awaiting_driver' && p.startDate <= soon)
    || (p.refundFailures || 0) > 0
    || (p.status === 'awaiting_payment' && p.renewedFromId && p.startDate <= soon)));
  res.json({
    kpis: {
      active: all.filter((p) => p.status === 'active').length,
      awaitingDriver: all.filter((p) => p.status === 'awaiting_driver').length,
      awaitingPayment: all.filter((p) => p.status === 'awaiting_payment').length,
      scholar: all.filter((p) => p.kind === 'scholar' && ['active', 'awaiting_driver'].includes(p.status)).length,
      staff: all.filter((p) => p.kind === 'staff' && ['active', 'awaiting_driver'].includes(p.status)).length,
      tripsToday: db.filter('bookings', (b) => b.planId && b.planDate === today).length,
      escrowHeld: r2(all.filter((p) => p.paymentStatus === 'paid' && !p.closedAt).reduce((s2, p) => s2 + p.pricing.total - planStats(p).spent, 0)),
      refundsFailing: all.filter((p) => (p.refundFailures || 0) > 0 && !p.closedAt).length,
    },
    risks: risks.map((p) => ({ id: p.id, ref: p.ref, kind: p.kind, status: p.status, startDate: p.startDate,
      reason: (p.refundFailures || 0) > 0 ? `Refund failing (${p.refundFailures} attempts): ${p.refundError || ''}` : p.status === 'awaiting_driver' ? `No driver, starts ${p.startDate}` : `Renewal not paid, starts ${p.startDate}` })),
    plans: list.map((p) => ({ ...planView(p, req.user), stats: (({ byDate, ...rest }) => rest)(planStats(p)) })),
  });
});

router.get('/admin/plans/:id', opsRead, (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p) throw new HttpError(404, 'Plan not found.');
  const owner = db.byId('users', p.userId);
  const trips = db.filter('bookings', (b) => b.planId === p.id).sort((a, b) => String(b.scheduledFor).localeCompare(String(a.scheduledFor)))
    .map((b) => ({ id: b.id, ref: b.ref, date: b.planDate, leg: b.planLeg, status: b.status, fare: b.fare, driver: b.driverId ? db.byId('users', b.driverId)?.name : null, scheduledFor: b.scheduledFor, startedAt: startedAt(b) || null }));
  res.json({
    plan: { ...planView(p, req.user), stats: planStats(p), usedAmount: p.usedAmount ?? null, refundError: p.refundError || null, refundFailures: p.refundFailures || 0, closedAt: p.closedAt || null, cancelReason: p.cancelReason || '' },
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone, company: owner.company || '' } : null,
    trips,
  });
});

/** Drivers who could take this plan: eligible (vetted for scholar plans), no clash, nearest first. */
router.get('/admin/plans/:id/candidates', opsWrite, wrap(async (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p) throw new HttpError(404, 'Plan not found.');
  const out = [];
  for (const d of db.filter('users', (u) => u.role === 'driver' && u.driverStatus === 'approved' && u.id !== p.driverId)) {
    if (p.kind === 'scholar' && !scholarEligibility(d.id).eligible) continue;
    const mine = db.filter('plans', (x) => x.driverId === d.id && ['active', 'awaiting_payment'].includes(x.status));
    if (mine.some((m) => clashes(m, p))) continue;
    const loc = await getLocation(d.id);
    out.push({ id: d.id, name: d.name, vehicle: d.vehicle || '', rating: d.rating || null, online: Boolean(d.online), plans: mine.length,
      distanceKm: loc && p.pickupLoc ? Math.round(distanceKm(loc, p.pickupLoc) * 10) / 10 : null });
  }
  out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  res.json({ candidates: out.slice(0, 50) });
}));

/** Assign or reassign the plan's driver (same rules as a driver accepting it). */
router.post('/admin/plans/:id/assign', opsWrite, wrap(async (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || !['awaiting_driver', 'active', 'awaiting_payment'].includes(p.status)) throw new HttpError(404, 'This plan is not open.');
  const d = db.byId('users', String(req.body?.driverId || ''));
  if (!d || d.role !== 'driver' || d.driverStatus !== 'approved') throw bad('Choose an approved driver.');
  if (p.kind === 'scholar') { const e = scholarEligibility(d.id); if (!e.eligible) throw bad(`This driver is not vetted for scholar transport (missing: ${e.missing.join(', ').replace(/_/g, ' ')}).`); }
  if (db.filter('plans', (x) => x.driverId === d.id && x.id !== p.id && ['active', 'awaiting_payment'].includes(x.status)).some((m) => clashes(m, p))) throw bad('That driver already has a plan at these times.');
  const reason = str(req.body?.reason, 'Reason', { min: 3, max: 200 });
  const previous = p.driverId;
  const status = p.status === 'awaiting_payment' ? 'awaiting_payment' : 'active';
  const updated = await db.updateStrict('plans', p.id, { driverId: d.id, acceptedAt: now(), status, history: addHistory(p, status, `Driver assigned by ${req.user.name}: ${d.name} (${reason})`) }, { when: { driverId: previous ?? null } });
  if (!updated) throw new HttpError(409, 'The plan just changed. Please refresh.');
  audit(req.user, 'plan.driver_assigned', p.id, { plan: p.ref, driver: d.id, previous: previous || '', reason });
  notify(d.id, `You’ve been assigned plan ${p.ref}`, `${KINDS[p.kind]} from ${p.startDate}: ${p.legs.map((l) => l.time).join(' & ')}, ${p.days.length} days a week. Open Monthly plans for details.`, 'plans');
  if (previous && previous !== d.id) notify(previous, `Plan ${p.ref} reassigned`, 'Operations moved this plan to another driver. You will not be sent its trips.', 'plans');
  notify(p.userId, `New driver for ${p.ref}`, `${d.name} (${d.vehicle || 'vehicle on file'}) will drive your ${KINDS[p.kind].toLowerCase()}.`, 'plans');
  res.json({ plan: planView(updated, req.user) });
}));

/** Cancel on the customer's behalf (e.g. they phoned in). Same 24-hour rule and refunds as self-service. */
router.post('/admin/plans/:id/cancel', opsWrite, wrap(async (req, res) => {
  const p = db.byId('plans', String(req.params.id));
  if (!p || !OPEN_STATUSES.includes(p.status)) throw bad('This plan is already closed.');
  const reason = str(req.body?.reason, 'Reason', { min: 3, max: 200 });
  const immediate = req.body?.immediate === true && req.user.role === 'admin';
  const effective = immediate || p.status === 'awaiting_payment' ? now() : new Date(Math.max(Date.now() + CANCEL_NOTICE_HOURS() * 3_600_000, Date.parse(`${p.startDate}T00:00:00+02:00`))).toISOString();
  const updated = db.update('plans', p.id, { status: 'cancelled', cancelEffective: effective, cancelReason: reason, autoRenew: false, history: addHistory(p, 'cancelled', `Cancelled by ${req.user.name}: ${reason}`) });
  audit(req.user, 'plan.cancelled', p.id, { plan: p.ref, reason, immediate: String(immediate) });
  notify(p.userId, `${p.ref} cancelled`, 'DROP support has cancelled this plan as requested. Every trip that doesn’t run is refunded to you when the period closes. Contact support if you didn’t ask for this.', 'plans');
  if (p.driverId) notify(p.driverId, `Plan ${p.ref} cancelled`, 'This plan was cancelled by operations.', 'plans');
  res.json({ plan: planView(updated, req.user) });
}));

export default router;
