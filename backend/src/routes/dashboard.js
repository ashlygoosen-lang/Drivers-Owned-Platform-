import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { balance, walletBalance, rands } from '../money/ledger.js';
import { wrap } from '../validate.js';
import { tripTotals, tripsByMonth, platformTotals } from '../history.js';

const router = Router();
const DAY = 86_400_000;
const sum = (list, key) => Math.round(list.reduce((s, x) => s + (x[key] || 0), 0) * 100) / 100;

/** Last 7 days of activity, oldest first, for the bar chart. */
function week(list, dateKey = 'createdAt', valueKey = null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const start = +today - (6 - i) * DAY;
    const items = list.filter((x) => {
      const t = +new Date(x[dateKey] || x.createdAt);
      return t >= start && t < start + DAY;
    });
    return {
      day: new Date(start).toLocaleDateString('en-ZA', { weekday: 'short' }),
      value: valueKey ? sum(items, valueKey) : items.length,
    };
  });
}

/** Monthly statements for a business account (all time, from PostgreSQL when it is on). */
async function monthlyInvoices(userId) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (await tripsByMonth({ userId })).map((g) => ({ ...g, ref: `INV-${g.period.replace('-', '')}`, status: g.period === thisMonth ? 'Open' : 'Issued' }));
}

// Totals come from history.js (whole history); 7-day charts from memory, which always holds the last 7+ days.
router.get('/dashboard', requireAuth, wrap(async (req, res) => {
  const u = req.user;
  if (u.role === 'driver') {
    const done = db.filter('bookings', (b) => b.driverId === u.id && b.status === 'completed');
    const t = await tripTotals({ driverId: u.id });
    return res.json({
      stats: [
        { label: 'Gross fares', value: t.fare, money: true },
        { label: 'DROP service fees', value: t.fee, money: true },
        { label: 'Your earnings', value: t.earnings, money: true },
        { label: 'Wallet balance', value: rands(walletBalance(u.id)), money: true },
        { label: 'Completed trips', value: t.completed },
      ],
      chart: { title: 'Earnings · last 7 days', money: true, data: week(done, 'completedAt', 'driverEarnings') },
      driverStatus: u.driverStatus,
      verificationStatus: u.verificationStatus || 'not_started',
      online: u.online,
      rating: u.rating || null,
    });
  }
  if (u.role === 'business') {
    const trips = db.filter('bookings', (b) => b.userId === u.id);
    const t = await tripTotals({ userId: u.id });
    return res.json({
      stats: [
        { label: 'Company trips', value: t.notCancelled },
        { label: 'Spend to date', value: t.fare, money: true },
        { label: 'Team members', value: (u.employees || []).length },
        { label: 'Passenger commission', value: 0, money: true },
      ],
      chart: { title: 'Trips · last 7 days', data: week(trips) },
      invoices: await monthlyInvoices(u.id),
    });
  }
  if (u.role === 'compliance') {
    const vs = db.all('verifications');
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
    const expiring = vs.flatMap((v) => v.documents.filter((d) => !d.archived && d.expiresAt && d.expiresAt <= soon && d.status === 'approved')).length;
    const reviews = db.filter('audit', (a) => a.action.startsWith('document.') || a.action.startsWith('verification.approved'));
    return res.json({
      stats: [
        { label: 'Awaiting review', value: vs.filter((v) => v.status === 'submitted').length },
        { label: 'Waiting on customer', value: vs.filter((v) => v.status === 'action_required').length },
        { label: 'Verified accounts', value: vs.filter((v) => v.status === 'verified').length },
        { label: 'Drivers awaiting review', value: vs.filter((v) => v.status === 'submitted' && v.role === 'driver').length },
        { label: 'Documents expiring in 30 days', value: expiring },
        { label: 'Reviewed today', value: reviews.filter((a) => a.at.startsWith(today)).length },
      ],
      chart: { title: 'Document reviews · last 7 days', data: week(reviews, 'at') },
    });
  }
  if (u.role === 'finance') {
    const since = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const spend = db.filter('cardEvents', (e) => e.method === 'Deduct' && e.approved);
    return res.json({
      stats: [
        { label: 'Pool account (ledger)', value: rands(balance('pool')), money: true },
        { label: 'Held for open trips', value: rands(balance('escrow')), money: true },
        { label: 'Owed to drivers', value: rands(db.all('users').filter((x) => x.role === 'driver').reduce((s2, d) => s2 + walletBalance(d.id), 0)), money: true },
        { label: 'DROP fees earned', value: rands(balance('fees')), money: true },
        { label: 'Withdrawals to pay', value: db.filter('withdrawals', (w) => w.status === 'requested').length },
        { label: 'Card spend today', value: rands(spend.filter((e) => e.createdAt >= since).reduce((s2, e) => s2 + e.amount - (e.reversed || 0), 0)), money: true },
      ],
      chart: { title: 'Card spend · last 7 days', money: true, data: week(spend.map((e) => ({ ...e, value: (e.amount - (e.reversed || 0)) / 100 })), 'createdAt', 'value') },
    });
  }
  if (u.role === 'support') {
    const tickets = db.all('tickets');
    return res.json({
      stats: [
        { label: 'Open tickets', value: tickets.filter((t) => t.status === 'open').length },
        { label: 'In progress', value: tickets.filter((t) => t.status === 'in_progress').length },
        { label: 'Urgent safety tickets', value: tickets.filter((t) => t.priority === 'urgent' && t.status !== 'resolved').length },
        { label: 'New enquiries', value: db.filter('enquiries', (e) => e.status === 'new').length },
        { label: 'Active trips', value: db.filter('bookings', (b) => ['accepted', 'arriving', 'in_progress'].includes(b.status)).length },
        { label: 'Resolved tickets', value: tickets.filter((t) => t.status === 'resolved').length },
      ],
      chart: { title: 'New tickets · last 7 days', data: week(tickets) },
    });
  }
  if (u.role === 'admin') {
    const all = db.all('bookings');
    const t = await platformTotals();
    return res.json({
      stats: [
        { label: 'Passengers', value: db.filter('users', (x) => x.role === 'passenger').length },
        { label: 'Active drivers', value: db.filter('users', (x) => x.role === 'driver' && x.driverStatus === 'approved').length },
        { label: 'Bookings', value: t.total },
        { label: 'Service fee revenue', value: t.fee, money: true },
        { label: 'Pending applications', value: db.filter('applications', (a) => ['submitted', 'under_review'].includes(a.status)).length },
        { label: 'Open tickets', value: db.filter('tickets', (t) => t.status !== 'resolved').length },
        { label: 'Verifications awaiting review', value: db.filter('verifications', (v) => v.status === 'submitted').length },
        { label: 'Verified customers', value: db.filter('verifications', (v) => v.status === 'verified' && v.role !== 'driver').length },
        { label: 'Trips in progress', value: all.filter((b) => ['accepted', 'arriving', 'in_progress'].includes(b.status)).length },
      ],
      chart: { title: 'Bookings · last 7 days', data: week(all) },
    });
  }
  const trips = db.filter('bookings', (b) => b.userId === u.id);
  const t = await tripTotals({ userId: u.id });
  return res.json({
    stats: [
      { label: 'Trips taken', value: t.completed },
      { label: 'Active bookings', value: trips.filter((b) => ['requested', 'accepted', 'arriving', 'in_progress'].includes(b.status)).length },
      { label: 'Spent with DROP', value: t.fare, money: true },
      { label: 'Platform commission paid', value: 0, money: true },
    ],
    chart: { title: 'Trips · last 7 days', data: week(trips) },
  });
}));

// Public numbers for the homepage counters (live from the database).
router.get('/stats/public', wrap(async (_req, res) => {
  const t = await platformTotals();
  res.json({
    drivers: db.filter('users', (u) => u.role === 'driver' && u.driverStatus === 'approved').length,
    applications: db.all('applications').length,
    trips: t.completed,
    driverEarnings: t.earnings,
  });
}));

export default router;
