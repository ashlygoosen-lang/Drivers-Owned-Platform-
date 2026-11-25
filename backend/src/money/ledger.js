/**
 * DROP double-entry ledger.
 *
 * Every movement of money is a balanced journal entry (total debits = total credits), so the books
 * always reconcile to the real pool (trust) bank account.
 *
 * Accounts
 *   pool                 ASSET      Money in the DROP pool bank account (passenger card payments land here)
 *   receivable:business  ASSET      Business-account trips invoiced but not yet paid
 *   escrow               LIABILITY  Passenger payments for trips that are not yet completed
 *   wallet:<userId>      LIABILITY  What DROP owes each driver (their spendable / withdrawable balance)
 *   card_settlement      LIABILITY  Driver card spend owed to the card scheme via Paymentology
 *   payouts_pending      LIABILITY  Approved withdrawals waiting for the bank transfer
 *   fees                 REVENUE    DROP service fees
 *
 * Amounts are stored in cents (integers) to avoid rounding errors.
 */
import { db, id, now } from '../db.js';
import { HttpError } from '../validate.js';

export const ASSET_ACCOUNTS = new Set(['pool', 'receivable:business']);
const isAsset = (account) => ASSET_ACCOUNTS.has(account);

export const cents = (rands) => Math.round(Number(rands) * 100);
export const rands = (c) => Math.round(c) / 100;

let balances = null;
let byKey = null; // idempotency key -> entry (recent entries; older keys are guarded by PostgreSQL's unique index)
const add = (b, t) => { for (const l of t.lines) b.set(l.account, (b.get(l.account) || 0) + (l.dr || 0) - (l.cr || 0)); };
// Entries written by other servers arrive through the store's catch-up. A new entry is added to the
// totals directly (before: every remote entry rebuilt all totals, quadratic under load); anything else rebuilds.
db.onChange('ledger', (entry, kind, remote) => {
  if (!remote) return;
  if (kind === 'insert' && balances && entry?.lines) { add(balances, entry); if (entry.key) byKey?.set(entry.key, entry); }
  else { balances = null; byKey = null; }
});
/** Totals = entries outside memory (summed once, db.ledgerBase) + entries in memory. Exact in cents. */
function cache() {
  if (!balances) {
    balances = new Map(db.ledgerBase ? db.ledgerBase() : []);
    byKey = new Map();
    for (const t of db.all('ledger')) { add(balances, t); if (t.key) byKey.set(t.key, t); }
  }
  return balances;
}

/** Natural balance in cents: positive = money held (assets) or owed (liabilities/revenue). */
export function balance(account) {
  const raw = cache().get(account) || 0;
  return isAsset(account) ? raw : 0 - raw; // (0 - 0 is 0, not -0)
}

export const walletAccount = (userId) => `wallet:${userId}`;
export const walletBalance = (userId) => balance(walletAccount(userId));

/**
 * Post a balanced entry. lines: [{ account, dr?, cr? }] in cents.
 * `key` makes the post idempotent: posting the same key twice returns the first entry.
 */
export function post({ type, memo, lines, meta = {}, key = null, actor = null }) {
  if (key) {
    cache();
    const existing = byKey.get(key);
    if (existing && db.byId('ledger', existing.id)) return existing;
  }
  const clean = lines.filter((l) => (l.dr || 0) !== 0 || (l.cr || 0) !== 0).map((l) => ({ account: l.account, dr: Math.round(l.dr || 0), cr: Math.round(l.cr || 0) }));
  const dr = clean.reduce((s, l) => s + l.dr, 0);
  const cr = clean.reduce((s, l) => s + l.cr, 0);
  if (!clean.length || dr !== cr) throw new HttpError(500, `Unbalanced ledger entry (${type}): ${dr} ≠ ${cr}`);
  if (clean.some((l) => l.dr < 0 || l.cr < 0)) throw new HttpError(500, `Negative ledger line (${type}).`);
  const b = cache(); // build totals before inserting so the new entry is counted exactly once
  const entry = { id: id(), key, type, memo, lines: clean, meta, actor, createdAt: now() };
  db.insert('ledger', entry);
  add(b, entry);
  if (key) byKey.set(key, entry);
  return entry;
}

/** Entries touching an account, newest first, with the signed effect on that account (whole history). */
export async function statement(account, limit = 200) {
  const shape = (t) => {
    const raw = t.lines.filter((l) => l.account === account).reduce((s, l) => s + l.dr - l.cr, 0);
    return { id: t.id, type: t.type, memo: t.memo, meta: t.meta, createdAt: t.createdAt, amount: isAsset(account) ? raw : -raw };
  };
  if (db.usingPostgres()) {
    const rows = await db.sql(`select data from drop_docs where collection = 'ledger' and not deleted and data->'lines' @> $1::jsonb
      order by data->>'createdAt' desc limit $2`, [JSON.stringify([{ account }]), limit]);
    return rows.map((r) => shape(r.data));
  }
  const out = [];
  const list = db.all('ledger');
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) if (list[i].lines.some((l) => l.account === account)) out.push(shape(list[i]));
  return out;
}

/**
 * Self-check (hourly, leader): the in-memory totals must equal PostgreSQL's sum of every entry.
 * Returns the accounts that differ (normally none) and rebuilds the cache if any do.
 */
export async function verifyAgainstDatabase({ repair = false } = {}) {
  if (!db.usingPostgres()) return [];
  const rows = await db.sql(`select l->>'account' account, sum(coalesce((l->>'dr')::bigint,0) - coalesce((l->>'cr')::bigint,0))::text raw
    from drop_docs d, jsonb_array_elements(d.data->'lines') l where d.collection = 'ledger' and not d.deleted group by 1`);
  const truth = new Map(rows.map((r) => [r.account, Number(r.raw)]));
  const mem = cache();
  const diff = [];
  for (const a of new Set([...truth.keys(), ...mem.keys()])) if ((truth.get(a) || 0) !== (mem.get(a) || 0)) diff.push({ account: a, memory: mem.get(a) || 0, database: truth.get(a) || 0 });
  if (diff.length && repair) {
    // Re-derive the base for entries outside memory from the database truth: base = all − in memory.
    const hot = new Map();
    for (const t of db.all('ledger')) add(hot, t);
    const base = db.ledgerBase();
    base.clear();
    for (const [a, v] of truth) { const b = v - (hot.get(a) || 0); if (b) base.set(a, b); }
    for (const [a, v] of hot) if (!truth.has(a) && v) base.set(a, -v);
  }
  if (diff.length) { balances = null; byKey = null; }
  return diff;
}

/** Trial balance: every account's natural balance, plus a check that the books balance. */
export function trialBalance() {
  const b = cache();
  const accounts = [...b.keys()].sort().map((a) => ({ account: a, balance: balance(a) }));
  const raw = [...b.values()].reduce((s, v) => s + v, 0);
  return { accounts, balanced: raw === 0 };
}

export function resetCacheForTests() { balances = null; byKey = null; }
