import { imageFor } from './vehicles.js';
import { db, id, now } from './db.js';
import { quote } from './pricing.js';
import { getVerification, recompute, currentDocs } from './kyc.js';

/**
 * Monthly transport plans: scholar transport (a parent or guardian books school runs for their
 * children) and staff transport (a business books commutes for its employees).
 *
 * A plan covers one billing period: from its start date to the end of that calendar month.
 * It names the trips (legs) per school or work day, is priced up front, paid in advance (card) or
 * invoiced (business account), and is driven by one driver who accepts it for the month.
 * Each day's trips become ordinary bookings shortly before departure (src/planJobs.js), so live
 * tracking, chat, calls, settlement and the reconciler all work exactly as for on-demand trips.
 *
 * Times are South African Standard Time (UTC+2, no daylight saving).
 */
export const KINDS = { scholar: 'Scholar transport', staff: 'Staff transport' };
export const PLAN_DISCOUNT = () => Number(process.env.PLAN_DISCOUNT_RATE ?? 0.15); // monthly plans are 15% below on-demand fares
export const SKIP_NOTICE_HOURS = () => Number(process.env.PLAN_SKIP_NOTICE_HOURS ?? 12);
export const CANCEL_NOTICE_HOURS = () => Number(process.env.PLAN_CANCEL_NOTICE_HOURS ?? 24);
export const GENERATE_BEFORE_MIN = () => Number(process.env.PLAN_TRIP_LEAD_MINUTES ?? 45);
export const MAX_RIDERS = { Comfort: 4, XL: 6, Minibus: 14 }; // minibus: 14 passengers plus the driver
const SAST = 2 * 3_600_000;

export const sastDate = (ms = Date.now()) => new Date(ms + SAST).toISOString().slice(0, 10);
export const sastTime = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+02:00`);
export const monthOf = (date) => date.slice(0, 7);
const pad = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- South African public holidays (Public Holidays Act 36 of 1994) ---------------- */
function easterSunday(y) {
  // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const holidayCache = new Map();
export function publicHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const fixed = ['01-01', '03-21', '04-27', '05-01', '06-16', '08-09', '09-24', '12-16', '12-25', '12-26'].map((md) => `${year}-${md}`);
  const easter = easterSunday(year);
  const iso = (d) => d.toISOString().slice(0, 10);
  const set = new Set([iso(new Date(+easter - 2 * 86_400_000)), iso(new Date(+easter + 86_400_000))]); // Good Friday, Family Day
  for (const d of fixed) {
    set.add(d);
    // A public holiday on a Sunday is observed on the Monday (s 2(1)).
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) set.add(iso(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000)));
  }
  holidayCache.set(year, set);
  return set;
}
export const isPublicHoliday = (date) => publicHolidays(Number(date.slice(0, 4))).has(date);

/** Service dates from `start` to the end of its month on the chosen weekdays (1 = Monday … 5 = Friday, 6, 7), minus public holidays. */
export function serviceDates(start, days) {
  const [y, m] = start.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = Number(start.slice(8, 10)); d <= last; d++) {
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    if (days.includes(wd) && !isPublicHoliday(date)) out.push(date);
  }
  return out;
}

/** Price a plan. Every leg on every service date is one trip at the on-demand fare less the plan discount. */
export function pricePlan({ category, legs, start, startDate, days, skipDates = [] }) {
  start ||= startDate;
  const dates = serviceDates(start, days).filter((d) => !skipDates.includes(d));
  const perLeg = legs.map((l) => {
    const q = quote({ service: 'Ride', category, pickup: l.from, destination: l.to });
    const o = q.options.find((x) => x.category === category);
    const fare = round2(o.fare * (1 - PLAN_DISCOUNT()));
    const fee = round2(fare * q.serviceFeeRate);
    return { key: l.key, onDemandFare: o.fare, fare, driverServiceFee: fee, driverEarnings: round2(fare - fee), distanceKm: q.distanceKm, durationMin: q.durationMin, approximate: q.approximate };
  });
  const perDay = round2(perLeg.reduce((s, l) => s + l.fare, 0));
  const trips = dates.length * legs.length;
  const total = round2(perDay * dates.length); // = sum of every trip's fare, so the ledger balances to the cent
  const onDemand = round2(perLeg.reduce((s, l) => s + l.onDemandFare, 0) * dates.length);
  return { dates, perLeg, perDay, trips, total, onDemandTotal: onDemand, saving: round2(onDemand - total), discountRate: PLAN_DISCOUNT(), currency: 'ZAR' };
}

/* ---------------- Driver eligibility ---------------- */
export const SCHOLAR_DOCS = ['police_clearance', 'child_protection_clearance', 'learner_transport_licence', 'roadworthy'];
/**
 * Scholar transport needs more than an ordinary DROP driver: a police clearance, a clearance from the
 * National Child Protection Register and National Register for Sex Offenders (Children's Act s 126,
 * Sexual Offences Act s 45), an operating licence for learner transport and a roadworthy vehicle,
 * each approved by compliance and not expired.
 */
export function scholarEligibility(driverId) {
  const u = db.byId('users', driverId);
  if (!u || u.role !== 'driver' || u.driverStatus !== 'approved') return { eligible: false, missing: ['approved driver account'] };
  const v = getVerification(driverId);
  recompute(v);
  const ok = new Set(currentDocs(v).filter((d) => d.status === 'approved').map((d) => d.type));
  const missing = SCHOLAR_DOCS.filter((t) => !ok.has(t));
  return { eligible: missing.length === 0, missing };
}

/** Two plans clash if they share a weekday and dates, and any departures are within 75 minutes. */
export function clashes(a, b) {
  if (!a.days.some((d) => b.days.includes(d))) return false;
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return a.legs.some((x) => b.legs.some((y) => Math.abs(mins(x.time) - mins(y.time)) < 75));
}

/** The plan as its owner, its driver or staff should see it. Learner details only go to the assigned driver. */
export function planView(p, viewer) {
  const driver = p.driverId ? db.byId('users', p.driverId) : null;
  const owner = db.byId('users', p.userId);
  const isOwner = viewer.id === p.userId;
  const isDriver = viewer.id === p.driverId;
  const staff = ['admin', 'support', 'compliance', 'finance'].includes(viewer.role);
  const out = {
    id: p.id, ref: p.ref, kind: p.kind, kindLabel: KINDS[p.kind], status: p.status, category: p.category,
    startDate: p.startDate, endDate: p.endDate, month: p.month, days: p.days, legs: p.legs,
    pickup: p.pickup, destination: p.destination, school: p.school || '', company: p.company || '',
    riderCount: p.riders.length, pricing: p.pricing, payment: p.payment, paymentStatus: p.paymentStatus,
    skipDates: p.skipDates || [], autoRenew: p.autoRenew, renewedToId: p.renewedToId || null, renewedFromId: p.renewedFromId || null,
    refundedAmount: p.refundedAmount || 0, cancelEffective: p.cancelEffective || null, history: p.history, createdAt: p.createdAt,
    driver: driver ? { name: driver.name, vehicle: driver.vehicle || '', vehicleType: imageFor(driver, { category: p.category }), rating: driver.rating || null } : null,
    vehicleType: imageFor(driver, { category: p.category }),
  };
  if (isOwner || isDriver || staff) out.riders = p.riders;
  if (isOwner || staff) out.guardian = p.guardian || null;
  if (isDriver || staff) out.owner = owner ? { name: p.kind === 'staff' ? (owner.company || owner.name) : owner.name } : null;
  if (isDriver && p.guardian) out.guardian = { emergencyName: p.guardian.emergencyName, emergencyPhone: p.guardian.emergencyPhone, handover: p.guardian.handover };
  // Drivers deciding whether to take a plan see the times, the destination and how far away it is,
  // but not the home address or names until they accept it.
  if (!isOwner && !isDriver && !staff) { out.riders = undefined; out.pickup = undefined; out.legs = p.legs.map((l) => ({ key: l.key, label: l.label, time: l.time })); }
  return out;
}

export function addHistory(p, status, note) { return [...(p.history || []), { status, at: now(), ...(note && { note }) }]; }
export const newPlanId = () => id();
