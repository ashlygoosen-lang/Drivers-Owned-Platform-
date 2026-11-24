/**
 * Trip money movements.
 *
 *   Card payment received (Paystack → pool):   pool  DR fare      escrow DR→CR fare
 *   Trip completed, card:                       escrow DR fare     wallet CR earnings, fees CR fee
 *   Trip completed, business account:          receivable DR fare wallet CR earnings, fees CR fee
 *   Trip completed, cash (driver holds cash):  wallet DR fee      fees CR fee
 *   Paid trip cancelled → refund:              escrow DR fare     pool CR fare
 */
import { db, now } from '../db.js';
import { post, cents, walletAccount } from './ledger.js';

export function recordCardPayment(booking, { reference, amountCents, provider }) {
  post({
    type: 'payment.received', key: `payment:${reference}`,
    memo: `${provider} payment for ${booking.ref}`,
    lines: [{ account: 'pool', dr: amountCents }, { account: 'escrow', cr: amountCents }],
    meta: { bookingId: booking.id, bookingRef: booking.ref, reference, provider },
  });
}

/** Called once when a trip is completed. Idempotent per booking. */
export function settleTrip(booking) {
  if (!booking.driverId) return null;
  const fare = cents(booking.fare);
  const fee = cents(booking.driverServiceFee);
  const earnings = fare - fee;
  const wallet = walletAccount(booking.driverId);
  const meta = { bookingId: booking.id, bookingRef: booking.ref, driverId: booking.driverId, payment: booking.payment };
  let entry;
  if (booking.payment === 'Card' && booking.paymentStatus === 'paid') {
    entry = post({ type: 'trip.settled', key: `settle:${booking.id}`, memo: `Trip ${booking.ref} completed · card`, meta,
      lines: [{ account: 'escrow', dr: fare }, { account: wallet, cr: earnings }, { account: 'fees', cr: fee }] });
  } else if (booking.payment === 'Business account') {
    entry = post({ type: 'trip.settled', key: `settle:${booking.id}`, memo: `Trip ${booking.ref} completed · business account`, meta,
      lines: [{ account: 'receivable:business', dr: fare }, { account: wallet, cr: earnings }, { account: 'fees', cr: fee }] });
  } else {
    // Cash: the driver already holds the full fare, so only the DROP service fee moves.
    entry = post({ type: 'trip.cash_fee', key: `settle:${booking.id}`, memo: `Trip ${booking.ref} completed · cash (service fee)`, meta,
      lines: [{ account: wallet, dr: fee }, { account: 'fees', cr: fee }] });
  }
  db.update('bookings', booking.id, { settledAt: now(), settlementEntryId: entry.id });
  return entry;
}

export function recordRefund(booking, { reference, amountCents }) {
  post({
    type: 'payment.refunded', key: `refund:${reference}`,
    memo: `Refund for cancelled trip ${booking.ref}`,
    lines: [{ account: 'escrow', dr: amountCents }, { account: 'pool', cr: amountCents }],
    meta: { bookingId: booking.id, bookingRef: booking.ref, reference },
  });
}
