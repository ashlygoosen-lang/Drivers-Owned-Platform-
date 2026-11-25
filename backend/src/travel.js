import { db, id, now, nextRef, ConflictError } from './db.js';
import { encryptText, decryptText } from './kyc.js';

/**
 * Group travel (flights and buses). Travellers join a group for one route and one set of dates; when
 * the group reaches its minimum by the fill deadline, DROP books the whole group with the partner at a
 * bulk rate. Generic over transport types: add one to TRANSPORT_TYPES to support e.g. trains or ferries.
 *
 * Status: OPEN → MINIMUM_REACHED → FULL → CONFIRMED_WITH_PARTNER → TICKETED → COMPLETED, or CANCELLED.
 *  - OPEN / MINIMUM_REACHED: joinable (PostgreSQL allows only one joinable group per groupKey).
 *  - FULL: every seat taken; a new group (next sequence) opens for the same route and dates.
 *  - After the fill deadline nobody can join; the group is confirmed with the partner or, if below its
 *    minimum, cancelled with refunds or transfer offers (route setting).
 * Money is held per group in the ledger account travel_escrow:<groupId> until the partner is confirmed.
 * All amounts are charged in ZAR (Paystack in South Africa settles in ZAR); a USD estimate is shown when
 * an exchange rate is configured.
 */
export const TRANSPORT_TYPES = {
  flight: { label: 'Flight', defaultCapacity: 360, defaultDeadlineDays: 21, passportForInternational: true },
  bus: { label: 'Bus', defaultCapacity: 60, defaultDeadlineDays: 3, passportForInternational: true },
};
export const JOINABLE = ['OPEN', 'MINIMUM_REACHED'];
export const PRE_CONFIRM = ['OPEN', 'MINIMUM_REACHED', 'FULL'];
export const GROUP_STATUSES = ['OPEN', 'MINIMUM_REACHED', 'FULL', 'CONFIRMED_WITH_PARTNER', 'TICKETED', 'COMPLETED', 'CANCELLED'];
/** A booking holds its seats this long while the customer pays; then the seats are released. */
export const HOLD_MINUTES = () => Number(process.env.TRAVEL_HOLD_MINUTES ?? 30);
export const DEFAULT_POLICY = { beforeDeadlinePct: 0, afterDeadlinePct: 50, afterTicketedPct: 100 };
export const SAST = 2 * 3_600_000;
export const sastDate = (ms = Date.now()) => new Date(ms + SAST).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Fill deadline: the end (23:59 SAST) of the day `deadlineDays` before departure. */
export function deadlineFor(departureDate, deadlineDays) {
  const d = new Date(Date.parse(`${departureDate}T00:00:00Z`) - deadlineDays * 86_400_000).toISOString().slice(0, 10);
  return `${d}T23:59:59+02:00`;
}
export const groupKey = (route, departureDate, returnDate) => [route.type, route.partnerId, route.origin, route.destination, departureDate, returnDate || 'oneway'].join('|');

export function usdRate() { const r = Number(process.env.TRAVEL_USD_ZAR || db.byId('settings', 'platform')?.travelUsdZar || 0); return r > 0 ? r : null; }
export const usd = (zar) => { const r = usdRate(); return r ? round2(zar / r) : null; };

/** Deposit rules for a group and a number of seats. */
export function amounts(group, seats, option) {
  const total = round2(group.pricePerPerson * seats);
  const depositAllowed = group.depositPct > 0 && Date.now() < Date.parse(group.deadline) - 2 * 86_400_000;
  const deposit = option === 'deposit' && depositAllowed ? round2(total * group.depositPct / 100) : total;
  return { total, dueNow: deposit, balance: round2(total - deposit), depositAllowed, balanceDueAt: deposit < total ? group.deadline : null };
}

/** Cancellation fee (percentage of the total) depending on where the group is in its life. */
export function cancellationFeePct(group) {
  const pol = { ...DEFAULT_POLICY, ...(group.cancellationPolicy || {}) };
  if (['TICKETED', 'COMPLETED'].includes(group.status)) return pol.afterTicketedPct;
  if (Date.now() > Date.parse(group.deadline) || group.status === 'CONFIRMED_WITH_PARTNER') return pol.afterDeadlinePct;
  return pol.beforeDeadlinePct;
}

/** Create the group for a route and dates (or return the joinable one if another request created it first). */
export async function openGroup(route, departureDate, returnDate, { createdBy = 'system' } = {}) {
  const key = groupKey(route, departureDate, returnDate);
  const existing = db.find('travelGroups', (g) => g.groupKey === key && JOINABLE.includes(g.status));
  if (existing) return existing;
  const seq = Math.max(0, ...db.filter('travelGroups', (g) => g.groupKey === key).map((g) => g.sequence || 0)) + 1;
  const deadline = deadlineFor(departureDate, route.deadlineDays);
  try {
    return await db.insertStrict('travelGroups', {
      id: id(), ref: `${route.type === 'bus' ? 'BUS' : 'FLT'}-${nextRef('travelGroup', 'G').slice(2)}`, groupKey: key, sequence: seq,
      routeId: route.id, partnerId: route.partnerId, type: route.type, origin: route.origin, destination: route.destination,
      originName: route.originName, destinationName: route.destinationName, international: route.international,
      departureDate, returnDate: returnDate || null, capacity: route.capacity, minimum: route.minimum, seatsTaken: 0, paidSeats: 0,
      pricePerPerson: route.pricePerPerson, bulkRate: route.bulkRate, currency: 'ZAR', depositPct: route.depositPct,
      cancellationPolicy: route.cancellationPolicy, failurePolicy: route.failurePolicy, deadline, status: 'OPEN', milestones: [],
      createdBy, createdAt: now(), history: [{ status: 'OPEN', at: now(), note: seq > 1 ? `Overflow group ${seq}` : createdBy === 'system' ? 'Opened by a customer search' : `Opened by ${createdBy}` }],
    }, { conflict: (g) => g.groupKey === key && (JOINABLE.includes(g.status) || g.sequence === seq), message: 'Group exists.' });
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    const joinable = db.find('travelGroups', (x) => x.groupKey === key && JOINABLE.includes(x.status));
    if (joinable) return joinable;
    return openGroup(route, departureDate, returnDate, { createdBy });
  }
}

/**
 * Reserve seats on the joinable group for a route and dates. If it is full, it is closed and the next
 * group opens automatically. The seat counter is changed atomically by PostgreSQL (db.adjustStrict).
 */
export async function reserveSeats(route, departureDate, returnDate, seats) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const group = await openGroup(route, departureDate, returnDate);
    if (Date.now() > Date.parse(group.deadline)) throw Object.assign(new Error('This group has passed its deadline to fill.'), { status: 400 });
    if (seats > group.capacity) throw Object.assign(new Error(`A group has ${group.capacity} seats. Please book fewer travellers at a time.`), { status: 400 });
    const updated = await db.adjustStrict('travelGroups', group.id, 'seatsTaken', seats, { maxField: 'capacity', statuses: JOINABLE });
    if (updated) {
      if (updated.seatsTaken >= updated.capacity) await closeFull(updated);
      return updated;
    }
    // Not enough seats left: close it as full and try the next group.
    const fresh = db.byId('travelGroups', group.id);
    if (fresh && JOINABLE.includes(fresh.status) && fresh.capacity - fresh.seatsTaken < seats) await closeFull(fresh);
  }
  throw Object.assign(new Error('This route is very busy right now. Please try again.'), { status: 409 });
}

async function closeFull(g) {
  const updated = await db.updateStrict('travelGroups', g.id, { status: 'FULL', fullAt: now(), history: [...(g.history || []), { status: 'FULL', at: now() }] }, { when: { status: JOINABLE } });
  return updated;
}

/** Give seats back (hold expired, booking cancelled). A FULL group stays closed; its free seats are reported to staff. */
export async function releaseSeats(groupId, seats, { paid = false } = {}) {
  const g = await db.adjustStrict('travelGroups', groupId, 'seatsTaken', -seats, {});
  if (paid) await db.adjustStrict('travelGroups', groupId, 'paidSeats', -seats, {});
  return g;
}

/* ---------------- Passengers: personal data protection ---------------- */
export function sealPassenger(p) {
  const { passportNumber, ...rest } = p;
  return { ...rest, passportNumber: passportNumber ? encryptText(passportNumber) : null, passportLast4: passportNumber ? passportNumber.slice(-4) : null };
}
export function openPassenger(p, { reveal = false } = {}) {
  const { passportNumber, ...rest } = p;
  return { ...rest, passport: passportNumber ? (reveal ? decryptText(passportNumber) : `•••• ${p.passportLast4}`) : null };
}
export function ageOn(dob, date) {
  const b = new Date(`${dob}T00:00:00Z`), d = new Date(`${date}T00:00:00Z`);
  let a = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/** Group as the public (search results) sees it. */
export function groupView(g, { staff = false } = {}) {
  const partner = db.byId('partners', g.partnerId);
  const out = {
    id: g.id, ref: g.ref, type: g.type, typeLabel: TRANSPORT_TYPES[g.type]?.label || g.type, origin: g.origin, destination: g.destination,
    originName: g.originName, destinationName: g.destinationName, international: g.international, departureDate: g.departureDate, returnDate: g.returnDate,
    partner: partner ? { id: partner.id, name: partner.name } : null, capacity: g.capacity, minimum: g.minimum, seatsTaken: g.seatsTaken, paidSeats: g.paidSeats,
    seatsLeft: Math.max(0, g.capacity - g.seatsTaken), pricePerPerson: g.pricePerPerson, pricePerPersonUsd: usd(g.pricePerPerson), currency: 'ZAR',
    depositPct: g.depositPct, deadline: g.deadline, daysLeft: Math.max(0, Math.ceil((Date.parse(g.deadline) - Date.now()) / 86_400_000)),
    status: g.status, sequence: g.sequence, joinable: JOINABLE.includes(g.status) && Date.now() < Date.parse(g.deadline),
    fillPct: Math.round((g.paidSeats / g.capacity) * 100), minimumPct: Math.round((g.minimum / g.capacity) * 100),
  };
  if (staff) Object.assign(out, { bulkRate: g.bulkRate, partnerReference: g.partnerReference || null, failurePolicy: g.failurePolicy, cancellationPolicy: g.cancellationPolicy, history: g.history, routeId: g.routeId, confirmedAt: g.confirmedAt || null, ticketedAt: g.ticketedAt || null });
  return out;
}
