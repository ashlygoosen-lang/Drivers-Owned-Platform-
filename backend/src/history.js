import { db } from './db.js';

/**
 * History and totals that must include records outside the in-memory window (Phase 6B-1).
 * PostgreSQL mode: one SQL query, with in-memory copies (always the freshest) swapped in.
 * File mode: the same answer computed from memory, which holds everything.
 */
const FIELDS = new Set(['userId', 'driverId', 'bookingId', 'status', 'senderId']);
const ACTIVE = ['accepted', 'arriving', 'in_progress'];
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

function sqlWhere(where, start = 1) {
  const conds = []; const params = [];
  for (const [k, v] of Object.entries(where)) {
    if (!FIELDS.has(k)) throw new Error(`history: field ${k} not allowed`);
    if (v === undefined) continue;
    params.push(k, String(v));
    conds.push(`data->>$${start + params.length - 2} = $${start + params.length - 1}`);
  }
  return { conds, params };
}
const matches = (where) => (r) => Object.entries(where).every(([k, v]) => v === undefined || r[k] === v);

/** Newest first. `q` = free-text search (staff screens). */
export async function list(collection, where = {}, { limit = 200, offset = 0, q } = {}) {
  limit = Math.min(Math.max(1, Number(limit) || 200), 500); offset = Math.max(0, Number(offset) || 0);
  const text = String(q || '').toLowerCase().trim();
  if (!db.usingPostgres()) {
    let rows = db.filter(collection, matches(where));
    if (text) rows = rows.filter((x) => JSON.stringify(x).toLowerCase().includes(text));
    return rows.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(offset, offset + limit);
  }
  const { conds, params } = sqlWhere(where, 2);
  const all = [collection, ...params];
  if (text) { all.push(`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); conds.push(`lower(data::text) like $${all.length}`); }
  all.push(limit, offset);
  const rows = await db.sql(`select id, data from drop_docs where collection = $1 and not deleted ${conds.map((c) => `and ${c}`).join(' ')}
    order by data->>'createdAt' desc limit $${all.length - 1} offset $${all.length}`, all);
  return rows.map((r) => db.byId(collection, r.id) || r.data);
}

/** Trip totals for a passenger, driver, business or everyone. */
export async function tripTotals(where = {}) {
  if (!db.usingPostgres()) {
    const trips = db.filter('bookings', matches(where));
    const done = trips.filter((b) => b.status === 'completed');
    const sum = (k) => money(done.reduce((s, b) => s + (Number(b[k]) || 0), 0));
    return { total: trips.length, completed: done.length, notCancelled: trips.filter((b) => b.status !== 'cancelled').length,
      active: trips.filter((b) => ACTIVE.includes(b.status)).length, fare: sum('fare'), fee: sum('driverServiceFee'), earnings: sum('driverEarnings') };
  }
  const { conds, params } = sqlWhere(where, 1);
  const [r] = await db.sql(`select count(*)::int total,
      count(*) filter (where data->>'status' = 'completed')::int completed,
      count(*) filter (where data->>'status' <> 'cancelled')::int "notCancelled",
      count(*) filter (where data->>'status' in ('accepted','arriving','in_progress'))::int active,
      coalesce(sum((data->>'fare')::numeric) filter (where data->>'status' = 'completed'), 0)::float8 fare,
      coalesce(sum((data->>'driverServiceFee')::numeric) filter (where data->>'status' = 'completed'), 0)::float8 fee,
      coalesce(sum((data->>'driverEarnings')::numeric) filter (where data->>'status' = 'completed'), 0)::float8 earnings
    from drop_docs where collection = 'bookings' and not deleted ${conds.map((c) => `and ${c}`).join(' ')}`, params);
  return { ...r, fare: money(r.fare), fee: money(r.fee), earnings: money(r.earnings) };
}

/** Completed trips per calendar month (business invoices), newest first. */
export async function tripsByMonth(where = {}) {
  if (!db.usingPostgres()) {
    const groups = {};
    for (const b of db.filter('bookings', (x) => matches(where)(x) && x.status === 'completed')) {
      const key = (b.completedAt || b.createdAt).slice(0, 7);
      groups[key] ||= { period: key, trips: 0, total: 0 };
      groups[key].trips += 1; groups[key].total = money(groups[key].total + b.fare);
    }
    return Object.values(groups).sort((a, b) => b.period.localeCompare(a.period));
  }
  const { conds, params } = sqlWhere(where, 1);
  const rows = await db.sql(`select substr(coalesce(data->>'completedAt', data->>'createdAt'), 1, 7) period, count(*)::int trips, coalesce(sum((data->>'fare')::numeric), 0)::float8 total
    from drop_docs where collection = 'bookings' and not deleted and data->>'status' = 'completed' ${conds.map((c) => `and ${c}`).join(' ')}
    group by 1 order by 1 desc`, params);
  return rows.map((r) => ({ ...r, total: money(r.total) }));
}

/** A driver's average rating over all rated trips. */
export async function driverRating(driverId) {
  if (!db.usingPostgres()) {
    const rated = db.filter('bookings', (b) => b.driverId === driverId && b.rating);
    return rated.length ? Math.round((rated.reduce((s, b) => s + b.rating, 0) / rated.length) * 10) / 10 : null;
  }
  const [r] = await db.sql(`select avg((data->>'rating')::numeric)::float8 avg from drop_docs
    where collection = 'bookings' and not deleted and data->>'driverId' = $1 and (data->>'rating') is not null and data->>'rating' <> 'null'`, [driverId]);
  return r.avg == null ? null : Math.round(r.avg * 10) / 10;
}

/** Cached totals for public and admin counters (one SQL aggregate per minute at most). */
let cached = { at: 0, value: null, pending: null };
export async function platformTotals() {
  if (!db.usingPostgres()) return tripTotals();
  if (Date.now() - cached.at < 60_000 && cached.value) return cached.value;
  cached.pending ||= tripTotals().then((v) => { cached = { at: Date.now(), value: v, pending: null }; return v; }).finally(() => { cached.pending = null; });
  return cached.pending;
}
