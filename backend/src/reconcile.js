import { db, now } from './db.js';
import { transition } from './bookingState.js';
import { notify } from './kyc.js';
import { settleTrip } from './money/settlement.js';
import { securityEvent } from './monitor.js';

/**
 * Reconciliation (runs every minute on the leader instance). Finds and fixes trips that got stuck,
 * and raises alerts for anything money-related it can't fix by itself.
 */
const MIN = 60_000;
const PAYMENT_TIMEOUT = () => Number(process.env.PAYMENT_TIMEOUT_MINUTES || 20) * MIN;
const MATCH_TIMEOUT = () => Number(process.env.MATCH_TIMEOUT_MINUTES || 30) * MIN;
const age = (iso) => Date.now() - Date.parse(iso);

export async function reconcile() {
  const fixed = { paymentTimeouts: 0, unmatched: 0, refundsRetried: 0, settled: 0 };
  const { refundBooking } = await import('./routes/money.js');
  for (const b of db.filter('bookings', (x) => x.status === 'awaiting_payment' && age(x.createdAt) > PAYMENT_TIMEOUT())) {
    try { await transition(b, 'cancelled', { cancelReason: 'Card payment not completed in time' }, { from: 'awaiting_payment', when: { paymentStatus: ['pending', null] } }); fixed.paymentTimeouts++; } catch { /* moved on */ }
  }
  for (const b of db.filter('bookings', (x) => x.status === 'requested' && (x.scheduledFor ? age(x.scheduledFor) > MATCH_TIMEOUT() : age(x.createdAt) > MATCH_TIMEOUT()))) {
    try {
      let c = await transition(b, 'cancelled', { cancelReason: 'No driver available' }, { from: 'requested' });
      if (c.paymentStatus === 'paid') c = await refundBooking(c);
      notify(b.userId, 'No driver available', `We couldn’t find a driver for ${b.ref}. ${c.paymentStatus === 'refunded' || c.paymentStatus === 'refund_pending' ? 'Your card payment is being refunded. ' : ''}Please try booking again.`, 'trips');
      fixed.unmatched++;
    } catch { /* moved on */ }
  }
  for (const b of db.filter('bookings', (x) => x.status === 'cancelled' && (x.paymentStatus === 'paid' || (x.paymentStatus === 'refund_pending' && age(x.updatedAt || x.createdAt) > 30 * MIN)))) {
    await refundBooking(b); fixed.refundsRetried++;
  }
  for (const b of db.filter('bookings', (x) => x.status === 'completed' && !x.settledAt && age(x.completedAt || x.createdAt) > 2 * MIN)) {
    try { settleTrip(b); fixed.settled++; securityEvent('trip_settled_by_reconciliation', { booking: b.ref }, 'medium'); } catch (err) { securityEvent('settlement_failed', { booking: b.ref, error: err.message.slice(0, 120) }, 'high'); }
  }
  const stuck = db.filter('bookings', (x) => ['accepted', 'arriving', 'in_progress'].includes(x.status) && age((x.history || []).at(-1)?.at || x.createdAt) > 4 * 60 * MIN);
  if (stuck.length) securityEvent('trips_stuck', { count: String(stuck.length), refs: stuck.slice(0, 5).map((s) => s.ref).join(',') }, 'medium');
  const refundsFailing = db.filter('bookings', (x) => x.paymentStatus === 'refund_pending' && age(x.updatedAt || x.createdAt) > 24 * 60 * MIN);
  if (refundsFailing.length) securityEvent('refunds_failing', { count: String(refundsFailing.length) }, 'high');
  if (Object.values(fixed).some(Boolean)) securityEvent('reconciliation', Object.fromEntries(Object.entries(fixed).map(([k, v]) => [k, String(v)])));
  return { ...fixed, stuck: stuck.length, at: now() };
}

/**
 * Ledger self-check (hourly on the leader): in-memory balances vs PostgreSQL's sum of every entry.
 * Writes in flight can make one check differ for a moment, so a difference must show up in three
 * checks in a row before it is reported; the last check then re-derives the totals from PostgreSQL.
 */
export async function checkLedger({ attempts = 3, gapMs = 5000 } = {}) {
  const { verifyAgainstDatabase } = await import('./money/ledger.js');
  const { catchUp } = await import('./db.js');
  let diff = [];
  for (let i = 0; i < attempts; i++) {
    await catchUp();
    diff = await verifyAgainstDatabase({ repair: i === attempts - 1 });
    if (!diff.length) return [];
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  securityEvent('ledger_mismatch', { accounts: diff.slice(0, 5).map((d) => `${d.account}:${d.memory}/${d.database}`).join(','), count: String(diff.length) }, 'high');
  return diff;
}
