import { db, now } from './db.js';
import { HttpError } from './validate.js';
import { onTripStatus } from './routes/comms.js';
import { onTrackingStatus } from './routes/tracking.js';

/**
 * Booking state machine. Only these moves are allowed, and each move is a conditional update
 * decided by the database (the trip must still be in the expected state), so two people or two
 * servers can never both move the same trip.
 *
 *   awaiting_payment → requested (paid) | cancelled (passenger, or payment timeout)
 *   requested        → accepted (driver) | cancelled (passenger, or no driver found)
 *   accepted         → arriving | requested (driver releases) | cancelled
 *   arriving         → in_progress | requested (driver releases) | cancelled
 *   in_progress      → completed
 */
export const TRANSITIONS = {
  awaiting_payment: ['requested', 'cancelled'],
  requested: ['accepted', 'cancelled'],
  accepted: ['arriving', 'requested', 'cancelled'],
  arriving: ['in_progress', 'requested', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};
export const OPEN = ['awaiting_payment', 'requested', 'accepted', 'arriving', 'in_progress'];
export const ACTIVE = ['accepted', 'arriving', 'in_progress'];

export async function transition(booking, to, extra = {}, { from, when = {}, note } = {}) {
  const allowed = [].concat(from || Object.keys(TRANSITIONS).filter((s) => TRANSITIONS[s].includes(to)));
  if (!allowed.every((s) => TRANSITIONS[s]?.includes(to))) throw new Error(`Invalid transition list to ${to}`);
  if (!allowed.includes(booking.status)) throw new HttpError(409, 'This trip has already moved on. Please refresh.');
  const updated = await db.updateStrict('bookings', booking.id,
    { ...extra, status: to, history: [...(booking.history || []), { status: to, at: now(), ...(note && { note }) }] },
    { when: { status: allowed, ...when }, message: to === 'accepted' ? 'Finish your current trip before accepting another.' : 'This trip was just updated. Please refresh.' });
  if (!updated) throw new HttpError(409, to === 'accepted' ? 'This request is no longer available.' : 'This trip was just updated by someone else. Please refresh.');
  onTrackingStatus(updated);
  onTripStatus(updated);
  return updated;
}
