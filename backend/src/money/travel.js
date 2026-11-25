import { post } from './ledger.js';

/**
 * Group travel money in the double-entry ledger (cents, ZAR). Each group has its own escrow account,
 * travel_escrow:<groupId>, so what is held for a group is always exact:
 *   customer pays          pool DR            travel_escrow:<g> CR
 *   refund                 travel_escrow DR   pool CR
 *   cancellation fee kept  travel_escrow DR   travel_fees CR
 *   transfer to group h    travel_escrow:<g> DR   travel_escrow:<h> CR
 *   partner confirmed      travel_escrow DR   partner_payable:<p> CR (bulk rate × seats) + travel_margin CR (rest)
 *   partner paid           partner_payable:<p> DR   pool CR   (a deposit paid before confirmation is the same entry)
 */
export const escrowAccount = (groupId) => `travel_escrow:${groupId}`;
export const payableAccount = (partnerId) => `partner_payable:${partnerId}`;

export function recordTravelPayment(booking, { reference, amountCents }) {
  return post({ type: 'travel.payment_received', key: `travel-pay:${reference}`, memo: `Paystack payment for group booking ${booking.ref}`,
    lines: [{ account: 'pool', dr: amountCents }, { account: escrowAccount(booking.groupId), cr: amountCents }],
    meta: { bookingId: booking.id, bookingRef: booking.ref, groupId: booking.groupId, reference } });
}
export function recordTravelRefund(booking, { reference, amountCents, key }) {
  return post({ type: 'travel.refunded', key: `travel-refund:${key}`, memo: `Refund for group booking ${booking.ref}`,
    lines: [{ account: escrowAccount(booking.groupId), dr: amountCents }, { account: 'pool', cr: amountCents }],
    meta: { bookingId: booking.id, bookingRef: booking.ref, groupId: booking.groupId, reference } });
}
export function recordCancellationFee(booking, amountCents) {
  return post({ type: 'travel.cancellation_fee', key: `travel-fee:${booking.id}`, memo: `Cancellation fee, group booking ${booking.ref}`,
    lines: [{ account: escrowAccount(booking.groupId), dr: amountCents }, { account: 'travel_fees', cr: amountCents }],
    meta: { bookingId: booking.id, bookingRef: booking.ref, groupId: booking.groupId } });
}
export function recordTransfer(booking, fromGroupId, toGroupId, amountCents) {
  return post({ type: 'travel.transferred', key: `travel-transfer:${booking.id}:${toGroupId}`, memo: `Group booking ${booking.ref} moved to another group`,
    lines: [{ account: escrowAccount(fromGroupId), dr: amountCents }, { account: escrowAccount(toGroupId), cr: amountCents }],
    meta: { bookingId: booking.id, bookingRef: booking.ref, fromGroupId, toGroupId } });
}
export function recordPartnerConfirmation(group, { collectedCents, partnerCents }) {
  return post({ type: 'travel.partner_confirmed', key: `travel-confirm:${group.id}`, memo: `Group ${group.ref} confirmed with partner`,
    lines: [{ account: escrowAccount(group.id), dr: collectedCents }, { account: payableAccount(group.partnerId), cr: partnerCents }, { account: 'travel_margin', cr: collectedCents - partnerCents }],
    meta: { groupId: group.id, groupRef: group.ref, partnerId: group.partnerId } });
}
export function recordPartnerPayout(payout) {
  return post({ type: 'travel.partner_paid', key: `travel-payout:${payout.id}`, memo: `Payment to partner for group ${payout.groupRef || ''} (${payout.kind})`,
    lines: [{ account: payableAccount(payout.partnerId), dr: payout.amountCents }, { account: 'pool', cr: payout.amountCents }],
    meta: { payoutId: payout.id, groupId: payout.groupId, partnerId: payout.partnerId, reference: payout.reference } });
}
