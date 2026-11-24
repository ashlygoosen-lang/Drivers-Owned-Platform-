/**
 * Paymentology Remote API host (calls initiated by Paymentology, hosted by DROP).
 *
 * Every card swipe reaches DROP as an XML-RPC call. DROP holds the balance (Companion API model),
 * so each Deduct is approved or declined against the driver's DROP wallet in real time.
 *
 * Implemented: Balance, Deduct, DeductReversal, DeductAdjustment, Stop, AdministrativeMessage.
 * Other Remote methods (loads, installments, ValidatePIN) answer -41 "requested function not supported".
 */
import express from 'express';
import { db, id, now } from '../../db.js';
import { PTY, checksumValid, terminalId, cardsEnabled } from './config.js';
import { parseCall, buildResponse, parseKlv } from './xmlrpc.js';
import { post, walletAccount, walletBalance } from '../ledger.js';

/** Remote API result codes (Paymentology "Response and action code mapping"). */
export const RC = {
  APPROVED: 1, DUPLICATE: -3, INVALID_CARD: -4, NOT_PERMITTED_TERMINAL: -5, DO_NOT_HONOUR: -9, NO_CARD_RECORD: -16,
  INSUFFICIENT_FUNDS: -17, EXCEEDS_LIMIT: -18, INVALID_AMOUNT: -19, SECURITY_VIOLATION: -24, RESTRICTED_CARD: -29,
  CLOSED_ACCOUNT: -34, SUSPECTED_FRAUD: -37, LOST_CARD: -38, STOLEN_CARD: -39, NOT_SUPPORTED: -41, NOT_PERMITTED_CARDHOLDER: -784,
};

const SCHEMAS = {
  Balance: ['terminalID', 'reference', 'narrative', 'transactionData', 'transactionID', 'transactionDate'],
  Deduct: ['terminalID', 'reference', 'requestAmount', 'narrative', 'transactionType', 'transactionData', 'transactionID', 'transactionDate'],
  DeductReversal: ['terminalID', 'reference', 'requestAmount', 'narrative', 'transactionData', 'referenceID', 'referenceDate', 'transactionID', 'transactionDate'],
  DeductAdjustment: ['terminalID', 'reference', 'requestAmount', 'narrative', 'transactionData', 'referenceID', 'referenceDate', 'transactionID', 'transactionDate'],
  Stop: ['terminalID', 'reference', 'voucherNumber', 'stopReason', 'transactionData', 'transactionID', 'transactionDate'],
  AdministrativeMessage: ['terminalID', 'reference', 'messageName', 'messageData', 'transactionID', 'transactionDate'],
};

/** Spending policy (environment-configurable). Amounts in cents. */
export const POLICY = {
  maxTransaction: Math.round(Number(process.env.CARD_MAX_TRANSACTION || 5000) * 100),
  dailyLimit: Math.round(Number(process.env.CARD_DAILY_LIMIT || 10000) * 100),
  allowAtm: (process.env.CARD_ALLOW_ATM || 'true') !== 'false',
  blockedMcc: (process.env.CARD_BLOCKED_MCCS || '7995,7800,7801,7802,9406').split(',').map((s) => s.trim()).filter(Boolean),
};

const FUEL_MCC = new Set(['5541', '5542', '5983', '5172']);
const CATEGORY = (mcc) => FUEL_MCC.has(mcc) ? 'Fuel' : ['7531', '7534', '7535', '7538', '7542', '5532', '5533'].includes(mcc) ? 'Vehicle & repairs'
  : ['4784', '7523'].includes(mcc) ? 'Tolls & parking' : ['5411', '5499', '5812', '5814'].includes(mcc) ? 'Food & groceries' : ['4814', '4812'].includes(mcc) ? 'Airtime & data' : 'Other';

const TYPE_LABEL = { '00': 'Purchase', '01': 'ATM withdrawal', '09': 'Purchase with cashback', '10': 'Account funding', '30': 'Balance enquiry fee' };

function findCard(reference) {
  const card = db.all('cards').filter((c) => c.reference === reference).pop();
  const user = card ? db.find('users', (u) => u.id === card.userId) : db.find('users', (u) => u.walletRef === reference);
  return { card, user };
}

function startOfDay() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); }

function deduct(a) {
  const { card, user } = findCard(a.reference);
  if (!user) return { resultCode: RC.NO_CARD_RECORD };
  if (user.disabled) return { resultCode: RC.CLOSED_ACCOUNT };
  if (!card || card.status === 'retired') return { resultCode: RC.NO_CARD_RECORD };
  if (card.status === 'lost') return { resultCode: RC.LOST_CARD };
  if (card.status === 'stolen') return { resultCode: RC.STOLEN_CARD };
  if (card.status !== 'active') return { resultCode: RC.RESTRICTED_CARD };
  if (user.verificationStatus !== 'verified') return { resultCode: RC.RESTRICTED_CARD };
  const amount = Number(a.requestAmount);
  if (!Number.isInteger(amount) || amount <= 0) return { resultCode: RC.INVALID_AMOUNT };
  const type = String(a.transactionType || '00');
  if (type === '10') return { resultCode: RC.NOT_PERMITTED_CARDHOLDER };
  if (type === '01' && !POLICY.allowAtm) return { resultCode: RC.NOT_PERMITTED_CARDHOLDER };
  const klv = parseKlv(a.transactionData);
  const mcc = klv['026'] || '';
  if (mcc && POLICY.blockedMcc.includes(mcc)) return { resultCode: RC.NOT_PERMITTED_CARDHOLDER };
  if (type !== '30' && amount > POLICY.maxTransaction) return { resultCode: RC.EXCEEDS_LIMIT };
  const since = startOfDay();
  const today = db.filter('cardEvents', (e) => e.userId === user.id && e.method === 'Deduct' && e.approved && e.createdAt >= since).reduce((s, e) => s + e.amount - (e.reversed || 0), 0);
  if (type !== '30' && today + amount > POLICY.dailyLimit) return { resultCode: RC.EXCEEDS_LIMIT };
  const available = walletBalance(user.id);
  if (amount > available) return { resultCode: RC.INSUFFICIENT_FUNDS, balanceAmount: Math.max(0, available) };

  const entry = post({
    type: 'card.purchase', memo: `${TYPE_LABEL[type] || 'Card'} · ${String(a.narrative || '').trim()}`,
    lines: [{ account: walletAccount(user.id), dr: amount }, { account: 'card_settlement', cr: amount }],
    meta: { userId: user.id, cardId: card.id, transactionID: a.transactionID, mcc, category: CATEGORY(mcc), merchant: String(a.narrative || '').trim() },
  });
  return { resultCode: RC.APPROVED, balanceAmount: walletBalance(user.id), actualBalance: walletBalance(user.id), _entry: entry.id, _user: user.id, _card: card.id, _mcc: mcc };
}

function reversal(a) {
  const { user } = findCard(a.reference);
  if (!user) return { resultCode: RC.APPROVED }; // nothing was deducted; acknowledge so it is not retried
  const original = db.filter('cardEvents', (e) => e.method === 'Deduct' && e.approved && e.reference === a.reference && e.transactionID === String(a.referenceID)).pop();
  if (!original) return { resultCode: RC.APPROVED, _note: 'original not found' };
  const remaining = original.amount - (original.reversed || 0);
  const amount = Math.min(Number(a.requestAmount) || 0, remaining);
  if (amount <= 0) return { resultCode: RC.APPROVED };
  post({
    type: 'card.reversal', memo: `Reversal · ${String(a.narrative || original.merchant || '').trim()}`,
    lines: [{ account: 'card_settlement', dr: amount }, { account: walletAccount(user.id), cr: amount }],
    meta: { userId: user.id, cardId: original.cardId, originalTransactionID: original.transactionID },
  });
  db.update('cardEvents', original.id, { reversed: (original.reversed || 0) + amount });
  return { resultCode: RC.APPROVED, balanceAmount: walletBalance(user.id), _user: user.id };
}

function adjustment(a) {
  const { user, card } = findCard(a.reference);
  if (!user) return { resultCode: RC.NO_CARD_RECORD };
  const amount = Number(a.requestAmount);
  if (!Number.isInteger(amount) || amount <= 0) return { resultCode: RC.INVALID_AMOUNT };
  // Adjustments follow a completed purchase (e.g. the settled amount was higher), so they are always booked.
  post({
    type: 'card.adjustment', memo: `Adjustment · ${String(a.narrative || '').trim()}`,
    lines: [{ account: walletAccount(user.id), dr: amount }, { account: 'card_settlement', cr: amount }],
    meta: { userId: user.id, cardId: card?.id, originalTransactionID: String(a.referenceID) },
  });
  return { resultCode: RC.APPROVED, _user: user.id };
}

function stop(a) {
  const { card } = findCard(a.reference);
  if (card) {
    const status = Number(a.stopReason) === 1 ? 'lost' : Number(a.stopReason) === 2 ? 'stolen' : 'stopped';
    db.update('cards', card.id, { status, stopReason: Number(a.stopReason), stoppedAt: now(), stoppedBy: 'Paymentology' });
  }
  return { resultCode: RC.APPROVED };
}

export function handleRemote(xml, ip = '') {
  let call;
  try { call = parseCall(xml); } catch { return { method: 'unknown', response: { resultCode: RC.DO_NOT_HONOUR } }; }
  const { method, params } = call;
  const schema = SCHEMAS[method];
  const values = params.map((p) => p.raw);
  const supplied = values[values.length - 1];
  const signed = values.slice(0, -1);
  const a = {};
  if (schema) schema.forEach((name, i) => { a[name] = params[i]?.type === 'int' || params[i]?.type === 'i4' ? params[i].value : params[i]?.raw; });

  if (!cardsEnabled()) return { method, response: { resultCode: RC.DO_NOT_HONOUR } };
  if (PTY.allowedIps.length && !PTY.allowedIps.includes(ip)) return { method, response: { resultCode: RC.SECURITY_VIOLATION }, rejected: 'ip' };
  if ((schema && a.terminalID !== terminalId()) || !checksumValid(method, signed, supplied)) return { method, response: { resultCode: RC.SECURITY_VIOLATION }, rejected: 'checksum' };
  if (!schema) return { method, response: { resultCode: RC.NOT_SUPPORTED } };

  // Idempotency: an identical retransmission gets the original answer and moves no money.
  const dedupeKey = `${method}|${a.reference}|${a.transactionID}|${a.transactionDate}`;
  const prior = db.find('cardEvents', (e) => e.key === dedupeKey);
  if (prior) return { method, response: prior.response, duplicate: true };

  let result;
  if (method === 'Balance') {
    const { user } = findCard(a.reference);
    result = user ? { resultCode: RC.APPROVED, balanceAmount: Math.max(0, walletBalance(user.id)), actualBalance: walletBalance(user.id) } : { resultCode: RC.NO_CARD_RECORD };
  } else if (method === 'Deduct') result = deduct(a);
  else if (method === 'DeductReversal') result = reversal(a);
  else if (method === 'DeductAdjustment') result = adjustment(a);
  else if (method === 'Stop') result = stop(a);
  else result = { resultCode: RC.APPROVED }; // AdministrativeMessage: acknowledged and logged

  const response = Object.fromEntries(Object.entries(result).filter(([k]) => !k.startsWith('_')));
  const { card, user } = findCard(a.reference);
  const klv = parseKlv(a.transactionData);
  db.insert('cardEvents', {
    id: id(), key: dedupeKey, method, reference: a.reference, userId: user?.id || null, cardId: card?.id || null,
    transactionID: String(a.transactionID || ''), transactionDate: String(a.transactionDate || ''), transactionType: a.transactionType || null,
    amount: Number(a.requestAmount) || 0, merchant: String(a.narrative || '').trim(), mcc: klv['026'] || '', category: CATEGORY(klv['026'] || ''),
    captureMode: klv['250'] || '', approved: method === 'Deduct' ? response.resultCode === RC.APPROVED : null, reversed: 0,
    resultCode: response.resultCode, response, extra: method === 'AdministrativeMessage' ? { messageName: a.messageName } : undefined, ip, createdAt: now(),
  });
  if (method === 'Deduct' && user) {
    const ok = response.resultCode === RC.APPROVED;
    db.insert('notifications', { id: id(), userId: user.id, title: ok ? `Card payment R ${(a.requestAmount / 100).toFixed(2)}` : 'Card payment declined', body: ok ? `${String(a.narrative || '').trim()} · balance R ${(walletBalance(user.id) / 100).toFixed(2)}` : `${String(a.narrative || '').trim()} · ${declineText(response.resultCode)}`, link: 'wallet', read: false, createdAt: now() });
  }
  return { method, response };
}

export function declineText(code) {
  return ({ [-17]: 'insufficient wallet balance', [-18]: 'over your card limit', [-29]: 'card is not active', [-38]: 'card reported lost', [-39]: 'card reported stolen', [-784]: 'this type of purchase is not allowed on the DROP card', [-19]: 'invalid amount', [-34]: 'account closed', [-16]: 'card not found' })[code] || 'declined';
}

/** Express router: POST /api/paymentology/remote  (text/xml). Always answers with XML within the timeout. */
export function remoteRouter() {
  const router = express.Router();
  router.post('/paymentology/remote', express.text({ type: ['text/xml', 'application/xml', 'text/plain'], limit: '64kb' }), (req, res) => {
    let out;
    try { out = handleRemote(typeof req.body === 'string' ? req.body : '', req.ip); }
    catch (err) { console.error('[drop] paymentology remote error', err); out = { response: { resultCode: RC.DO_NOT_HONOUR } }; }
    res.type('text/xml').send(buildResponse(out.response));
  });
  return router;
}
