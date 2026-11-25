import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, UPLOAD_DIR } from './config.js';

/**
 * DROP data store.
 *
 * Reads are served from an in-memory copy (fast, synchronous). Where the data lives depends on
 * DATABASE_URL:
 *
 * - No DATABASE_URL (development, tests): the whole dataset is saved to DATA_DIR/drop-db.json.
 * - DATABASE_URL (production): PostgreSQL is the source of truth.
 *   - Every record is a row in drop_docs (collection, id, data jsonb) with a global change number
 *     (seq). Writes go through to Postgres record by record; updates merge only the fields that
 *     changed.
 *   - Several app instances can run at once: each LISTENs for change notifications and pulls rows
 *     with a higher seq ("catch up"), and a 2-second poll is the safety net.
 *   - The booking rules are enforced by Postgres itself (unique indexes and conditional updates via
 *     insertStrict/updateStrict), so they hold across instances:
 *       · one open trip per passenger
 *       · one active trip per driver
 *       · a trip can only be accepted while it is still waiting for a driver
 *       · ledger postings can't be duplicated
 *   - Money operations run inside withLock (see lock.js), which flushes and catches up first, so they
 *     see every committed write.
 */
const FILE = path.join(DATA_DIR, 'drop-db.json');
const COLLECTIONS = ['users', 'bookings', 'applications', 'tickets', 'enquiries', 'verifications', 'ledger', 'cards', 'cardEvents', 'withdrawals', 'payments', 'notifications', 'audit', 'messages', 'calls', 'sessions', 'devices', 'passwordResets', 'attestKeys', 'securityEvents', 'settings', 'plans'];
const COUNTER_START = { booking: 1000, application: 100, ticket: 100, enquiry: 100, withdrawal: 1000, wallet: 0, plan: 1000 };

/*
 * Hot-data window (Phase 6B-1, PostgreSQL mode only). Each server keeps in memory only what is live
 * or recent; older finished trips, chat, notifications and calls stay in PostgreSQL and are read with
 * SQL when someone opens history (see src/history.js), or faulted back in by id (byIdFresh/faultIn).
 * Nothing is deleted. Records that money jobs still need (unsettled trips, pending refunds) stay hot.
 * Ledger entries never change, so old ones are summed per account once (ledgerBase) and recent ones
 * stay in memory: balance = base + recent, exactly. An entry leaving memory moves into the base.
 */
export const HOT_DAYS = Math.max(8, Number(process.env.HOT_WINDOW_DAYS || 14)); // ≥ 8: dashboards chart the last 7 days from memory
export const ARCHIVABLE = ['bookings', 'messages', 'notifications', 'calls', 'ledger'];
const ledgerBase = new Map(); // account -> raw cents (dr − cr) of ledger entries outside memory
const hotCutoff = () => new Date(Date.now() - HOT_DAYS * 86_400_000);
const COLD_SQL = (p) => `(
  (collection = 'bookings' and updated_at < $${p} and data->>'status' in ('completed','cancelled')
    and coalesce(data->>'paymentStatus','') <> 'refund_pending'
    and not (data->>'status' = 'completed' and data->>'settledAt' is null and data->>'driverId' is not null)
    and not (data->>'status' = 'cancelled' and coalesce(data->>'paymentStatus','') = 'paid'))
  or (collection in ('messages','notifications') and updated_at < $${p})
  or (collection = 'calls' and updated_at < $${p} and coalesce(data->>'status','') not in ('ringing','connected'))
  or (collection = 'ledger' and data->>'createdAt' < $${p + 1}))`;
function isCold(collection, r, cut) {
  if (collection === 'ledger') return Date.parse(r.createdAt || 0) < cut;
  const t = Date.parse(r.updatedAt || r.createdAt || 0);
  if (!(t < cut)) return false;
  if (collection === 'bookings') {
    if (!['completed', 'cancelled'].includes(r.status) || r.paymentStatus === 'refund_pending') return false;
    if (r.status === 'completed' && !r.settledAt && r.driverId) return false;
    if (r.status === 'cancelled' && r.paymentStatus === 'paid') return false;
    return true;
  }
  if (collection === 'ledger') return Date.parse(r.createdAt || 0) < cut; // immutable: age only
  if (collection === 'calls') return !['ringing', 'connected'].includes(r.status);
  return collection === 'messages' || collection === 'notifications';
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const instanceId = crypto.randomBytes(6).toString('hex');

const empty = () => Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
let data = { ...empty(), counters: { ...COUNTER_START } };
const index = new Map(COLLECTIONS.map((c) => [c, new Map()])); // collection -> id -> record
const listeners = new Map(); // collection -> Set(fn(record, kind))

function reindex(collection) {
  const m = new Map();
  for (const r of data[collection]) m.set(r.id, r);
  index.set(collection, m);
}
const ensure = (c) => { if (!data[c]) { data[c] = []; index.set(c, new Map()); } };
const notify = (collection, record, kind, remote = false) => { for (const fn of listeners.get(collection) || []) fn(record, kind, remote); };

/* ======================= backends ======================= */

let pg = null; // { pool, listenClient, maxSeq }
const usingPg = () => Boolean(pg);

/* ---- file backend (development) ---- */
function loadFile() {
  if (!fs.existsSync(FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const c of Object.keys(raw)) if (Array.isArray(raw[c])) data[c] = raw[c];
    data.counters = { ...COUNTER_START, ...(raw.counters || {}) };
    if (raw.settings && !Array.isArray(raw.settings)) data.settings = [{ id: 'platform', ...raw.settings }]; // older format
  } catch (err) {
    const backup = `${FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(FILE, backup);
    console.error(`[drop] Could not read ${FILE}; a copy was kept at ${backup}. Starting with an empty store.`, err);
  }
}
let fileQueue = Promise.resolve();
function persistFile() {
  const snapshot = JSON.stringify(data);
  fileQueue = fileQueue.then(async () => {
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, FILE);
  }).catch((err) => console.error('[drop] Failed to save data', err));
  return fileQueue;
}

/* ---- Postgres backend ---- */
const SCHEMA = `
create sequence if not exists drop_seq;
create table if not exists drop_docs (
  collection text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  seq bigint not null default nextval('drop_seq'),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists drop_docs_seq on drop_docs (seq);
create table if not exists drop_counters (kind text primary key, value bigint not null);
-- One open (non-scheduled) trip per passenger: the booking carries openSlot = passenger id.
create unique index if not exists drop_one_open_trip on drop_docs ((data->>'openSlot'))
  where collection = 'bookings' and not deleted and data->>'openSlot' is not null
  and data->>'status' in ('awaiting_payment','requested','accepted','arriving','in_progress');
-- One active trip per driver.
create unique index if not exists drop_one_active_trip on drop_docs ((data->>'driverId'))
  where collection = 'bookings' and not deleted and data->>'status' in ('accepted','arriving','in_progress');
-- Idempotency: the same client request key can create only one booking.
create unique index if not exists drop_booking_idem on drop_docs ((data->>'idemKey'))
  where collection = 'bookings' and not deleted and data->>'idemKey' is not null;
-- Ledger postings are idempotent by key.
create unique index if not exists drop_ledger_key on drop_docs ((data->>'key'))
  where collection = 'ledger' and not deleted and data->>'key' is not null;
-- Fast lookups used by strict money checks.
create index if not exists drop_ledger_lines on drop_docs using gin ((data->'lines') jsonb_path_ops) where collection = 'ledger';
-- History reads for records outside the in-memory window.
create index if not exists drop_docs_user on drop_docs (collection, (data->>'userId'));
create index if not exists drop_docs_driver on drop_docs ((data->>'driverId')) where collection = 'bookings';
create index if not exists drop_docs_booking on drop_docs (collection, (data->>'bookingId'));
create index if not exists drop_docs_ref on drop_docs ((data->>'ref')) where collection = 'bookings';
create index if not exists drop_docs_payref on drop_docs ((data->>'paymentReference')) where collection = 'bookings';
create index if not exists drop_docs_pendref on drop_docs ((data->>'pendingPaymentReference')) where collection = 'bookings';
create index if not exists drop_docs_created on drop_docs (collection, (data->>'createdAt'));
create index if not exists drop_docs_updated on drop_docs (updated_at);
`;

async function loadPg(url) {
  const { default: pgLib } = await import('pg');
  const ssl = /sslmode=(require|verify)/.test(url) || process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== 'true' } : undefined;
  const pool = new pgLib.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl, application_name: `drop-${instanceId}` });
  pool.on('error', (err) => console.error('[drop] postgres pool error', err.message));
  // Instances starting together (rolling deploys) take turns creating the schema.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('select pg_advisory_lock(727274001)');
    await lockClient.query(SCHEMA);
  } finally {
    await lockClient.query('select pg_advisory_unlock(727274001)').catch(() => undefined);
    lockClient.release();
  }
  pg = { pool, maxSeq: 0n, lib: pgLib, url, ssl };
  // If this database is empty and a JSON data file exists, import it once (migration from the file store).
  const { rows: [{ n }] } = await pool.query('select count(*)::int n from drop_docs');
  if (n === 0 && fs.existsSync(FILE)) { const c = await pool.connect(); try { await c.query('select pg_advisory_lock(727274002)'); const { rows: [{ m: left }] } = await c.query('select count(*)::int m from drop_docs'); if (left === 0) await importFileIntoPg(); } finally { await c.query('select pg_advisory_unlock(727274002)').catch(() => undefined); c.release(); } }
  const cut = hotCutoff();
  const { rows } = await pool.query(`select collection, id, data, seq from drop_docs where not deleted and not ${COLD_SQL(1)} order by seq`, [cut, cut.toISOString()]);
  // Same cut-off: every ledger entry is either loaded above or summed here, never both, never neither.
  const { rows: base } = await pool.query(`select l->>'account' account, sum(coalesce((l->>'dr')::bigint,0) - coalesce((l->>'cr')::bigint,0))::text raw
    from drop_docs d, jsonb_array_elements(d.data->'lines') l where d.collection = 'ledger' and not d.deleted and d.data->>'createdAt' < $1 group by 1`, [cut.toISOString()]);
  ledgerBase.clear();
  for (const b of base) ledgerBase.set(b.account, Number(b.raw));
  const fresh = empty();
  for (const r of rows) { ensure(r.collection); (fresh[r.collection] ||= []).push(r.data); if (BigInt(r.seq) > pg.maxSeq) pg.maxSeq = BigInt(r.seq); }
  for (const c of Object.keys(fresh)) data[c] = fresh[c];
  const { rows: [{ m }] } = await pool.query('select coalesce(max(seq),0)::text m from drop_docs');
  if (BigInt(m) > pg.maxSeq) pg.maxSeq = BigInt(m);
  for (const [kind, start] of Object.entries(COUNTER_START)) await pool.query('insert into drop_counters (kind, value) values ($1, $2) on conflict do nothing', [kind, start]);
  await Promise.all(Object.keys(COUNTER_START).map((k) => refill(k)));
  await listen();
  setInterval(() => { catchUp().catch(() => undefined); }, 2000).unref();
  setInterval(() => { const n = db.evictCold(); if (n) console.log(`[drop] moved ${n} records older than ${HOT_DAYS} days out of memory (still in PostgreSQL)`); }, 3_600_000).unref();
  console.log(`[drop] PostgreSQL store ready (${rows.length} records in memory, ${HOT_DAYS}-day window, instance ${instanceId})`);
}

async function importFileIntoPg() {
  loadFile();
  const client = await pg.pool.connect();
  try {
    await client.query('begin');
    for (const c of COLLECTIONS) for (const r of data[c] || []) await client.query('insert into drop_docs (collection, id, data) values ($1,$2,$3) on conflict do nothing', [c, r.id, r]);
    for (const [kind, value] of Object.entries(data.counters || {})) await client.query('insert into drop_counters (kind, value) values ($1,$2) on conflict (kind) do update set value = greatest(drop_counters.value, excluded.value)', [kind, value]);
    await client.query('commit');
    console.log('[drop] Imported the JSON data file into PostgreSQL.');
  } catch (err) { await client.query('rollback'); throw err; } finally { client.release(); }
}

async function listen() {
  const client = new pg.lib.Client({ connectionString: pg.url, ssl: pg.ssl });
  client.on('error', () => { setTimeout(() => listen().catch(() => undefined), 3000); });
  await client.connect();
  await client.query('listen drop_changes');
  client.on('notification', (msg) => { if (msg.payload !== instanceId) catchUp().catch(() => undefined); });
  pg.listenClient = client;
}

/** Apply a row from Postgres to the in-memory copy. */
function applyRow(collection, rid, row, deleted) {
  ensure(collection);
  const m = index.get(collection);
  const cur = m.get(rid);
  if (deleted) {
    if (cur) { const i = data[collection].indexOf(cur); if (i >= 0) data[collection].splice(i, 1); m.delete(rid); notify(collection, cur, 'delete', true); }
    return;
  }
  if (cur) { for (const k of Object.keys(cur)) if (!(k in row)) delete cur[k]; Object.assign(cur, row); notify(collection, cur, 'update', true); }
  else { data[collection].push(row); m.set(rid, row); notify(collection, row, 'insert', true); }
}

let catching = null;
/*
 * Sequence numbers are taken when a write starts, but writes from different servers can commit out of
 * order: seq 101 may be visible while 100 is still committing. Moving past 100 then would skip it for
 * good. So every missing number is remembered as a hole and looked up again until it shows up or is
 * clearly abandoned (rolled back / lost a uniqueness race), after HOLE_TTL_MS.
 */
const holes = new Map(); // seq (string) -> first seen ms
const HOLE_TTL_MS = 15_000;
let lastHoleCheck = 0;
const MAX_HOLES = 20_000;
function applyFeedRow(r, cut) {
  const key = `${r.collection}\u0000${r.id}`;
  const s = r.seq.toString();
  // An old record written elsewhere (import, bulk anonymise) stays out of memory unless we already hold it.
  const coldElsewhere = !r.deleted && r.data && r.collection !== 'ledger' && ARCHIVABLE.includes(r.collection) && !index.get(r.collection)?.has(r.id) && isCold(r.collection, r.data, cut);
  // Our own writes are already applied; records with unsaved local changes are newer locally
  // (their pending write returns the merged row afterwards).
  if (!coldElsewhere && !ownSeq.has(s) && !pending.has(key) && !inflight.has(key)) applyRow(r.collection, r.id, r.data, r.deleted);
  ownSeq.delete(s);
}
/** Pull every change committed by other instances since the last one we saw. */
export function catchUp() {
  if (!pg) return Promise.resolve(0);
  catching ||= (async () => {
    let n = 0;
    const cut = hotCutoff().getTime();
    const nowMs = Date.now();
    for (const [h, at] of holes) if (nowMs - at > HOLE_TTL_MS) holes.delete(h);
    if (holes.size && nowMs - lastHoleCheck > 250) {
      lastHoleCheck = nowMs;
      const { rows } = await pg.pool.query('select collection, id, data, deleted, seq from drop_docs where seq = any($1::bigint[]) order by seq', [[...holes.keys()]]);
      for (const r of rows) { applyFeedRow(r, cut); holes.delete(r.seq.toString()); n++; }
    }
    for (;;) {
      const { rows } = await pg.pool.query('select collection, id, data, deleted, seq from drop_docs where seq > $1 order by seq limit 1000', [pg.maxSeq.toString()]);
      for (const r of rows) {
        const seq = BigInt(r.seq);
        for (let m = pg.maxSeq + 1n; m < seq && holes.size < MAX_HOLES; m++) holes.set(m.toString(), nowMs);
        applyFeedRow(r, cut);
        pg.maxSeq = seq;
        n++;
      }
      if (rows.length < 1000) break;
    }
    return n;
  })().finally(() => { catching = null; });
  return catching;
}
const ownSeq = new Set(); // seqs we wrote ourselves (already applied locally)

/* ---- write queue (Postgres) ---- */
const pending = new Map(); // `${collection}\u0000${id}` -> { collection, id, kind: 'insert'|'merge'|'full'|'delete', patch }
const inflight = new Set();
let flushTimer = null;
let writing = Promise.resolve();
function queue(collection, rid, kind, patch) {
  if (!pg) { persistFile(); return; }
  const key = `${collection}\u0000${rid}`;
  const prev = pending.get(key);
  if (kind === 'merge' && prev && prev.kind === 'merge') prev.patch = { ...prev.patch, ...patch };
  else if (kind === 'merge' && prev && (prev.kind === 'insert' || prev.kind === 'full')) { /* full write already pending: it reads the live record */ }
  else pending.set(key, { collection, id: rid, kind, patch });
  flushTimer ||= setTimeout(() => { flushTimer = null; void flushPg(); }, 5);
}
function flushPg() {
  writing = writing.then(async () => {
    while (pending.size) {
      const batch = [...pending.values()];
      pending.clear();
      // Mark the whole batch in flight first: catch-up must not apply remote rows to any record still waiting here.
      for (const w of batch) inflight.add(`${w.collection}\u0000${w.id}`);
      for (const w of batch) {
        const rec = index.get(w.collection)?.get(w.id);
        const key = `${w.collection}\u0000${w.id}`;
        try {
          let res;
          if (w.kind === 'delete') res = await pg.pool.query("update drop_docs set deleted = true, data = null, seq = nextval('drop_seq'), updated_at = now() where collection = $1 and id = $2 returning seq", [w.collection, w.id]);
          else if (!rec) continue;
          else if (w.kind === 'merge') res = await pg.pool.query("update drop_docs set data = data || $3::jsonb, seq = nextval('drop_seq'), updated_at = now() where collection = $1 and id = $2 returning seq, data", [w.collection, w.id, JSON.stringify(Object.fromEntries(Object.entries(w.patch).map(([k, v]) => [k, v ?? null])))]);
          else res = await pg.pool.query("insert into drop_docs (collection, id, data) values ($1, $2, $3) on conflict (collection, id) do update set data = excluded.data, deleted = false, seq = nextval('drop_seq'), updated_at = now() returning seq", [w.collection, w.id, JSON.stringify(rec)]);
          for (const r of res?.rows || []) {
            ownSeq.add(r.seq.toString());
            // A merge returns the full row, including fields other instances changed: take it if nothing newer is queued.
            if (r.data && !pending.has(key)) applyRow(w.collection, w.id, r.data, false);
          }
        } catch (err) {
          console.error(`[drop] write failed for ${w.collection}/${w.id}: ${err.message}`);
          if (err.code === '23505' && w.kind === 'insert') applyRow(w.collection, w.id, null, true); // lost a uniqueness race: drop it locally
          else if (/ECONN|terminat|timeout/i.test(err.message)) { pending.set(key, w); await new Promise((r) => setTimeout(r, 1000)); }
        } finally { inflight.delete(key); }
      }
      await pg.pool.query(`notify drop_changes, '${instanceId}'`).catch(() => undefined);
    }
  });
  return writing;
}

/* ======================= counters ======================= */
const blocks = new Map(); // kind -> { next, end, refilling }
const BLOCK = Number(process.env.REF_BLOCK_SIZE || 200);
async function refill(kind) {
  const b = blocks.get(kind) || { next: 0, end: 0, queue: [] };
  if (b.refilling) return b.refilling;
  b.refilling = pg.pool.query('update drop_counters set value = value + $2 where kind = $1 returning value', [kind, BLOCK]).then(({ rows }) => {
    const end = Number(rows[0].value);
    b.queue.push([end - BLOCK + 1, end]);
    if (b.next >= b.end) { const [s, e] = b.queue.shift(); b.next = s; b.end = e + 1; }
  }).finally(() => { b.refilling = null; });
  blocks.set(kind, b);
  return b.refilling;
}
/** Next number for a counter. With Postgres each instance takes its own block, so numbers never collide. */
export function nextNumber(kind) {
  if (!pg) { data.counters[kind] = (data.counters[kind] ?? COUNTER_START[kind] ?? 0) + 1; persistFile(); return data.counters[kind]; }
  const b = blocks.get(kind);
  if (!b || (b.next >= b.end && !b.queue.length)) {
    if (!blocks.has(kind)) void refill(kind);
    return Number(`9${Date.now().toString().slice(-8)}${crypto.randomInt(10, 99)}`); // never collides with block numbers
  }
  if (b.next >= b.end) { const [s, e] = b.queue.shift(); b.next = s; b.end = e + 1; }
  const n = b.next++;
  if (b.end - b.next < BLOCK * 0.25 && !b.queue.length) void refill(kind);
  return n;
}
export const nextRef = (kind, prefix) => `${prefix}-${nextNumber(kind)}`;

/* ======================= public API ======================= */
export class ConflictError extends Error {
  constructor(message, constraint) { super(message); this.status = 409; this.code = 'conflict'; this.constraint = constraint; }
}

export const db = {
  /** Legacy accessor (counters, raw collections). Prefer the methods below. */
  get: () => data,
  all: (collection) => { ensure(collection); return data[collection]; },
  find: (collection, predicate) => { ensure(collection); return data[collection].find(predicate); },
  filter: (collection, predicate) => { ensure(collection); return data[collection].filter(predicate); },
  byId: (collection, rid) => index.get(collection)?.get(rid),
  /** byId that catches up with other servers on a miss, then looks outside the memory window. */
  async byIdFresh(collection, recordId) {
    const hit = this.byId(collection, recordId);
    if (hit || !pg || typeof recordId !== 'string') return hit;
    await catchUp();
    return this.byId(collection, recordId) || this.faultIn(collection, 'id', recordId);
  },
  /**
   * Find one record by a field, loading it from PostgreSQL into memory if it is outside the window
   * (an old trip being rated, a late payment webhook). Returns the live in-memory record, so
   * db.update works on it; once touched it stays hot for another window.
   */
  async faultIn(collection, field, value) {
    ensure(collection);
    if (value == null || value === '') return undefined;
    if (collection === 'ledger') return data.ledger.find((r) => r[field] === value); // never load old entries back: they are in ledgerBase
    const mem = field === 'id' ? index.get(collection).get(value) : data[collection].find((r) => r[field] === value);
    if (mem || !pg) return mem;
    const { rows } = await pg.pool.query(field === 'id'
      ? 'select id, data from drop_docs where collection = $1 and id = $2 and not deleted'
      : 'select id, data from drop_docs where collection = $1 and data->>$2 = $3 and not deleted limit 1', field === 'id' ? [collection, value] : [collection, field, String(value)]);
    if (!rows.length) return undefined;
    const existing = index.get(collection).get(rows[0].id);
    if (existing) return existing;
    data[collection].push(rows[0].data); index.get(collection).set(rows[0].id, rows[0].data);
    return rows[0].data;
  },
  /** Read-only SQL for history and reports (PostgreSQL mode). Queued writes are flushed first. */
  async sql(text, params = []) {
    if (!pg) throw new Error('db.sql needs PostgreSQL');
    await this.flush();
    return (await pg.pool.query(text, params)).rows;
  },
  /**
   * Apply a patch to every matching record, including those outside the memory window
   * (e.g. anonymising a deleted user's messages). Memory copies get the same patch.
   */
  async patchWhere(collection, field, value, patch) {
    const changes = (x) => Object.entries(patch).some(([k, v]) => x[k] !== v);
    for (const r of this.filter(collection, (x) => x[field] === value && changes(x))) this.update(collection, r.id, patch);
    if (!pg) return;
    await this.flush();
    const { rows } = await pg.pool.query(`update drop_docs set data = data || $4::jsonb, seq = nextval('drop_seq'), updated_at = now()
      where collection = $1 and data->>$2 = $3 and not deleted and not (data @> $5::jsonb) returning seq`, [collection, field, String(value), JSON.stringify({ ...patch, updatedAt: now() }), JSON.stringify(patch)]);
    for (const r of rows) ownSeq.add(r.seq.toString());
    void pg.pool.query(`notify drop_changes, '${instanceId}'`).catch(() => undefined);
  },
  /** Drop cold records from memory (never from PostgreSQL). Runs hourly on every server. */
  evictCold() {
    if (!pg) return 0;
    const cut = hotCutoff().getTime();
    let n = 0;
    for (const c of ARCHIVABLE) {
      const list = data[c];
      if (!list) continue;
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const key = `${c}\u0000${r.id}`;
        if (isCold(c, r, cut) && !pending.has(key) && !inflight.has(key)) {
          if (c === 'ledger') for (const l of r.lines || []) ledgerBase.set(l.account, (ledgerBase.get(l.account) || 0) + (l.dr || 0) - (l.cr || 0));
          index.get(c).delete(r.id); n++;
        }
        else list[w++] = r;
      }
      list.length = w;
    }
    return n;
  },
  /** Like find, but if nothing matches, first pull other servers' latest writes (read-after-write across instances). */
  async findFresh(collection, predicate) {
    ensure(collection);
    const hit = data[collection].find(predicate);
    if (hit || !pg) return hit;
    await catchUp();
    return data[collection].find(predicate);
  },
  insert(collection, record) {
    ensure(collection);
    data[collection].push(record);
    index.get(collection).set(record.id, record);
    queue(collection, record.id, 'insert');
    notify(collection, record, 'insert');
    return record;
  },
  update(collection, recordId, patch) {
    const record = index.get(collection)?.get(recordId);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: now() });
    // The merge carries the values as of now, so a remote row applied before the flush cannot blank them.
    queue(collection, recordId, 'merge', JSON.parse(JSON.stringify({ ...patch, updatedAt: record.updatedAt }, (_k, v) => (v === undefined ? null : v))));
    return record;
  },
  /** Persist records that were changed in place. */
  touch(collection, ...records) { for (const r of records) if (r?.id) queue(collection, r.id, 'full'); },
  /** Delete records matching a predicate. */
  remove(collection, predicate) {
    ensure(collection);
    const list = data[collection];
    const gone = list.filter(predicate);
    if (!gone.length) return 0;
    const keep = list.filter((r) => !gone.includes(r));
    list.splice(0, list.length, ...keep);
    for (const r of gone) { index.get(collection).delete(r.id); queue(collection, r.id, 'delete'); }
    return gone.length;
  },
  /** Legacy: persist everything (file mode) / every record in a collection (Postgres). Avoid in hot paths. */
  save(collection) {
    if (!pg) return persistFile();
    for (const c of collection ? [collection] : COLLECTIONS) for (const r of data[c] || []) queue(c, r.id, 'full');
    return flushPg();
  },
  /** Wait until every queued write is durable. */
  flush: async () => { if (pg) { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } await flushPg(); } else await fileQueue; },

  /**
   * Insert and wait for Postgres to accept it, so unique indexes decide races between instances.
   * `conflict(existing)` reproduces the rule in memory (used in file mode, and for a friendly early answer).
   */
  async insertStrict(collection, record, { conflict, message = 'This conflicts with an existing record.' } = {}) {
    ensure(collection);
    if (conflict && data[collection].some(conflict)) throw new ConflictError(message);
    if (!pg) return this.insert(collection, record);
    try {
      const { rows } = await pg.pool.query('insert into drop_docs (collection, id, data) values ($1, $2, $3) returning seq', [collection, record.id, JSON.stringify(record)]);
      ownSeq.add(rows[0].seq.toString());
    } catch (err) {
      if (err.code === '23505') { await catchUp(); throw new ConflictError(message, err.constraint); }
      throw err;
    }
    data[collection].push(record);
    index.get(collection).set(record.id, record);
    notify(collection, record, 'insert');
    void pg.pool.query(`notify drop_changes, '${instanceId}'`).catch(() => undefined);
    return record;
  },

  /**
   * Conditional update decided by Postgres: applies only if every `when` field still has one of the
   * allowed values (e.g. { status: ['requested'] }). Returns the updated record, or null if the
   * condition no longer holds (someone else changed it first). Unique-index violations throw ConflictError.
   */
  async updateStrict(collection, recordId, patch, { when = {}, message = 'This was changed by someone else.' } = {}) {
    const record = index.get(collection)?.get(recordId);
    const holds = (r) => r && Object.entries(when).every(([k, allowed]) => [].concat(allowed).some((v) => (v === null ? r[k] == null : r[k] === v)));
    if (!pg) {
      if (!holds(record)) return null;
      return this.update(collection, recordId, patch);
    }
    const full = { ...patch, updatedAt: now() };
    const params = [collection, recordId, JSON.stringify(full)];
    const conds = Object.entries(when).map(([k, allowed]) => {
      const vals = [].concat(allowed);
      const nonNull = vals.filter((v) => v !== null).map(String);
      params.push(k); const kp = params.length;
      params.push(nonNull); const vp = params.length;
      return `((data->>$${kp}) = any($${vp}::text[])${vals.includes(null) ? ` or (data->>$${kp}) is null` : ''})`;
    });
    let rows;
    try {
      ({ rows } = await pg.pool.query(`update drop_docs set data = data || $3::jsonb, seq = nextval('drop_seq'), updated_at = now() where collection = $1 and id = $2 and not deleted ${conds.length ? `and ${conds.join(' and ')}` : ''} returning data, seq`, params));
    } catch (err) {
      if (err.code === '23505') { await catchUp(); throw new ConflictError(message, err.constraint); }
      throw err;
    }
    if (!rows.length) { await catchUp(); return null; }
    ownSeq.add(rows[0].seq.toString());
    applyRow(collection, recordId, rows[0].data, false);
    void pg.pool.query(`notify drop_changes, '${instanceId}'`).catch(() => undefined);
    return index.get(collection).get(recordId);
  },

  /** Strongly consistent wallet/ledger balance (raw debit − credit) straight from Postgres. */
  async ledgerRaw(account) {
    if (!pg) return null;
    await this.flush();
    const { rows } = await pg.pool.query(`select coalesce(sum(coalesce((l->>'dr')::bigint,0) - coalesce((l->>'cr')::bigint,0)),0)::text v
      from drop_docs d, jsonb_array_elements(d.data->'lines') l
      where d.collection = 'ledger' and not d.deleted and d.data->'lines' @> $1::jsonb and l->>'account' = $2`, [JSON.stringify([{ account }]), account]);
    return Number(rows[0].v);
  },

  onChange(collection, fn) { if (!listeners.has(collection)) listeners.set(collection, new Set()); listeners.get(collection).add(fn); },
  usingPostgres: usingPg,
  /** Per-account raw totals (cents, dr − cr) of ledger entries not held in memory. */
  ledgerBase: () => ledgerBase,
  async health() {
    if (!pg) return { store: 'file', ok: true };
    const t = Date.now();
    await pg.pool.query('select 1');
    return { store: 'postgres', ok: true, ms: Date.now() - t, pending: pending.size, hotDays: HOT_DAYS, feedHoles: holes.size, inMemory: Object.fromEntries(ARCHIVABLE.map((c) => [c, data[c]?.length || 0])), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576), pool: { total: pg.pool.totalCount, idle: pg.pool.idleCount, waiting: pg.pool.waitingCount } };
  },
  async close() { await this.flush(); if (pg) { await pg.listenClient?.end().catch(() => undefined); await pg.pool.end(); } },
};

/** Settings (maintenance mode etc.) live in the `settings` collection, record "platform". */
export const settings = () => index.get('settings')?.get('platform') || {};
export function setSettings(patch) {
  if (!index.get('settings')?.get('platform')) db.insert('settings', { id: 'platform', ...patch });
  else db.update('settings', 'platform', patch);
  return settings();
}

/** Load the data. Call once before serving requests. */
export async function initDb() {
  if (process.env.DATABASE_URL) await loadPg(process.env.DATABASE_URL);
  else loadFile();
  for (const c of Object.keys(data)) if (Array.isArray(data[c])) { ensure(c); reindex(c); }
}

// File mode loads synchronously at import so scripts and tests that never call initDb still work.
if (!process.env.DATABASE_URL) { loadFile(); for (const c of Object.keys(data)) if (Array.isArray(data[c])) { ensure(c); reindex(c); } }
