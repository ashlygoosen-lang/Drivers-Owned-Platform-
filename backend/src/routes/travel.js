import { Router } from 'express';
import { requireStepUp } from './auth.js';
import { db, id, now, nextRef } from '../db.js';
import { requireAuth, requireRole, optionalAuth } from '../auth.js';
import { str, int, oneOf, wrap, bad, HttpError } from '../validate.js';
import { audit } from '../kyc.js';
import { verificationGate } from './bookings.js';
import * as paystack from '../money/paystack.js';
import { cents, balance } from '../money/ledger.js';
import { escrowAccount, payableAccount, recordPartnerPayout } from '../money/travel.js';
import {
  TRANSPORT_TYPES, JOINABLE, GROUP_STATUSES, DEFAULT_POLICY, HOLD_MINUTES, sastDate, daysBetween, deadlineFor, groupKey, usd, usdRate,
  amounts, reserveSeats, openGroup, sealPassenger, openPassenger, ageOn, groupView, cancellationFeePct,
} from '../travel.js';
import { ACTIVE_BOOKING, PAID_BOOKING, members, cancelBooking, transferBooking, refundBooking, confirmGroup, tell, tripLabel } from '../travelService.js';

const router = Router();
const PUBLIC_URL = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const round2 = (n) => Math.round(n * 100) / 100;
const rands = (c) => round2(c / 100);
const isoDate = (v, label, { optional = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s && optional) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw bad(`${label}: use the format YYYY-MM-DD.`);
  return s;
};
const code = (v, label) => str(v, label, { min: 2, max: 60 }).trim();
const norm = (s) => String(s || '').toLowerCase().trim();
const matchPlace = (q, codeV, name) => !q || norm(codeV) === norm(q) || norm(name).includes(norm(q));

/* ======================= Customers ======================= */

/** Places served (for search suggestions) and transport types. */
router.get('/travel/places', (_req, res) => {
  const routes = db.filter('travelRoutes', (r) => r.active);
  const places = new Map();
  for (const r of routes) { places.set(r.origin, r.originName); places.set(r.destination, r.destinationName); }
  res.json({ types: Object.entries(TRANSPORT_TYPES).map(([k, v]) => ({ key: k, label: v.label })), places: [...places].map(([c, name]) => ({ code: c, name })), usdRate: usdRate() });
});

/**
 * Search: every active route that matches, with the open group for the exact dates (or what a new group
 * would look like), plus other open groups on the route within two weeks as alternatives.
 */
router.get('/travel/search', optionalAuth, (req, res) => {
  const q = req.query;
  const type = q.type ? oneOf(q.type, Object.keys(TRANSPORT_TYPES), 'Transport type') : null;
  const departureDate = isoDate(q.departureDate, 'Departure date');
  const returnDate = isoDate(q.returnDate, 'Return date', { optional: true });
  if (returnDate && returnDate <= departureDate) throw bad('The return date must be after the departure date.');
  const travellers = int(q.travellers ?? 1, 'Travellers', { min: 1, max: 20 });
  const today = sastDate();
  const routes = db.filter('travelRoutes', (r) => r.active && (!type || r.type === type) && matchPlace(q.origin, r.origin, r.originName) && matchPlace(q.destination, r.destination, r.destinationName));
  const results = routes.map((r) => {
    const key = groupKey(r, departureDate, returnDate);
    const group = db.find('travelGroups', (g) => g.groupKey === key && JOINABLE.includes(g.status));
    const deadline = deadlineFor(departureDate, r.deadlineDays);
    const tooLate = Date.now() > Date.parse(deadline);
    const alternatives = db.filter('travelGroups', (g) => g.routeId === r.id && JOINABLE.includes(g.status) && g.groupKey !== key && Math.abs(daysBetween(g.departureDate, departureDate)) <= 14 && Date.now() < Date.parse(g.deadline))
      .sort((a, b) => a.departureDate.localeCompare(b.departureDate)).slice(0, 5).map((g) => groupView(g));
    const partner = db.byId('partners', r.partnerId);
    return {
      route: { id: r.id, type: r.type, typeLabel: TRANSPORT_TYPES[r.type].label, origin: r.origin, destination: r.destination, originName: r.originName, destinationName: r.destinationName, international: r.international, partner: partner?.name || '' },
      group: group ? groupView(group) : null,
      newGroup: !group && !tooLate && departureDate > today ? { capacity: r.capacity, minimum: r.minimum, pricePerPerson: r.pricePerPerson, pricePerPersonUsd: usd(r.pricePerPerson), depositPct: r.depositPct, deadline, daysLeft: Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000) } : null,
      tooLate, alternatives, fits: group ? group.capacity - group.seatsTaken >= travellers : travellers <= r.capacity,
    };
  });
  res.json({ results, travellers, departureDate, returnDate, usdRate: usdRate() });
});

/** No route yet: register interest so staff can see demand and set one up with a partner. */
router.post('/travel/interest', optionalAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const rec = db.insert('travelInterest', {
    id: id(), userId: req.user?.id || null, type: oneOf(b.type, Object.keys(TRANSPORT_TYPES), 'Transport type'),
    origin: code(b.origin, 'From'), destination: code(b.destination, 'To'), departureDate: isoDate(b.departureDate, 'Departure date'),
    returnDate: isoDate(b.returnDate, 'Return date', { optional: true }), travellers: int(b.travellers ?? 1, 'Travellers', { min: 1, max: 50 }),
    email: req.user?.email || str(b.email, 'Email', { min: 5, max: 120 }), createdAt: now(),
  });
  res.status(201).json({ ok: true, id: rec.id });
}));

function passengerInput(p, i, { international, departureDate, travelUntil }) {
  const n = `Traveller ${i + 1}`;
  const fullName = str(p?.fullName, `${n}: full name as on passport`, { min: 3, max: 100 });
  const dateOfBirth = isoDate(p?.dateOfBirth, `${n}: date of birth`);
  const age = ageOn(dateOfBirth, departureDate);
  if (age < 0 || age > 120) throw bad(`${n}: please check the date of birth.`);
  const nationality = str(p?.nationality, `${n}: nationality`, { min: 2, max: 56 });
  let passportNumber = null, passportExpiry = null;
  if (international || p?.passportNumber) {
    passportNumber = String(p?.passportNumber || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(passportNumber)) throw bad(`${n}: enter the passport number (6–12 letters and digits).`);
    passportExpiry = isoDate(p?.passportExpiry, `${n}: passport expiry date`);
    if (passportExpiry <= travelUntil) throw bad(`${n}: the passport must be valid after your travel dates (many countries require 6 months’ validity).`);
  }
  return { fullName, dateOfBirth, age, nationality, passportNumber, passportExpiry, email: p?.email ? str(p.email, `${n}: email`, { max: 120 }) : '', phone: p?.phone ? str(p.phone, `${n}: phone`, { max: 20 }) : '' };
}

/** Join: reserve seats in the group (creating it or its overflow if needed), record passengers, hold for payment. */
router.post('/travel/join', requireAuth, wrap(async (req, res) => {
  verificationGate(req.user);
  if (!paystack.paystackEnabled()) throw bad('Card payments are not available yet, so group travel can’t be booked online.');
  const b = req.body || {};
  const route = db.byId('travelRoutes', String(b.routeId || ''));
  if (!route || !route.active) throw new HttpError(404, 'This route is not available.');
  const departureDate = isoDate(b.departureDate, 'Departure date');
  const returnDate = isoDate(b.returnDate, 'Return date', { optional: true });
  if (returnDate && returnDate <= departureDate) throw bad('The return date must be after the departure date.');
  if (departureDate <= sastDate()) throw bad('Choose a departure date in the future.');
  const list = Array.isArray(b.passengers) ? b.passengers : [];
  if (!list.length || list.length > 20) throw bad('Add between 1 and 20 travellers.');
  const pax = list.map((p, i) => passengerInput(p, i, { international: route.international, departureDate, travelUntil: returnDate || departureDate }));
  const minors = pax.filter((p) => p.age < 18);
  let guardian = null;
  if (minors.length) {
    if (b.guardian?.consent !== true) throw bad('Travellers under 18 need the consent of a parent or legal guardian (POPIA section 35).');
    guardian = { name: str(b.guardian.name, 'Parent or guardian name', { min: 3, max: 100 }), relationship: str(b.guardian.relationship, 'Relationship', { min: 3, max: 60 }), consentAt: now() };
  }
  const option = oneOf(b.paymentOption || 'full', ['full', 'deposit'], 'Payment option');
  const contactEmail = str(b.contactEmail || req.user.email, 'Contact email', { min: 5, max: 120 });
  const contactPhone = str(b.contactPhone || req.user.phone || '', 'Contact phone', { optional: true, max: 20 });
  const group = await reserveSeats(route, departureDate, returnDate, pax.length);
  const a = amounts(group, pax.length, option);
  const booking = db.insert('groupBookings', {
    id: id(), ref: nextRef('groupBooking', 'GTB'), userId: req.user.id, groupId: group.id, routeId: route.id, seats: pax.length,
    pricePerPerson: group.pricePerPerson, total: a.total, option: a.dueNow < a.total ? 'deposit' : 'full', depositCents: cents(a.dueNow), balanceDueAt: a.balanceDueAt,
    paidCents: 0, refundedCents: 0, payments: [], refunds: [], status: 'held', holdExpiresAt: new Date(Date.now() + HOLD_MINUTES() * 60_000).toISOString(),
    contactEmail, contactPhone, guardian, fxRate: usdRate(), createdAt: now(), history: [{ status: 'held', at: now(), note: `${pax.length} seat(s) held` }],
  });
  for (const p of pax) { const { age, ...rest } = p; db.insert('groupPassengers', { id: id(), bookingId: booking.id, groupId: group.id, userId: req.user.id, minor: age < 18, ...sealPassenger(rest), createdAt: now() }); }
  res.status(201).json({ booking: bookingView(booking), amounts: a });
}));

function bookingView(b, { reveal = false } = {}) {
  const g = db.byId('travelGroups', b.groupId);
  const paid = b.paidCents || 0;
  return {
    id: b.id, ref: b.ref, status: b.status, seats: b.seats, total: b.total, pricePerPerson: b.pricePerPerson, option: b.option,
    paid: rands(paid), refunded: rands(b.refundedCents || 0), balance: Math.max(0, round2(b.total - rands(paid))), balanceDueAt: b.balanceDueAt,
    depositDue: rands(b.depositCents || 0), holdExpiresAt: b.holdExpiresAt, cancelReason: b.cancelReason || null, feeCharged: rands(b.feeCents || 0),
    transferOfferExpiresAt: b.transferOfferExpiresAt || null, refundPending: rands(b.refundPendingCents || 0), createdAt: b.createdAt, history: b.history,
    totalUsd: usd(b.total), group: g ? groupView(g) : null,
    passengers: db.filter('groupPassengers', (p) => p.bookingId === b.id).map((p) => openPassenger(p, { reveal })),
  };
}

router.post('/payments/travel/:bookingId/checkout', requireAuth, wrap(async (req, res) => {
  const b = db.byId('groupBookings', String(req.params.bookingId));
  if (!b || b.userId !== req.user.id) throw new HttpError(404, 'Booking not found.');
  let amountCents, kind;
  if (b.status === 'held') {
    if (Date.parse(b.holdExpiresAt) < Date.now()) throw bad('Your seat hold has expired. Please start the booking again.');
    amountCents = b.depositCents; kind = b.option === 'deposit' ? 'deposit' : 'full';
  } else if (b.status === 'deposit_paid') {
    amountCents = cents(b.total) - (b.paidCents || 0); kind = 'balance';
  } else throw bad('This booking has nothing to pay.');
  const reference = `${b.ref}-${Date.now().toString(36)}`;
  const tx = await paystack.initialize({
    email: req.user.email, amountCents, reference,
    callbackUrl: `${PUBLIC_URL() || `${req.protocol}://${req.get('host')}`}/?payment_ref=${encodeURIComponent(reference)}`,
    metadata: { groupBookingId: b.id, bookingRef: b.ref, userId: req.user.id, kind },
  });
  db.update('groupBookings', b.id, { pendingPaymentReference: reference, pendingAmountCents: amountCents, pendingKind: kind });
  res.json({ authorizationUrl: tx.authorization_url, reference, amount: rands(amountCents) });
}));

router.get('/travel/my', requireAuth, (req, res) => {
  const list = db.filter('groupBookings', (b) => b.userId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ bookings: list.map((b) => bookingView(b)) });
});

router.get('/travel/my/:id', requireAuth, (req, res) => {
  const b = db.byId('groupBookings', String(req.params.id));
  if (!b || b.userId !== req.user.id) throw new HttpError(404, 'Booking not found.');
  const g = db.byId('travelGroups', b.groupId);
  const alternatives = b.status === 'transfer_offered' ? db.filter('travelGroups', (x) => x.id !== g.id && x.type === g.type && x.origin === g.origin && x.destination === g.destination && JOINABLE.includes(x.status) && Date.now() < Date.parse(x.deadline) && x.capacity - x.seatsTaken >= b.seats && x.pricePerPerson <= g.pricePerPerson).map((x) => groupView(x)) : [];
  const feePct = ACTIVE_BOOKING.includes(b.status) && b.status !== 'held' ? cancellationFeePct(g) : 0;
  res.json({ booking: bookingView(b), cancellation: { feePct, policy: { ...DEFAULT_POLICY, ...(g.cancellationPolicy || {}) } }, alternatives });
});

router.post('/travel/my/:id/cancel', requireAuth, wrap(async (req, res) => {
  const b = db.byId('groupBookings', String(req.params.id));
  if (!b || b.userId !== req.user.id) throw new HttpError(404, 'Booking not found.');
  res.json({ booking: bookingView(await cancelBooking(b, { by: 'customer' })) });
}));

router.post('/travel/my/:id/transfer', requireAuth, wrap(async (req, res) => {
  const b = db.byId('groupBookings', String(req.params.id));
  if (!b || b.userId !== req.user.id) throw new HttpError(404, 'Booking not found.');
  res.json({ booking: bookingView(await transferBooking(b, String(req.body?.groupId || ''))) });
}));

router.post('/travel/my/:id/decline-transfer', requireAuth, wrap(async (req, res) => {
  const b = db.byId('groupBookings', String(req.params.id));
  if (!b || b.userId !== req.user.id || b.status !== 'transfer_offered') throw new HttpError(404, 'Booking not found.');
  db.update('groupBookings', b.id, { status: 'refunded', history: [...b.history, { status: 'refunded', at: now(), note: 'Transfer declined' }] });
  const left = (b.paidCents || 0) - (b.refundedCents || 0);
  res.json({ booking: bookingView(await refundBooking(b, left, 'group cancelled, transfer declined')) });
}));

/* ======================= Admin ======================= */
const read = requireRole('admin', 'support', 'finance');
const write = requireRole('admin');
const ops = requireRole('admin', 'support');

function partnerInput(b, existing = {}) {
  return {
    name: str(b.name ?? existing.name, 'Partner name', { min: 2, max: 100 }),
    type: oneOf(b.type ?? existing.type, Object.keys(TRANSPORT_TYPES), 'Partner type'),
    contactName: str(b.contactName ?? existing.contactName ?? '', 'Contact name', { optional: true, max: 100 }),
    contactEmail: str(b.contactEmail ?? existing.contactEmail ?? '', 'Contact email', { optional: true, max: 120 }),
    contactPhone: str(b.contactPhone ?? existing.contactPhone ?? '', 'Contact phone', { optional: true, max: 30 }),
    defaultCapacity: int(b.defaultCapacity ?? existing.defaultCapacity ?? TRANSPORT_TYPES[b.type ?? existing.type]?.defaultCapacity ?? 60, 'Default capacity', { min: 1, max: 1000 }),
    notes: str(b.notes ?? existing.notes ?? '', 'Notes', { optional: true, max: 500 }),
    active: b.active === undefined ? existing.active ?? true : Boolean(b.active),
  };
}
router.get('/admin/travel/partners', read, (_req, res) => {
  res.json({ partners: db.all('partners').map((p) => ({ ...p, routes: db.filter('travelRoutes', (r) => r.partnerId === p.id).length, owed: rands(balance(payableAccount(p.id))) })) });
});
router.post('/admin/travel/partners', write, wrap(async (req, res) => {
  const p = db.insert('partners', { id: id(), ...partnerInput(req.body || {}), createdAt: now() });
  audit(req.user, 'travel.partner_created', p.id, { name: p.name });
  res.status(201).json({ partner: p });
}));
router.put('/admin/travel/partners/:id', write, wrap(async (req, res) => {
  const p = db.byId('partners', req.params.id);
  if (!p) throw new HttpError(404, 'Partner not found.');
  const updated = db.update('partners', p.id, partnerInput(req.body || {}, p));
  audit(req.user, 'travel.partner_updated', p.id, { name: updated.name });
  res.json({ partner: updated });
}));

function routeInput(b, existing = {}) {
  const partnerId = String(b.partnerId ?? existing.partnerId ?? '');
  const partner = db.byId('partners', partnerId);
  if (!partner) throw bad('Choose a partner.');
  const type = partner.type;
  const capacity = int(b.capacity ?? existing.capacity ?? partner.defaultCapacity, 'Capacity', { min: 1, max: 1000 });
  const minimum = int(b.minimum ?? existing.minimum ?? Math.ceil(capacity * 0.7), 'Minimum to confirm', { min: 1, max: capacity });
  const bulkRate = Number(b.bulkRate ?? existing.bulkRate);
  const pricePerPerson = Number(b.pricePerPerson ?? existing.pricePerPerson);
  if (!(bulkRate > 0)) throw bad('Enter the partner bulk rate per seat (ZAR).');
  if (!(pricePerPerson >= bulkRate)) throw bad('The price per person must be at least the partner bulk rate.');
  const pol = { ...DEFAULT_POLICY, ...(existing.cancellationPolicy || {}), ...(b.cancellationPolicy || {}) };
  for (const k of Object.keys(DEFAULT_POLICY)) if (!(pol[k] >= 0 && pol[k] <= 100)) throw bad('Cancellation fees are percentages from 0 to 100.');
  return {
    partnerId, type, origin: code(b.origin ?? existing.origin, 'Origin code').toUpperCase(), destination: code(b.destination ?? existing.destination, 'Destination code').toUpperCase(),
    originName: str(b.originName ?? existing.originName, 'Origin name', { min: 2, max: 80 }), destinationName: str(b.destinationName ?? existing.destinationName, 'Destination name', { min: 2, max: 80 }),
    international: Boolean(b.international ?? existing.international), capacity, minimum, bulkRate: round2(bulkRate), pricePerPerson: round2(pricePerPerson),
    deadlineDays: int(b.deadlineDays ?? existing.deadlineDays ?? TRANSPORT_TYPES[type].defaultDeadlineDays, 'Fill deadline (days before departure)', { min: 1, max: 180 }),
    depositPct: int(b.depositPct ?? existing.depositPct ?? 30, 'Deposit %', { min: 0, max: 100 }),
    failurePolicy: oneOf(b.failurePolicy ?? existing.failurePolicy ?? 'refund', ['refund', 'transfer'], 'If the group does not fill'),
    cancellationPolicy: pol, active: b.active === undefined ? existing.active ?? true : Boolean(b.active),
  };
}
router.get('/admin/travel/routes', read, (_req, res) => {
  res.json({ routes: db.all('travelRoutes').map((r) => ({ ...r, partner: db.byId('partners', r.partnerId)?.name || '', marginPerSeat: round2(r.pricePerPerson - r.bulkRate) })) });
});
router.post('/admin/travel/routes', write, wrap(async (req, res) => {
  const r = db.insert('travelRoutes', { id: id(), ...routeInput(req.body || {}), createdAt: now() });
  audit(req.user, 'travel.route_created', r.id, { route: `${r.origin}-${r.destination}` });
  res.status(201).json({ route: r });
}));
router.put('/admin/travel/routes/:id', write, wrap(async (req, res) => {
  const r = db.byId('travelRoutes', req.params.id);
  if (!r) throw new HttpError(404, 'Route not found.');
  const updated = db.update('travelRoutes', r.id, routeInput(req.body || {}, r));
  audit(req.user, 'travel.route_updated', r.id, { route: `${updated.origin}-${updated.destination}` });
  res.json({ route: updated }); // existing groups keep the terms they opened with
}));

function money(g) {
  const held = balance(escrowAccount(g.id));
  const seats = members(g.id).reduce((s, b) => s + b.seats, 0);
  const collected = rands(db.filter('groupBookings', (b) => b.groupId === g.id).reduce((s, b) => s + (b.paidCents || 0) - (b.refundedCents || 0) - (b.feeCents || 0), 0));
  const partnerCost = g.partnerCents != null ? rands(g.partnerCents) : round2(g.bulkRate * seats);
  // Before confirmation, profit is the expected margin on the seats paid so far (deposits would make collected − cost misleading).
  return { heldInEscrow: rands(held), collected, partnerCost, profit: g.marginCents != null ? rands(g.marginCents) : round2((g.pricePerPerson - g.bulkRate) * seats), profitFinal: g.marginCents != null,
    paidToPartner: rands(db.filter('partnerPayouts', (p) => p.groupId === g.id).reduce((s, p) => s + p.amountCents, 0)),
    fees: rands(db.filter('groupBookings', (b) => b.groupId === g.id).reduce((s, b) => s + (b.feeCents || 0), 0)) };
}

router.get('/admin/travel/groups', read, (req, res) => {
  const q = req.query;
  const all = db.all('travelGroups');
  const list = all.filter((g) => (!q.status || g.status === q.status) && (!q.type || g.type === q.type) && (!q.partnerId || g.partnerId === q.partnerId)
    && (!q.from || g.departureDate >= q.from) && (!q.to || g.departureDate <= q.to)
    && (!q.q || `${g.ref} ${g.origin} ${g.destination} ${g.originName} ${g.destinationName}`.toLowerCase().includes(norm(q.q))))
    .sort((a, b) => a.departureDate.localeCompare(b.departureDate)).slice(0, 300);
  const soon = Date.now() + 7 * 86_400_000;
  const alerts = all.filter((g) => JOINABLE.includes(g.status) && Date.parse(g.deadline) < soon && g.paidSeats < g.minimum)
    .map((g) => ({ ...groupView(g), shortBy: g.minimum - g.paidSeats }));
  const pending = all.filter((g) => ['MINIMUM_REACHED', 'FULL'].includes(g.status) && Date.now() > Date.parse(g.deadline));
  res.json({
    kpis: {
      open: all.filter((g) => JOINABLE.includes(g.status)).length, toConfirm: pending.length, confirmed: all.filter((g) => ['CONFIRMED_WITH_PARTNER', 'TICKETED'].includes(g.status)).length,
      travellers: all.filter((g) => g.status !== 'CANCELLED').reduce((s, g) => s + g.paidSeats, 0),
      heldInEscrow: rands(all.reduce((s, g) => s + balance(escrowAccount(g.id)), 0)),
      owedToPartners: rands(db.all('partners').reduce((s, p) => s + balance(payableAccount(p.id)), 0)),
      margin: rands(balance('travel_margin')), fees: rands(balance('travel_fees')),
      interest: db.all('travelInterest').length,
    },
    alerts, toConfirm: pending.map((g) => groupView(g)),
    groups: list.map((g) => ({ ...groupView(g, { staff: true }), money: money(g) })),
  });
});

router.post('/admin/travel/groups', write, wrap(async (req, res) => {
  const r = db.byId('travelRoutes', String(req.body?.routeId || ''));
  if (!r || !r.active) throw bad('Choose an active route.');
  const departureDate = isoDate(req.body?.departureDate, 'Departure date');
  const returnDate = isoDate(req.body?.returnDate, 'Return date', { optional: true });
  if (Date.now() > Date.parse(deadlineFor(departureDate, r.deadlineDays))) throw bad('That departure is too close to fill a group before its deadline.');
  const g = await openGroup(r, departureDate, returnDate, { createdBy: req.user.name });
  audit(req.user, 'travel.group_created', g.id, { group: g.ref });
  res.status(201).json({ group: groupView(g, { staff: true }) });
}));

router.get('/admin/travel/groups/:id', read, (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g) throw new HttpError(404, 'Group not found.');
  const bookings = db.filter('groupBookings', (b) => b.groupId === g.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((b) => {
    const u = db.byId('users', b.userId);
    return { ...bookingView(b), customer: u ? { name: u.name, email: u.email, phone: u.phone } : null, contactEmail: b.contactEmail, contactPhone: b.contactPhone, guardian: b.guardian || null, tickets: b.tickets || [] };
  });
  res.json({ group: groupView(g, { staff: true }), money: money(g), partner: db.byId('partners', g.partnerId), bookings,
    payouts: db.filter('partnerPayouts', (p) => p.groupId === g.id), partnerOwed: rands(balance(payableAccount(g.partnerId))) });
});

router.post('/admin/travel/groups/:id/confirm', write, wrap(async (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g) throw new HttpError(404, 'Group not found.');
  const updated = await confirmGroup(g, { partnerReference: str(req.body?.partnerReference, 'Partner booking reference', { min: 2, max: 60 }), actor: req.user });
  res.json({ group: groupView(updated, { staff: true }) });
}));

router.post('/admin/travel/groups/:id/payout', write, wrap(async (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g) throw new HttpError(404, 'Group not found.');
  const amount = Number(req.body?.amount);
  if (!(amount > 0)) throw bad('Enter the amount paid to the partner.');
  const kind = oneOf(req.body?.kind || 'balance', ['deposit', 'balance'], 'Payment type');
  if (kind === 'balance' && !['CONFIRMED_WITH_PARTNER', 'TICKETED', 'COMPLETED'].includes(g.status)) throw bad('Record the balance after the group is confirmed. Use “deposit” for money paid to hold the seats.');
  if (kind === 'balance') {
    const paid = db.filter('partnerPayouts', (p) => p.groupId === g.id).reduce((s, p) => s + p.amountCents, 0);
    const left = (g.partnerCents || 0) - paid;
    if (cents(amount) > left) throw bad(`That is more than the R${(Math.max(0, left) / 100).toFixed(2)} still owed to the partner for this group.`);
  }
  const payout = db.insert('partnerPayouts', { id: id(), groupId: g.id, groupRef: g.ref, partnerId: g.partnerId, amountCents: cents(amount), kind, reference: str(req.body?.reference, 'Payment reference', { min: 2, max: 80 }), recordedBy: req.user.id, createdAt: now() });
  recordPartnerPayout(payout);
  audit(req.user, 'travel.partner_paid', g.id, { group: g.ref, amount: String(amount), kind, reference: payout.reference });
  res.status(201).json({ payout });
}));

/** Ticket numbers per passenger (and the partner's booking reference); passengers are told and can see them. */
router.post('/admin/travel/groups/:id/tickets', ops, wrap(async (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g || !['CONFIRMED_WITH_PARTNER', 'TICKETED'].includes(g.status)) throw bad('Tickets can be added once the group is confirmed with the partner.');
  const tickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
  let n = 0;
  for (const t of tickets) {
    const p = db.byId('groupPassengers', String(t.passengerId || ''));
    if (!p || p.groupId !== g.id) continue;
    db.update('groupPassengers', p.id, { ticketNumber: str(t.ticketNumber, 'Ticket number', { min: 3, max: 40 }), seat: str(t.seat || '', 'Seat', { optional: true, max: 10 }), ticketedAt: now() });
    n++;
  }
  const pax = db.filter('groupPassengers', (p) => p.groupId === g.id && members(g.id).some((b) => b.id === p.bookingId));
  const done = pax.length > 0 && pax.every((p) => p.ticketNumber);
  if (done && g.status !== 'TICKETED') {
    db.update('travelGroups', g.id, { status: 'TICKETED', ticketedAt: now(), history: [...g.history, { status: 'TICKETED', at: now() }] });
    for (const b of members(g.id)) {
      db.update('groupBookings', b.id, { status: 'ticketed' });
      const list = db.filter('groupPassengers', (p) => p.bookingId === b.id).map((p) => `${p.fullName}: ${p.ticketNumber}${p.seat ? ` (seat ${p.seat})` : ''}`).join('; ');
      tell(b.userId, `Your tickets are ready: ${g.ref}`, `${tripLabel(g)}. Partner booking reference ${g.partnerReference}. Tickets: ${list}. Bring the passport you booked with.`);
    }
  }
  audit(req.user, 'travel.tickets_added', g.id, { group: g.ref, count: String(n) });
  res.json({ updated: n, ticketed: done });
}));

/** Passenger manifest for the partner. Passport numbers are decrypted here only, for admin and support, and every export is audited. */
function manifest(g) {
  const ok = members(g.id).map((b) => b.id);
  return db.filter('groupPassengers', (p) => p.groupId === g.id && ok.includes(p.bookingId)).map((p) => {
    const b = db.byId('groupBookings', p.bookingId);
    const o = openPassenger(p, { reveal: true });
    return [g.ref, b.ref, o.fullName, o.dateOfBirth, o.nationality, o.passport || '', o.passportExpiry || '', o.minor ? 'Yes' : 'No', o.email || b.contactEmail, o.phone || b.contactPhone || '', o.ticketNumber || ''];
  });
}
const MANIFEST_HEAD = ['Group', 'Booking', 'Full name (as on passport)', 'Date of birth', 'Nationality', 'Passport number', 'Passport expiry', 'Minor', 'Email', 'Phone', 'Ticket'];
router.get('/admin/travel/groups/:id/manifest.csv', ops, requireStepUp, (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g) throw new HttpError(404, 'Group not found.');
  audit(req.user, 'travel.manifest_exported', g.id, { group: g.ref, format: 'csv' });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${g.ref}-manifest.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send([MANIFEST_HEAD, ...manifest(g)].map((r) => r.map(esc).join(',')).join('\n'));
});
/** Printable manifest (open and print or save as PDF from the browser). */
router.get('/admin/travel/groups/:id/manifest.html', ops, requireStepUp, (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g) throw new HttpError(404, 'Group not found.');
  audit(req.user, 'travel.manifest_exported', g.id, { group: g.ref, format: 'print' });
  const e = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const partner = db.byId('partners', g.partnerId);
  const rows = manifest(g);
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${e(g.ref)} manifest</title><style>body{font:12px Arial,sans-serif;margin:24px;color:#071B3A}h1{font-size:18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd7e1;padding:5px;text-align:left}th{background:#eef2f7}p{margin:4px 0}</style></head><body>
<h1>Passenger manifest · ${e(g.ref)}</h1><p><b>Partner:</b> ${e(partner?.name)} · <b>Partner reference:</b> ${e(g.partnerReference || '—')}</p>
<p><b>Route:</b> ${e(g.originName)} (${e(g.origin)}) → ${e(g.destinationName)} (${e(g.destination)}) · <b>Departure:</b> ${e(g.departureDate)}${g.returnDate ? ` · <b>Return:</b> ${e(g.returnDate)}` : ''} · <b>Passengers:</b> ${rows.length}</p>
<p>Confidential: contains personal information protected by POPIA. Share only with the partner for this booking.</p>
<table><thead><tr>${MANIFEST_HEAD.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<p style="margin-top:16px">Generated ${e(new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }))} by DROP, a division of VINK Group (Pty) Ltd.</p></body></html>`);
});

/** Cancel a group (e.g. partner withdrew). Applies the group's failure policy: refund all, or offer transfers. */
router.post('/admin/travel/groups/:id/cancel', write, wrap(async (req, res) => {
  const g = db.byId('travelGroups', req.params.id);
  if (!g || ['TICKETED', 'COMPLETED', 'CANCELLED'].includes(g.status)) throw bad('This group cannot be cancelled here.');
  const reason = str(req.body?.reason, 'Reason', { min: 3, max: 200 });
  const { failGroup } = await import('../travelJobs.js');
  await failGroup(g, { reason, policy: req.body?.policy || g.failurePolicy, actor: req.user });
  res.json({ group: groupView(db.byId('travelGroups', g.id), { staff: true }) });
}));

router.post('/admin/travel/bookings/:id/cancel', ops, wrap(async (req, res) => {
  const b = db.byId('groupBookings', req.params.id);
  if (!b) throw new HttpError(404, 'Booking not found.');
  const updated = await cancelBooking(b, { by: req.user.name, reason: str(req.body?.reason, 'Reason', { min: 3, max: 200 }), waiveFee: req.body?.waiveFee === true && req.user.role === 'admin' });
  audit(req.user, 'travel.booking_cancelled', b.id, { booking: b.ref });
  res.json({ booking: bookingView(updated) });
}));

/** Revenue and profit by route, partner or month (confirmed groups, plus cancellation fees). */
router.get('/admin/travel/reports', read, (req, res) => {
  const by = oneOf(req.query.by || 'month', ['route', 'partner', 'month'], 'Group by');
  const rows = new Map();
  for (const g of db.filter('travelGroups', (x) => x.status !== 'OPEN')) {
    const m = money(g);
    const key = by === 'route' ? `${g.originName} → ${g.destinationName} (${TRANSPORT_TYPES[g.type]?.label})` : by === 'partner' ? db.byId('partners', g.partnerId)?.name || '—' : g.departureDate.slice(0, 7);
    const r = rows.get(key) || { key, groups: 0, travellers: 0, revenue: 0, partnerCost: 0, profit: 0, fees: 0, cancelled: 0 };
    r.groups++; r.fees = round2(r.fees + m.fees);
    if (g.status === 'CANCELLED') r.cancelled++;
    else if (['CONFIRMED_WITH_PARTNER', 'TICKETED', 'COMPLETED'].includes(g.status)) { r.travellers += g.confirmedSeats || g.paidSeats; r.revenue = round2(r.revenue + rands(g.collectedCents || 0)); r.partnerCost = round2(r.partnerCost + rands(g.partnerCents || 0)); r.profit = round2(r.profit + rands(g.marginCents || 0)); }
    rows.set(key, r);
  }
  res.json({ by, rows: [...rows.values()].sort((a, b) => b.key.localeCompare(a.key)), statuses: GROUP_STATUSES });
});

router.get('/admin/travel/interest', read, (_req, res) => {
  const agg = new Map();
  for (const i of db.all('travelInterest')) {
    const k = `${i.type}|${i.origin.toUpperCase()}|${i.destination.toUpperCase()}`;
    const a = agg.get(k) || { type: i.type, origin: i.origin, destination: i.destination, requests: 0, travellers: 0, months: new Set() };
    a.requests++; a.travellers += i.travellers; a.months.add(i.departureDate.slice(0, 7)); agg.set(k, a);
  }
  res.json({ demand: [...agg.values()].map((a) => ({ ...a, months: [...a.months].sort() })).sort((a, b) => b.travellers - a.travellers) });
});

export { bookingView, PAID_BOOKING };
export default router;
