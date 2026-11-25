import { db, id, now, nextRef, ConflictError } from './db.js';
import { notify } from './kyc.js';
import { securityEvent } from './monitor.js';
import { KINDS, GENERATE_BEFORE_MIN, sastDate, sastTime, pricePlan, addHistory } from './plans.js';
import { invalidate as invalidateDispatch } from './dispatch.js';
import { onTripStatus } from './routes/comms.js';
import { emit } from './comms/hub.js';
import * as paystack from './money/paystack.js';
import { cents } from './money/ledger.js';
import { recordPlanRefund } from './money/settlement.js';

/**
 * Monthly plan jobs, run every minute on the leader server:
 *  1. trips   — shortly before each departure, the day's trip becomes an ordinary booking, assigned
 *               to the plan's driver (or offered to nearby drivers if the plan has none or the
 *               driver is still on another trip). One booking per plan, day and leg: PostgreSQL's
 *               idempotency index makes a second server's attempt a no-op.
 *  2. close   — when the period ends (or a cancellation takes effect) and its trips are finished,
 *               everything paid but not driven is refunded to the card in one partial refund.
 *               Paid = driven + refunded, to the cent, so escrow always nets to zero.
 *  3. renew   — from the 20th, plans set to renew get next month's plan with the same driver.
 *  4. remind  — owners of plans still without a driver the day before they start.
 */
const ACTIVE_TRIP = ['requested', 'accepted', 'arriving', 'in_progress'];
const round2 = (n) => Math.round(n * 100) / 100;
const RENEW_DAY = () => Number(process.env.PLAN_RENEW_DAY ?? 20);
const nextMonthStart = (date) => { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const endOfMonth = (date) => { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

function tripRecord(plan, leg, date, dep) {
  const price = plan.pricing.perLeg.find((l) => l.key === leg.key);
  const out = leg.key === 'out';
  const riders = plan.riders.map((r) => (r.grade ? `${r.name} (${r.grade})` : r.name)).join(', ');
  const notes = [
    `${KINDS[plan.kind]} · plan ${plan.ref}`,
    plan.kind === 'scholar' && plan.school ? `School: ${plan.school}` : '',
    plan.guardian?.handover ? `Drop-off: ${plan.guardian.handover}` : '',
    ...plan.riders.filter((r) => r.notes).map((r) => `${r.name}: ${r.notes}`),
  ].filter(Boolean).join(' · ').slice(0, 600);
  return {
    id: id(), idemKey: `plan:${plan.id}:${date}:${leg.key}`, openSlot: null, ref: nextRef('booking', 'DRP'), userId: plan.userId,
    service: 'Ride', category: plan.category, pickup: leg.from, destination: leg.to, passengers: plan.riders.length, parcel: '',
    passengerName: riders.slice(0, 80), notes, scheduledFor: new Date(dep).toISOString(),
    payment: plan.payment === 'Card' ? 'Card' : 'Business account', paymentStatus: plan.payment === 'Card' ? 'paid' : 'invoice',
    paymentReference: null, distanceKm: price.distanceKm, durationMin: price.durationMin, approximate: price.approximate,
    fare: price.fare, passengerCommission: 0, driverServiceFee: price.driverServiceFee, driverEarnings: price.driverEarnings,
    pickupLoc: (out ? plan.pickupLoc : plan.destinationLoc) ?? undefined, destinationLoc: (out ? plan.destinationLoc : plan.pickupLoc) ?? undefined,
    planId: plan.id, planDate: date, planLeg: leg.key, requiresScholarVetting: plan.kind === 'scholar',
    rating: null, feedback: '', createdAt: now(),
  };
}

async function generateTrips(nowMs) {
  const today = sastDate(nowMs);
  const lead = GENERATE_BEFORE_MIN() * 60_000;
  let made = 0;
  for (const plan of db.filter('plans', (p) => ['active', 'awaiting_driver', 'cancelled'].includes(p.status) && ['paid', 'invoice'].includes(p.paymentStatus) && !p.closedAt)) {
    if (!plan.pricing.dates.includes(today) || (plan.skipDates || []).includes(today)) continue;
    for (const leg of plan.legs) {
      const dep = sastTime(today, leg.time);
      if (nowMs < dep - lead || nowMs > dep + 20 * 60_000) continue;
      if (plan.status === 'cancelled' && (!plan.cancelEffective || dep >= Date.parse(plan.cancelEffective))) continue;
      const key = `plan:${plan.id}:${today}:${leg.key}`;
      if (db.find('bookings', (b) => b.idemKey === key)) continue;
      const base = tripRecord(plan, leg, today, dep);
      const driver = plan.status === 'active' && plan.driverId ? db.byId('users', plan.driverId) : null;
      const driverBusy = driver && db.find('bookings', (b) => b.driverId === driver.id && ['accepted', 'arriving', 'in_progress'].includes(b.status));
      const assigned = driver && driver.driverStatus === 'approved' && !driverBusy;
      const make = (withDriver) => db.insertStrict('bookings', {
        ...base,
        ...(withDriver
          ? { status: 'accepted', driverId: driver.id, acceptedAt: now(), history: [{ status: 'requested', at: now(), note: `Monthly plan ${plan.ref}` }, { status: 'accepted', at: now(), note: 'Plan driver' }] }
          : { status: 'requested', driverId: null, history: [{ status: 'requested', at: now(), note: `Monthly plan ${plan.ref}${plan.driverId ? ' (plan driver unavailable)' : ''}` }] }),
      }, { conflict: (b) => b.idemKey === key, message: 'Already created.' });
      let b;
      try { b = await make(assigned); }
      catch (err) {
        if (!(err instanceof ConflictError)) throw err;
        if (err.constraint === 'drop_one_active_trip') { try { b = await make(false); } catch (e2) { if (!(e2 instanceof ConflictError)) throw e2; continue; } }
        else continue; // another server made it
      }
      made++;
      onTripStatus(b);
      if (b.driverId) {
        notify(b.driverId, `Plan trip at ${leg.time}`, `${leg.label} · ${plan.riders.length} ${plan.kind === 'scholar' ? 'learner(s)' : 'passenger(s)'} · ${leg.from}`, 'trip');
        emit(b.driverId, 'trip', { bookingId: b.id, status: b.status });
      } else {
        invalidateDispatch();
        if (plan.driverId) {
          notify(plan.userId, `${plan.ref}: another driver today`, `Your plan driver is still finishing another trip, so the ${leg.time} trip is being offered to the nearest ${plan.kind === 'scholar' ? 'vetted scholar-transport ' : ''}driver. Track it in My DROP.`, 'trip');
          securityEvent('plan_trip_reassigned', { plan: plan.ref, booking: b.ref }, 'medium');
        }
      }
    }
  }
  return made;
}

async function closePeriods(nowMs) {
  const today = sastDate(nowMs);
  let closed = 0;
  for (const plan of db.filter('plans', (p) => !p.closedAt && ['active', 'awaiting_driver', 'cancelled', 'awaiting_payment'].includes(p.status))) {
    const ended = plan.endDate < today || (plan.status === 'cancelled' && plan.cancelEffective && nowMs > Date.parse(plan.cancelEffective));
    if (!ended) continue;
    if (plan.status === 'awaiting_payment' || plan.paymentStatus === 'pending') {
      db.update('plans', plan.id, { status: plan.status === 'cancelled' ? 'cancelled' : 'expired', closedAt: now(), history: addHistory(plan, 'expired', 'Not paid') });
      closed++; continue;
    }
    const trips = db.filter('bookings', (b) => b.planId === plan.id);
    if (trips.some((b) => ACTIVE_TRIP.includes(b.status))) continue; // wait for today's trips to finish
    const used = round2(trips.filter((b) => b.status === 'completed').reduce((s, b) => s + b.fare, 0));
    const patch = { closedAt: now(), usedAmount: used, status: plan.status === 'cancelled' ? 'cancelled' : 'completed' };
    if (plan.paymentStatus === 'paid') {
      const refund = round2(plan.pricing.total - used);
      if (refund > 0) {
        if (plan.refundAttemptAt && nowMs - Date.parse(plan.refundAttemptAt) < 30 * 60_000) continue;
        try {
          await paystack.refund(plan.paymentReference, cents(refund));
          recordPlanRefund(plan, { reference: plan.paymentReference, amountCents: cents(refund) });
          Object.assign(patch, { refundedAmount: refund, paymentStatus: used > 0 ? 'partly_refunded' : 'refunded', refundedAt: now() });
        } catch (err) {
          const failures = (plan.refundFailures || 0) + 1;
          db.update('plans', plan.id, { refundAttemptAt: now(), refundError: err.message.slice(0, 160), refundFailures: failures });
          if (failures === 4) securityEvent('plan_refund_failing', { plan: plan.ref, amount: String(refund) }, 'high');
          continue;
        }
      }
    }
    const updated = db.update('plans', plan.id, { ...patch, history: addHistory(plan, patch.status, patch.refundedAmount ? `Refunded R${patch.refundedAmount.toFixed(2)} for unused trips` : 'Period closed') });
    const driven = trips.filter((b) => b.status === 'completed').length;
    notify(plan.userId, `${plan.ref} statement`, `${driven} trip${driven === 1 ? '' : 's'} driven, R${used.toFixed(2)}.${updated.refundedAmount ? ` R${updated.refundedAmount.toFixed(2)} refunded to your card for unused trips (allow 5–10 business days).` : ''}`, 'plans');
    closed++;
  }
  return closed;
}

function renewals(nowMs) {
  const today = sastDate(nowMs);
  if (Number(today.slice(8, 10)) < RENEW_DAY()) return 0;
  let n = 0;
  for (const plan of db.filter('plans', (p) => p.status === 'active' && p.autoRenew && !p.renewedToId && p.endDate === endOfMonth(today))) {
    const owner = db.byId('users', plan.userId);
    if (!owner || owner.disabled || owner.deletedAt) continue;
    const startDate = nextMonthStart(today);
    const pricing = pricePlan({ category: plan.category, legs: plan.legs, start: startDate, days: plan.days });
    if (!pricing.trips) continue;
    const driver = plan.driverId ? db.byId('users', plan.driverId) : null;
    const keepDriver = driver && driver.driverStatus === 'approved' ? driver.id : null;
    const card = plan.payment === 'Card';
    const status = card ? 'awaiting_payment' : keepDriver ? 'active' : 'awaiting_driver';
    const next = db.insert('plans', {
      ...plan, id: id(), ref: nextRef('plan', 'MPL'), startDate, endDate: endOfMonth(startDate), month: startDate.slice(0, 7), pricing,
      paymentStatus: card ? 'pending' : 'invoice', paymentReference: null, pendingPaymentReference: null, status, driverId: keepDriver,
      acceptedAt: keepDriver ? now() : null, skipDates: [], renewedFromId: plan.id, renewedToId: null, closedAt: null, usedAmount: undefined,
      refundedAmount: undefined, refundedAt: undefined, refundAttemptAt: undefined, refundFailures: undefined, refundError: undefined, remindedAt: undefined, cancelEffective: null, cancelReason: '',
      createdAt: now(), history: [{ status, at: now(), note: `Renewed from ${plan.ref}` }],
    });
    db.update('plans', plan.id, { renewedToId: next.id });
    notify(plan.userId, `${KINDS[plan.kind]} for ${startDate.slice(0, 7)}`, card
      ? `Next month's plan ${next.ref} is ready: R${pricing.total.toFixed(2)} for ${pricing.trips} trips. Pay before the 1st to keep your driver. You can change or cancel it in My DROP.`
      : `Next month's plan ${next.ref} is set up (${pricing.trips} trips, invoiced monthly).`, 'plans');
    if (keepDriver) notify(keepDriver, `Plan ${plan.ref} renews`, `The same trips continue from ${startDate} as ${next.ref}${card ? ' once the customer pays' : ''}.`, 'plans');
    n++;
  }
  return n;
}

function reminders(nowMs) {
  const tomorrow = sastDate(nowMs + 86_400_000);
  for (const plan of db.filter('plans', (p) => p.status === 'awaiting_driver' && p.startDate === tomorrow && !p.remindedAt)) {
    db.update('plans', plan.id, { remindedAt: now() });
    notify(plan.userId, `${plan.ref}: no driver confirmed yet`, `Tomorrow's trips will still be offered to the nearest ${plan.kind === 'scholar' ? 'vetted scholar-transport ' : ''}drivers, and you can track each one. You can cancel for a full refund of trips that don't run.`, 'plans');
  }
  // Renewed plans not paid two days after they should have started release the driver.
  for (const plan of db.filter('plans', (p) => p.status === 'awaiting_payment' && p.renewedFromId && Date.parse(p.startDate) + 2 * 86_400_000 < nowMs)) {
    db.update('plans', plan.id, { status: 'cancelled', cancelEffective: now(), closedAt: now(), history: addHistory(plan, 'cancelled', 'Not paid within 2 days of the start') });
    if (plan.driverId) notify(plan.driverId, `Plan ${plan.ref} did not renew`, 'The customer did not pay for this month, so the plan has ended.', 'plans');
  }
}

export async function runPlanJobs(nowMs = Date.now()) {
  const made = await generateTrips(nowMs);
  const closed = await closePeriods(nowMs);
  const renewed = renewals(nowMs);
  reminders(nowMs);
  return { made, closed, renewed };
}
