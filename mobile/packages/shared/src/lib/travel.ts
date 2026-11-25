/**
 * Group travel (flights and coaches): types and helpers for the apps.
 * Mirrors backend/src/travel.js and frontend/src/travel/GroupTravel.tsx. Dates are South African time.
 */
export interface TravelGroup {
  id: string; ref: string; type: 'flight' | 'bus'; typeLabel: string; origin: string; destination: string; originName: string; destinationName: string;
  international: boolean; departureDate: string; returnDate: string | null; capacity: number; minimum: number; seatsTaken: number; paidSeats: number; seatsLeft: number;
  pricePerPerson: number; pricePerPersonUsd: number | null; depositPct: number; deadline: string; daysLeft: number; status: string; joinable: boolean;
  partner?: { id: string; name: string } | null; partnerReference?: string | null;
}
export interface TravelNewGroup { capacity: number; minimum: number; pricePerPerson: number; pricePerPersonUsd: number | null; depositPct: number; deadline: string; daysLeft: number }
export interface TravelResult {
  route: { id: string; type: 'flight' | 'bus'; typeLabel: string; origin: string; destination: string; originName: string; destinationName: string; international: boolean; partner: string };
  group: TravelGroup | null; newGroup: TravelNewGroup | null; tooLate: boolean; alternatives: TravelGroup[]; fits: boolean;
}
export interface TravelPassenger { id?: string; fullName: string; dateOfBirth: string; nationality: string; passportNumber?: string; passportExpiry?: string; passport?: string | null; minor?: boolean; ticketNumber?: string; seat?: string }
export interface GroupBooking {
  id: string; ref: string; status: string; seats: number; total: number; pricePerPerson: number; option: 'full' | 'deposit'; paid: number; refunded: number; balance: number;
  balanceDueAt: string | null; depositDue: number; holdExpiresAt: string; cancelReason: string | null; feeCharged: number; transferOfferExpiresAt: string | null;
  refundPending: number; createdAt: string; totalUsd: number | null; group: TravelGroup | null; passengers: TravelPassenger[]; history: { status: string; at: string; note?: string }[];
}
/** What the customer chose in search, carried to the join screen. */
export interface TravelSelection { routeId: string; departureDate: string; returnDate: string; travellers: number; summary: string; international: boolean; price: number; depositPct: number }

export const GROUP_BOOKING_STATUS: Record<string, string> = {
  held: 'Awaiting payment', deposit_paid: 'Deposit paid', paid: 'Paid in full', ticketed: 'Ticketed', completed: 'Completed', cancelled: 'Cancelled',
  expired: 'Hold expired', refunded: 'Refunded', transfer_offered: 'Choose another date',
};
export const groupBookingTone = (s: string): 'good' | 'warn' | 'bad' | 'neutral' =>
  (['paid', 'ticketed'].includes(s) ? 'good' : ['cancelled', 'expired', 'refunded'].includes(s) ? 'bad' : s === 'completed' ? 'neutral' : 'warn');
export const isUpcomingBooking = (s: string) => !['cancelled', 'expired', 'refunded', 'completed'].includes(s);

export const travelDate = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const isIsoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Age in whole years on a date (both YYYY-MM-DD). */
export function ageOn(dob: string, on: string) {
  const b = new Date(`${dob}T00:00:00Z`), d = new Date(`${on}T00:00:00Z`);
  let a = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/** Fill line under the progress bar: "31 of 40 seats · 2 more needed to confirm". */
export function fillLabel(paid: number, capacity: number, minimum: number) {
  return `${paid} of ${capacity} seats · ${paid >= minimum ? 'minimum reached, trip goes ahead' : `${minimum - paid} more needed to confirm`}`;
}

/** Amount due now and later, in rand (deposit rounded to cents, as the server does). */
export function travelAmounts(price: number, seats: number, depositPct: number, option: 'full' | 'deposit') {
  const total = Math.round(price * seats * 100) / 100;
  const deposit = Math.round(total * depositPct) / 100;
  const dueNow = option === 'deposit' && depositPct > 0 && depositPct < 100 ? deposit : total;
  return { total, dueNow, later: Math.round((total - dueNow) * 100) / 100 };
}

/** The same checks the server makes, so mistakes show before submitting. Returns an error message or ''. */
export function passengerProblem(p: TravelPassenger, i: number, { international, departureDate, travelUntil, today }: { international: boolean; departureDate: string; travelUntil: string; today: string }) {
  const n = `Traveller ${i + 1}`;
  if (p.fullName.trim().length < 3) return `${n}: enter the full name as on the passport or ID.`;
  if (!isIsoDate(p.dateOfBirth) || p.dateOfBirth > today) return `${n}: enter the date of birth as YYYY-MM-DD.`;
  const age = ageOn(p.dateOfBirth, departureDate);
  if (age < 0 || age > 120) return `${n}: please check the date of birth.`;
  if (p.nationality.trim().length < 2) return `${n}: enter the nationality.`;
  const passport = (p.passportNumber || '').replace(/\s/g, '').toUpperCase();
  if (international || passport) {
    if (!/^[A-Z0-9]{6,12}$/.test(passport)) return `${n}: enter the passport number (6–12 letters and digits).`;
    if (!isIsoDate(p.passportExpiry || '')) return `${n}: enter the passport expiry date as YYYY-MM-DD.`;
    if ((p.passportExpiry as string) <= travelUntil) return `${n}: the passport must be valid after your travel dates.`;
  }
  return '';
}
