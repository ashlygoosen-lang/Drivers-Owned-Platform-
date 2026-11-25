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
// Entries written by other servers arrive through the store's catch-up: rebuild the totals.
db.onChange('ledger', (_entry, _kind, remote) => { if (remote) balances = null; });
function cache() {
  if (!balances) {
    balances = new Map();
    for (const t of db.all('ledger')) for (const l of t.lines) balances.set(l.account, (balances.get(l.account) || 0) + (l.dr || 0) - (l.cr || 0));
  }
  return balances;
}

/** Natural balance in cents: positive = money held (assets) or owed (liabilities/revenue). */
export function balance(account) {
  const raw = cache().get(account) || 0;
  return isAsset(account) ? raw : -raw;
}

export const walletAccount = (userId) => `wallet:${userId}`;
export const walletBalance = (userId) => balance(walletAccount(userId));

/**
 * Post a balanced entry. lines: [{ account, dr?, cr? }] in cents.
 * `key` makes the post idempotent: posting the same key twice returns the first entry.
 */
export function post({ type, memo, lines, meta = {}, key = null, actor = null }) {
  if (key) {
    const existing = db.find('ledger', (t) => t.key === key);
    if (existing) return existing;
  }
  const clean = lines.filter((l) => (l.dr || 0) !== 0 || (l.cr || 0) !== 0).map((l) => ({ account: l.account, dr: Math.round(l.dr || 0), cr: Math.round(l.cr || 0) }));
  const dr = clean.reduce((s, l) => s + l.dr, 0);
  const cr = clean.reduce((s, l) => s + l.cr, 0);
  if (!clean.length || dr !== cr) throw new HttpError(500, `Unbalanced ledger entry (${type}): ${dr} ≠ ${cr}`);
  if (clean.some((l) => l.dr < 0 || l.cr < 0)) throw new HttpError(500, `Negative ledger line (${type}).`);
  const b = cache(); // build totals before inserting so the new entry is counted exactly once
  const entry = { id: id(), key, type, memo, lines: clean, meta, actor, createdAt: now() };
  db.insert('ledger', entry);
  for (const l of clean) b.set(l.account, (b.get(l.account) || 0) + l.dr - l.cr);
  return entry;
}

/** Entries touching an account, newest first, with the signed effect on that account. */
export function statement(account, limit = 200) {
  const out = [];
  const list = db.all('ledger');
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const t = list[i];
    const lines = t.lines.filter((l) => l.account === account);
    if (!lines.length) continue;
    const raw = lines.reduce((s, l) => s + l.dr - l.cr, 0);
    out.push({ id: t.id, type: t.type, memo: t.memo, meta: t.meta, createdAt: t.createdAt, amount: isAsset(account) ? raw : -raw });
  }
  return out;
}

/** Trial balance: every account's natural balance, plus a check that the books balance. */
export function trialBalance() {
  const b = cache();
  const accounts = [...b.keys()].sort().map((a) => ({ account: a, balance: balance(a) }));
  const raw = [...b.values()].reduce((s, v) => s + v, 0);
  return { accounts, balanced: raw === 0 };
}

export function resetCacheForTests() { balances = null; }
