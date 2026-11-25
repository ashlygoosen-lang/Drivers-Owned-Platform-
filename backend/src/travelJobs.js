import { db, now } from './db.js';
import { audit } from './kyc.js';
import { securityEvent } from './monitor.js';
import { JOINABLE, PRE_CONFIRM, releaseSeats } from './travel.js';
import { PAID_BOOKING, members, refundBooking, cancelBooking, tell, tripLabel } from './travelService.js';

/**
 * Group travel jobs (every minute, leader server):
 *  holds      — unpaid seat holds expire after TRAVEL_HOLD_MINUTES and the seats go back.
 *  reminders  — deadline approaching (7 and 2 days, for groups still filling) and balance due (14, 7, 2 days).
 *  balances   — a deposit whose balance is still unpaid 48 hours after it was due is cancelled under the
 *               cancellation policy (the fee comes out of the deposit).
 *  deadline   — at the fill deadline the group closes; below its minimum it fails (refund or transfer offer).
 *  transfers  — transfer offers not taken within 7 days are refunded.
 *  refunds    — refunds that failed are retried every 30 minutes; repeated failures raise an alert.
 *  complete   — ticketed groups are completed the day after travel.
 */
const DAY = 86_400_000;
const BALANCE_GRACE_MS = () => Number(process.env.TRAVEL_BALANCE_GRACE_HOURS ?? 48) * 3_600_000;
const TRANSFER_DAYS = () => Number(process.env.TRAVEL_TRANSFER_OFFER_DAYS ?? 7);

/** Cancel a group and apply its failure policy. Used at the deadline and by admins. */
export async function failGroup(g, { reason, policy = g.failurePolicy, actor = null, nowMs = Date.now() }) {
  const fresh = db.byId('travelGroups', g.id);
  if (fresh.status === 'CANCELLED') return fresh;
  db.update('travelGroups', g.id, { status: 'CANCELLED', cancelledAt: now(), cancelReason: reason, history: [...fresh.history, { status: 'CANCELLED', at: now(), note: `${reason} (${policy === 'transfer' ? 'transfer offered' : 'refunded'})` }] });
  if (actor) audit(actor, 'travel.group_cancelled', g.id, { group: g.ref, reason, policy });
  for (const b of db.filter('groupBookings', (x) => x.groupId === g.id && ['held', ...PAID_BOOKING].includes(x.status))) {
    if (b.status === 'held') { db.update('groupBookings', b.id, { status: 'expired', history: [...b.history, { status: 'expired', at: now(), note: 'Group cancelled' }] }); continue; }
    const held = (b.paidCents || 0) - (b.refundedCents || 0);
    if (policy === 'transfer') {
      const until = new Date(nowMs + TRANSFER_DAYS() * DAY).toISOString();
      db.update('groupBookings', b.id, { status: 'transfer_offered', transferOfferExpiresAt: until, history: [...b.history, { status: 'transfer_offered', at: now(), note: reason }] });
      tell(b.userId, `Your group ${g.ref} didn’t fill: choose another date`, `${tripLabel(g)} did not reach its minimum of ${g.minimum} travellers. You can move to another group on this route at no extra cost, or take a full refund of R${(held / 100).toFixed(2)}. If you don’t choose by ${new Date(until).toLocaleDateString('en-ZA')}, we refund you automatically.`);
    } else {
      db.update('groupBookings', b.id, { status: 'refunded', history: [...b.history, { status: 'refunded', at: now(), note: reason }] });
      await refundBooking(b, held, reason);
      tell(b.userId, `Your group ${g.ref} was cancelled: full refund`, `${tripLabel(g)} did not go ahead (${reason}). We are refunding R${(held / 100).toFixed(2)} in full to your card; allow 5–10 business days.`);
    }
  }
  return db.byId('travelGroups', g.id);
}

async function holds(nowMs) {
  for (const b of db.filter('groupBookings', (x) => x.status === 'held' && Date.parse(x.holdExpiresAt) < nowMs)) {
    db.update('groupBookings', b.id, { status: 'expired', history: [...b.history, { status: 'expired', at: now(), note: 'Seat hold expired before payment' }] });
    const g = db.byId('travelGroups', b.groupId);
    if (g && PRE_CONFIRM.includes(g.status)) await releaseSeats(g.id, b.seats);
  }
}

function reminders(nowMs) {
  for (const g of db.filter('travelGroups', (x) => JOINABLE.includes(x.status) && x.paidSeats < x.capacity)) {
    const left = Date.parse(g.deadline) - nowMs;
    for (const d of [7, 2]) {
      const key = `deadline-${d}`;
      if (left > 0 && left <= d * DAY && !(g.reminders || []).includes(key)) {
        db.update('travelGroups', g.id, { reminders: [...(g.reminders || []), key] });
        const short = Math.max(0, g.minimum - g.paidSeats);
        for (const b of members(g.id)) tell(b.userId, `${d} days left to fill your group ${g.ref}`, `${tripLabel(g)}: ${g.paidSeats} of ${g.capacity} seats taken${short ? `; ${short} more traveller(s) needed to confirm the trip` : ''}. Share the trip with friends and family to help it fill.`);
      }
    }
  }
  for (const b of db.filter('groupBookings', (x) => x.status === 'deposit_paid' && x.balanceDueAt)) {
    const left = Date.parse(b.balanceDueAt) - nowMs;
    for (const d of [14, 7, 2]) {
      const key = `balance-${d}`;
      if (left > 0 && left <= d * DAY && !(b.reminders || []).includes(key)) {
        db.update('groupBookings', b.id, { reminders: [...(b.reminders || []), key] });
        tell(b.userId, `Balance due in ${d} days: ${b.ref}`, `Please pay the balance of R${(b.total - (b.paidCents || 0) / 100).toFixed(2)} by ${new Date(b.balanceDueAt).toLocaleDateString('en-ZA')} to keep your seat(s). Pay in My DROP → Group travel.`);
      }
    }
  }
}

async function balances(nowMs) {
  for (const b of db.filter('groupBookings', (x) => x.status === 'deposit_paid' && x.balanceDueAt && Date.parse(x.balanceDueAt) + BALANCE_GRACE_MS() < nowMs)) {
    try { await cancelBooking(b, { by: 'system', reason: 'Balance not paid by the due date' }); } catch { /* changed meanwhile */ }
  }
}

async function deadlines(nowMs) {
  for (const g of db.filter('travelGroups', (x) => PRE_CONFIRM.includes(x.status) && !x.closedAt && Date.parse(x.deadline) < nowMs)) {
    for (const b of db.filter('groupBookings', (x) => x.groupId === g.id && x.status === 'held')) {
      db.update('groupBookings', b.id, { status: 'expired', history: [...b.history, { status: 'expired', at: now(), note: 'Group deadline passed before payment' }] });
      await releaseSeats(g.id, b.seats);
    }
    const fresh = db.byId('travelGroups', g.id);
    db.update('travelGroups', g.id, { closedAt: now(), history: [...fresh.history, { status: fresh.status, at: now(), note: 'Fill deadline reached; closed to new travellers' }] });
    if (fresh.paidSeats < fresh.minimum) await failGroup(fresh, { reason: `Only ${fresh.paidSeats} of the ${fresh.minimum} travellers needed joined by the deadline`, nowMs });
    else for (const b of members(g.id)) tell(b.userId, `Your group ${g.ref} is going ahead`, `${tripLabel(g)}: ${fresh.paidSeats} travellers. We are confirming the booking with the partner and will send your tickets.`);
  }
}

async function transfers(nowMs) {
  for (const b of db.filter('groupBookings', (x) => x.status === 'transfer_offered' && Date.parse(x.transferOfferExpiresAt) < nowMs)) {
    db.update('groupBookings', b.id, { status: 'refunded', history: [...b.history, { status: 'refunded', at: now(), note: 'Transfer offer expired' }] });
    const held = (b.paidCents || 0) - (b.refundedCents || 0);
    await refundBooking(b, held, 'transfer offer expired');
    tell(b.userId, `Refund for ${b.ref}`, `You didn’t choose another group in time, so we are refunding R${(held / 100).toFixed(2)} in full.`);
  }
}

async function retries(nowMs) {
  for (const b of db.filter('groupBookings', (x) => (x.refundPendingCents || 0) > 0 && (!x.refundRetryAt || nowMs - Date.parse(x.refundRetryAt) > 30 * 60_000))) {
    const tries = (b.refundTries || 0) + 1;
    db.update('groupBookings', b.id, { refundRetryAt: now(), refundTries: tries });
    await refundBooking(b, b.refundPendingCents, b.refundPendingReason || 'retry');
    if (tries === 4 && (db.byId('groupBookings', b.id).refundPendingCents || 0) > 0) securityEvent('travel_refund_failing', { booking: b.ref, amount: String(b.refundPendingCents / 100) }, 'high');
  }
}

function complete(nowMs) {
  for (const g of db.filter('travelGroups', (x) => x.status === 'TICKETED' && Date.parse(`${x.returnDate || x.departureDate}T23:59:59+02:00`) + DAY < nowMs)) {
    db.update('travelGroups', g.id, { status: 'COMPLETED', completedAt: now(), history: [...g.history, { status: 'COMPLETED', at: now() }] });
    for (const b of db.filter('groupBookings', (x) => x.groupId === g.id && x.status === 'ticketed')) db.update('groupBookings', b.id, { status: 'completed' });
  }
}

export async function runTravelJobs(nowMs = Date.now()) {
  await holds(nowMs);
  reminders(nowMs);
  await balances(nowMs);
  await deadlines(nowMs);
  await transfers(nowMs);
  await retries(nowMs);
  complete(nowMs);
}
