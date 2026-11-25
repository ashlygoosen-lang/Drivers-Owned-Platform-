import { db, now } from './db.js';
import { withLock } from './lock.js';
import { notify, audit } from './kyc.js';
import { sendMail, emailLayout } from './mailer.js';
import { securityEvent } from './monitor.js';
import * as paystack from './money/paystack.js';
import { cents, balance } from './money/ledger.js';
import { recordTravelPayment, recordTravelRefund, recordCancellationFee, recordTransfer, recordPartnerConfirmation, escrowAccount } from './money/travel.js';
import { JOINABLE, PRE_CONFIRM, TRANSPORT_TYPES, cancellationFeePct, releaseSeats } from './travel.js';

const round2 = (n) => Math.round(n * 100) / 100;
const rands = (c) => round2(c / 100);
export const ACTIVE_BOOKING = ['held', 'deposit_paid', 'paid', 'ticketed', 'transfer_offered'];
export const PAID_BOOKING = ['deposit_paid', 'paid', 'ticketed', 'transfer_offered'];

/** In-app, push and (when email is set up) email. SMS/WhatsApp can be added here later (Twilio). */
export function tell(userId, title, body, { email = true } = {}) {
  notify(userId, title, body, 'travel');
  const u = db.byId('users', userId);
  if (email && u?.email && !u.deletedAt) void Promise.resolve(sendMail({ to: u.email, subject: title, text: body, html: emailLayout(title, [body], { label: 'Open My DROP', url: `${process.env.PUBLIC_URL || ''}/` }) })).catch(() => undefined);
}

const tripLabel = (g) => `${g.originName || g.origin} → ${g.destinationName || g.destination}, ${g.departureDate}${g.returnDate ? ` – ${g.returnDate}` : ''}`;

/** Announce 50%, 75% and 100% once each, based on paid seats. Also moves OPEN → MINIMUM_REACHED. */
export async function afterSeatsPaid(groupId) {
  let g = db.byId('travelGroups', groupId);
  if (g.status === 'OPEN' && g.paidSeats >= g.minimum) {
    g = (await db.updateStrict('travelGroups', g.id, { status: 'MINIMUM_REACHED', minimumAt: now(), history: [...g.history, { status: 'MINIMUM_REACHED', at: now() }] }, { when: { status: ['OPEN'] } })) || db.byId('travelGroups', groupId);
    for (const b of members(g.id)) tell(b.userId, `Your group has enough travellers`, `${tripLabel(g)}: the minimum of ${g.minimum} travellers is reached, so the trip will go ahead. Seats remain open until the group is full or the deadline.`);
  }
  const pct = Math.floor((g.paidSeats / g.capacity) * 100);
  const due = [50, 75, 100].filter((m) => pct >= m && !(g.milestones || []).includes(m));
  if (!due.length) return g;
  g = db.update('travelGroups', g.id, { milestones: [...(g.milestones || []), ...due] });
  const top = due.at(-1);
  for (const b of members(g.id)) tell(b.userId, top === 100 ? 'Your travel group is full' : `Your travel group is ${top}% full`, `${tripLabel(g)}: ${g.paidSeats} of ${g.capacity} seats taken.${top === 100 ? ' We will now confirm the group with the partner and send your tickets.' : ''}`);
  return g;
}
export const members = (groupId) => db.filter('groupBookings', (b) => b.groupId === groupId && PAID_BOOKING.includes(b.status));

/** A Paystack payment for a group booking succeeded (verify or webhook). Idempotent per reference. */
export async function markTravelPaid(bookingIn, tx) {
  return withLock(`pay:${bookingIn.id}`, async () => {
    const b = db.byId('groupBookings', bookingIn.id);
    if ((b.payments || []).some((p) => p.reference === tx.reference)) return b;
    if (tx.status !== 'success') throw Object.assign(new Error('This payment was not successful.'), { status: 400 });
    const amount = Number(tx.amount);
    if (b.pendingPaymentReference !== tx.reference || amount !== b.pendingAmountCents || String(tx.currency).toUpperCase() !== 'ZAR') throw Object.assign(new Error('The payment does not match this booking. Please contact support.'), { status: 400 });
    let g = db.byId('travelGroups', b.groupId);
    recordTravelPayment(b, { reference: tx.reference, amountCents: amount });
    const payments = [...(b.payments || []), { reference: tx.reference, amountCents: amount, kind: b.pendingKind, paidAt: tx.paid_at || now(), last4: tx.authorization?.last4 || '' }];
    const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
    const first = !PAID_BOOKING.includes(b.status);
    // The hold lapsed while the customer was paying: take the seats again if still free, otherwise refund.
    if (first && b.status === 'expired') {
      const again = await db.adjustStrict('travelGroups', g.id, 'seatsTaken', b.seats, { maxField: 'capacity', statuses: [...JOINABLE, 'FULL'] });
      if (!again) {
        const late = db.update('groupBookings', b.id, { payments, paidCents, pendingPaymentReference: null });
        await refundBooking(late, paidCents, 'seats no longer available');
        tell(b.userId, 'Your group filled up while you were paying', `Sorry: the last seats on ${tripLabel(g)} were taken before your payment completed. We have refunded R${rands(paidCents).toFixed(2)} in full.`);
        return db.byId('groupBookings', b.id);
      }
      g = again;
    }
    const status = paidCents >= cents(b.total) ? 'paid' : 'deposit_paid';
    const updated = db.update('groupBookings', b.id, { payments, paidCents, status, pendingPaymentReference: null, pendingAmountCents: null, holdExpiresAt: null, history: [...b.history, { status, at: now(), note: `Paid R${rands(amount).toFixed(2)} (${b.pendingKind})` }] });
    if (first) await db.adjustStrict('travelGroups', g.id, 'paidSeats', b.seats, {});
    tell(b.userId, first ? `You’ve joined the group: ${g.ref}` : `Balance received for ${b.ref}`, first
      ? `${tripLabel(g)} · ${b.seats} traveller(s). ${status === 'deposit_paid' ? `Deposit received; the balance of R${rands(cents(b.total) - paidCents).toFixed(2)} is due by ${new Date(b.balanceDueAt).toLocaleDateString('en-ZA')}.` : 'Paid in full.'} We’ll keep you posted as the group fills.`
      : `Paid in full. Thank you. We’ll send your tickets once the group is confirmed with the partner.`);
    if (first) await afterSeatsPaid(g.id);
    return updated;
  });
}

/**
 * Refund up to `amountCents` across the booking's payments (newest first, partial refunds through
 * Paystack). What can't be refunded right now is remembered as refundPendingCents and retried by the job.
 */
export async function refundBooking(bookingIn, amountCents, reason) {
  const b = db.byId('groupBookings', bookingIn.id);
  let left = Math.min(amountCents, (b.paidCents || 0) - (b.refundedCents || 0));
  const refunds = [...(b.refunds || [])];
  for (const p of [...(b.payments || [])].reverse()) {
    if (left <= 0) break;
    const already = refunds.filter((r) => r.reference === p.reference).reduce((s, r) => s + r.amountCents, 0);
    const take = Math.min(left, p.amountCents - already);
    if (take <= 0) continue;
    try {
      await paystack.refund(p.reference, take);
      const key = `${b.id}:${p.reference}:${refunds.length}`;
      recordTravelRefund(b, { reference: p.reference, amountCents: take, key });
      refunds.push({ reference: p.reference, amountCents: take, at: now(), reason });
      left -= take;
    } catch (err) {
      securityEvent('travel_refund_failed', { booking: b.ref, error: err.message.slice(0, 120) }, 'medium');
      break;
    }
  }
  const refundedCents = refunds.reduce((s, r) => s + r.amountCents, 0);
  return db.update('groupBookings', b.id, { refunds, refundedCents, refundPendingCents: left > 0 ? left : 0, refundPendingReason: left > 0 ? reason : null });
}

/** Customer (or staff on their behalf) cancels: keep the policy fee, refund the rest, give the seats back. */
export async function cancelBooking(bookingIn, { by, reason = 'Cancelled by customer', waiveFee = false } = {}) {
  return withLock(`travel-booking:${bookingIn.id}`, async () => {
    const b = db.byId('groupBookings', bookingIn.id);
    if (!ACTIVE_BOOKING.includes(b.status)) throw Object.assign(new Error('This booking is already closed.'), { status: 400 });
    const g = db.byId('travelGroups', b.groupId);
    const paid = (b.paidCents || 0) - (b.refundedCents || 0);
    const feePct = waiveFee || b.status === 'held' ? 0 : cancellationFeePct(g);
    const feeCents = Math.min(paid, Math.round(cents(b.total) * feePct / 100));
    const wasPaid = PAID_BOOKING.includes(b.status);
    db.update('groupBookings', b.id, { status: 'cancelled', cancelledAt: now(), cancelReason: reason, cancelledBy: by || 'customer', feeCents, history: [...b.history, { status: 'cancelled', at: now(), note: `${reason}${feeCents ? ` · fee R${rands(feeCents).toFixed(2)} (${feePct}%)` : ''}` }] });
    if (feeCents > 0) recordCancellationFee(b, feeCents);
    if (paid - feeCents > 0) await refundBooking(b, paid - feeCents, reason);
    if (PRE_CONFIRM.includes(g.status)) await releaseSeats(g.id, b.seats, { paid: wasPaid });
    tell(b.userId, `Booking ${b.ref} cancelled`, `${tripLabel(g)}. ${paid - feeCents > 0 ? `R${rands(paid - feeCents).toFixed(2)} is being refunded to your card (allow 5–10 business days).` : ''}${feeCents ? ` A cancellation fee of R${rands(feeCents).toFixed(2)} applies under the cancellation policy.` : ''}`);
    return db.byId('groupBookings', b.id);
  });
}

/** Move a booking to another joinable group (transfer offer after a group failed). Price difference refunded. */
export async function transferBooking(bookingIn, toGroupId) {
  return withLock(`travel-booking:${bookingIn.id}`, async () => {
    const b = db.byId('groupBookings', bookingIn.id);
    if (b.status !== 'transfer_offered') throw Object.assign(new Error('This booking has no transfer offer.'), { status: 400 });
    const from = db.byId('travelGroups', b.groupId);
    const to = db.byId('travelGroups', toGroupId);
    if (!to || !JOINABLE.includes(to.status) || to.origin !== from.origin || to.destination !== from.destination || to.type !== from.type) throw Object.assign(new Error('Choose an open group on the same route.'), { status: 400 });
    if (Date.now() > Date.parse(to.deadline)) throw Object.assign(new Error('That group has passed its deadline.'), { status: 400 });
    if (to.pricePerPerson > from.pricePerPerson) throw Object.assign(new Error('That group costs more. Please choose a group at the same price or lower.'), { status: 400 });
    const reserved = await db.adjustStrict('travelGroups', to.id, 'seatsTaken', b.seats, { maxField: 'capacity', statuses: JOINABLE });
    if (!reserved) throw Object.assign(new Error('That group no longer has enough seats.'), { status: 409 });
    await db.adjustStrict('travelGroups', to.id, 'paidSeats', b.seats, {});
    const held = (b.paidCents || 0) - (b.refundedCents || 0);
    const newTotal = round2(to.pricePerPerson * b.seats);
    const keep = Math.min(held, cents(newTotal));
    recordTransfer(b, from.id, to.id, keep);
    db.update('groupBookings', b.id, { groupId: to.id, total: newTotal, status: held >= cents(newTotal) ? 'paid' : 'deposit_paid', balanceDueAt: held >= cents(newTotal) ? null : to.deadline, transferredFrom: from.id, history: [...b.history, { status: 'transferred', at: now(), note: `Moved from ${from.ref} to ${to.ref}` }] });
    for (const p of db.filter('groupPassengers', (x) => x.bookingId === b.id)) db.update('groupPassengers', p.id, { groupId: to.id });
    if (held > keep) { const nb = db.byId('groupBookings', b.id); await refundBooking({ ...nb, groupId: to.id }, held - keep, 'price difference after transfer'); }
    tell(b.userId, `Moved to group ${to.ref}`, `${tripLabel(to)}. Your payment moved with you.${held > keep ? ` The price difference of R${rands(held - keep).toFixed(2)} is being refunded.` : ''}`);
    await afterSeatsPaid(to.id);
    return db.byId('groupBookings', b.id);
  });
}

/** Admin confirms the group with the partner: escrow → amount owed to the partner + DROP's margin. */
export async function confirmGroup(groupIn, { partnerReference, actor }) {
  return withLock(`travel-group:${groupIn.id}`, async () => {
    const g = db.byId('travelGroups', groupIn.id);
    if (!['MINIMUM_REACHED', 'FULL'].includes(g.status)) throw Object.assign(new Error('Only a group that has reached its minimum can be confirmed.'), { status: 400 });
    const open = db.filter('groupBookings', (b) => b.groupId === g.id && ['held', 'deposit_paid'].includes(b.status));
    if (open.length) throw Object.assign(new Error(`${open.length} booking(s) still have a hold or unpaid balance. Wait for the balance deadline or cancel them first.`), { status: 400 });
    const seats = members(g.id).reduce((s, b) => s + b.seats, 0);
    const raw = await db.ledgerRaw(escrowAccount(g.id)); // strongly consistent when PostgreSQL is on
    const collectedCents = raw == null ? balance(escrowAccount(g.id)) : -raw;
    const partnerCents = cents(g.bulkRate) * seats;
    if (collectedCents < partnerCents) throw Object.assign(new Error('Collected money is below the partner bulk rate for these seats. Check the group pricing.'), { status: 400 });
    recordPartnerConfirmation(g, { collectedCents, partnerCents });
    const updated = await db.updateStrict('travelGroups', g.id, { status: 'CONFIRMED_WITH_PARTNER', partnerReference, confirmedAt: now(), confirmedSeats: seats, collectedCents, partnerCents, marginCents: collectedCents - partnerCents,
      history: [...g.history, { status: 'CONFIRMED_WITH_PARTNER', at: now(), note: `Confirmed by ${actor.name}, partner ref ${partnerReference}` }] }, { when: { status: ['MINIMUM_REACHED', 'FULL'] } });
    audit(actor, 'travel.group_confirmed', g.id, { group: g.ref, partnerReference, seats: String(seats) });
    for (const b of members(g.id)) tell(b.userId, `Confirmed: ${TRANSPORT_TYPES[g.type]?.label || 'Trip'} ${g.ref}`, `${tripLabel(g)} is confirmed with the partner (booking reference ${partnerReference}). Your tickets follow shortly.`);
    return updated;
  });
}

export { tripLabel };
