/**
 * Monthly plans (scholar transport and staff transport): types and helpers shared by both apps.
 * Mirrors backend/src/plans.js and frontend/src/dashboard/Plans.tsx. Dates are South African time.
 */
export type PlanKind = 'scholar' | 'staff';
export interface PlanLeg { key: string; label: string; time: string; from?: string; to?: string }
export interface PlanPricing { dates: string[]; perLeg: { key: string; onDemandFare: number; fare: number; driverEarnings: number }[]; perDay: number; trips: number; total: number; onDemandTotal: number; saving: number; discountRate: number }
export interface PlanRider { name: string; grade?: string; phone?: string; notes?: string }
export interface Plan {
  id: string; ref: string; kind: PlanKind; kindLabel: string; status: string; category: string; startDate: string; endDate: string;
  days: number[]; legs: PlanLeg[]; pickup?: string; destination: string; school: string; riderCount: number; riders?: PlanRider[];
  pricing: PlanPricing; payment: string; paymentStatus: string; skipDates: string[]; autoRenew: boolean; refundedAmount: number;
  cancelEffective: string | null; driver: { name: string; vehicle: string; rating: number | null } | null; owner?: { name: string };
  guardian?: { relationship?: string; emergencyName?: string; emergencyPhone?: string; handover?: string } | null;
  distanceKm?: number | null; clash?: boolean; earnings?: number;
}
export interface PlanTrip { id: string; ref: string; date: string; leg: string; status: string; scheduledFor: string; fare: number }

export const PLAN_STATUS: Record<string, string> = { awaiting_payment: 'Awaiting payment', awaiting_driver: 'Finding a driver', active: 'Active', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired' };
export const GRADES = ['Grade R', ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
export const HANDOVER = ['Hand over to a staff member at school', 'Learner may walk from the drop-off point alone', 'Hand over to the parent or guardian only'];
export const RELATIONSHIP = ['Parent', 'Legal guardian', 'Grandparent or family member with parental responsibility', 'Foster parent'];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SKIP_NOTICE_HOURS = 12;

const SAST = 2 * 3_600_000;
export const sastToday = (now = Date.now()) => new Date(now + SAST).toISOString().slice(0, 10);
export const firstOfNextMonth = (now = Date.now()) => { const n = new Date(now + SAST); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };
export const tomorrowSast = (now = Date.now()) => sastToday(now + 86_400_000);
export const planDate = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
export const daysLabel = (d: number[]) => (d.join() === '1,2,3,4,5' ? 'Weekdays' : d.map((x) => DAY_NAMES[x - 1]).join(', '));
export const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Days the owner can still skip: service days whose first pickup is at least 12 hours away and not already skipped. */
export function skippableDates(p: Pick<Plan, 'pricing' | 'skipDates' | 'legs'>, now = Date.now()) {
  const first = p.legs[0]?.time || '00:00';
  return p.pricing.dates.filter((d) => !p.skipDates.includes(d) && Date.parse(`${d}T${first}:00+02:00`) - now >= SKIP_NOTICE_HOURS * 3_600_000);
}
export const planIsLive = (p: Pick<Plan, 'status'>) => ['awaiting_payment', 'awaiting_driver', 'active'].includes(p.status);
