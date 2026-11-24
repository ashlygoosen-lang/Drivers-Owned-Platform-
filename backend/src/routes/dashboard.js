import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

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

function monthlyInvoices(list) {
  const groups = {};
  for (const b of list) {
    const key = (b.completedAt || b.createdAt).slice(0, 7);
    groups[key] ||= { period: key, trips: 0, total: 0 };
    groups[key].trips += 1;
    groups[key].total = Math.round((groups[key].total + b.fare) * 100) / 100;
  }
  return Object.values(groups).sort((a, b) => b.period.localeCompare(a.period))
    .map((g) => ({ ...g, ref: `INV-${g.period.replace('-', '')}`, status: g.period === new Date().toISOString().slice(0, 7) ? 'Open' : 'Issued' }));
}

router.get('/dashboard', requireAuth, (req, res) => {
  const u = req.user;
  if (u.role === 'driver') {
    const trips = db.filter('bookings', (b) => b.driverId === u.id);
    const done = trips.filter((b) => b.status === 'completed');
    return res.json({
      stats: [
        { label: 'Gross fares', value: sum(done, 'fare'), money: true },
        { label: 'DROP service fees', value: sum(done, 'driverServiceFee'), money: true },
        { label: 'Your earnings', value: sum(done, 'driverEarnings'), money: true },
        { label: 'Completed trips', value: done.length },
      ],
      chart: { title: 'Earnings · last 7 days', money: true, data: week(done, 'completedAt', 'driverEarnings') },
      driverStatus: u.driverStatus,
      online: u.online,
      rating: u.rating || null,
    });
  }
  if (u.role === 'business') {
    const trips = db.filter('bookings', (b) => b.userId === u.id);
    const done = trips.filter((b) => b.status === 'completed');
    return res.json({
      stats: [
        { label: 'Company trips', value: trips.filter((b) => b.status !== 'cancelled').length },
        { label: 'Spend to date', value: sum(done, 'fare'), money: true },
        { label: 'Team members', value: (u.employees || []).length },
        { label: 'Passenger commission', value: 0, money: true },
      ],
      chart: { title: 'Trips · last 7 days', data: week(trips) },
      invoices: monthlyInvoices(done),
    });
  }
  if (u.role === 'admin') {
    const all = db.all('bookings');
    const done = all.filter((b) => b.status === 'completed');
    return res.json({
      stats: [
        { label: 'Passengers', value: db.filter('users', (x) => x.role === 'passenger').length },
        { label: 'Active drivers', value: db.filter('users', (x) => x.role === 'driver' && x.driverStatus === 'approved').length },
        { label: 'Bookings', value: all.length },
        { label: 'Service fee revenue', value: sum(done, 'driverServiceFee'), money: true },
        { label: 'Pending applications', value: db.filter('applications', (a) => ['submitted', 'under_review'].includes(a.status)).length },
        { label: 'Open tickets', value: db.filter('tickets', (t) => t.status !== 'resolved').length },
      ],
      chart: { title: 'Bookings · last 7 days', data: week(all) },
    });
  }
  const trips = db.filter('bookings', (b) => b.userId === u.id);
  return res.json({
    stats: [
      { label: 'Trips taken', value: trips.filter((b) => b.status === 'completed').length },
      { label: 'Active bookings', value: trips.filter((b) => ['requested', 'accepted', 'arriving', 'in_progress'].includes(b.status)).length },
      { label: 'Spent with DROP', value: sum(trips.filter((b) => b.status === 'completed'), 'fare'), money: true },
      { label: 'Platform commission paid', value: 0, money: true },
    ],
    chart: { title: 'Trips · last 7 days', data: week(trips) },
  });
});

// Public numbers for the homepage counters (live from the database).
router.get('/stats/public', (_req, res) => {
  const done = db.filter('bookings', (b) => b.status === 'completed');
  res.json({
    drivers: db.filter('users', (u) => u.role === 'driver' && u.driverStatus === 'approved').length,
    applications: db.all('applications').length,
    trips: done.length,
    driverEarnings: sum(done, 'driverEarnings'),
  });
});

export default router;
