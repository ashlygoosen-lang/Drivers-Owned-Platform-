import { Router } from 'express';
import express from 'express';
import { db, id, now, nextRef } from '../db.js';
import { requireAuth, requireRole, checkPassword } from '../auth.js';
import { isDemoUser } from '../demoPolicy.js';

// SEC-006: changing the payout bank account needs the password, and withdrawals to a changed account
// wait BANK_CHANGE_HOLD_HOURS, so a stolen session can't redirect a driver's earnings straight away.
const BANK_HOLD_H = () => Number(process.env.BANK_CHANGE_HOLD_HOURS ?? 24);
import { COMPANY } from '../config.js';
import { encryptText, decryptText, getVerification, recompute, audit, revealIdNumber } from '../kyc.js';
import { post, cents, rands, balance, walletAccount, walletBalance, statement, trialBalance } from '../money/ledger.js';
import { recordCardPayment, recordRefund } from '../money/settlement.js';
import * as paystack from '../money/paystack.js';
import { PTY, cardsEnabled, isSandbox, checksum, terminalId } from '../money/paymentology/config.js';
import * as pty from '../money/paymentology/client.js';
import { handleRemote, POLICY, declineText } from '../money/paymentology/remote.js';
import { buildCall, buildKlv, xmlDate } from '../money/paymentology/xmlrpc.js';
import { str, int, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();
const finance = requireRole('admin', 'finance');
const driverOnly = requireRole('driver');

export const WITHDRAWAL = {
  min: cents(process.env.WITHDRAWAL_MIN || 50),
  fee: cents(process.env.WITHDRAWAL_FEE || 0),
  cashDebtLimit: cents(process.env.CASH_DEBT_LIMIT || 300),
};
const PUBLIC_URL = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');
export const BANKS = ['ABSA', 'Capitec', 'Discovery Bank', 'FNB', 'Investec', 'Nedbank', 'Standard Bank', 'TymeBank', 'African Bank', 'Bank Zero', 'Other'];

/* ---------------- Passenger payments (Paystack) ---------------- */
router.get('/payments/config', (_req, res) => res.json({ card: paystack.paystackEnabled(), mode: paystack.paystackMode() }));

async function markPaid(booking, tx) {
  if (booking.paymentStatus === 'paid') return booking;
  const amount = Number(tx.amount);
  if (tx.status !== 'success') throw bad('This payment was not successful.');
  if (amount !== cents(booking.fare) || String(tx.currency).toUpperCase() !== 'ZAR') throw bad('The payment amount does not match this booking. Please contact support.');
  recordCardPayment(booking, { reference: tx.reference, amountCents: amount, provider: 'Paystack' });
  db.insert('payments', { id: id(), bookingId: booking.id, userId: booking.userId, provider: 'Paystack', reference: tx.reference, amount, status: 'paid', channel: tx.channel, cardLast4: tx.authorization?.last4 || '', paidAt: tx.paid_at || now(), createdAt: now() });
  return db.update('bookings', booking.id, { paymentStatus: 'paid', paymentReference: tx.reference, status: booking.status === 'awaiting_payment' ? 'requested' : booking.status, history: [...booking.history, { status: 'requested', at: now(), note: 'Paid by card' }] });
}

router.post('/payments/bookings/:id/checkout', requireAuth, wrap(async (req, res) => {
  if (!paystack.paystackEnabled()) throw bad('Card payments are not available yet. Please choose cash.');
  const booking = db.find('bookings', (b) => b.id === req.params.id && b.userId === req.user.id);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  if (booking.paymentStatus === 'paid') throw bad('This booking is already paid.');
  if (booking.status !== 'awaiting_payment') throw bad('This booking does not need a card payment.');
  const reference = `${booking.ref}-${Date.now().toString(36)}`;
  const tx = await paystack.initialize({
    email: req.user.email, amountCents: cents(booking.fare), reference,
    callbackUrl: `${PUBLIC_URL() || `${req.protocol}://${req.get('host')}`}/?payment_ref=${encodeURIComponent(reference)}`,
    metadata: { bookingId: booking.id, bookingRef: booking.ref, userId: req.user.id },
  });
  db.update('bookings', booking.id, { pendingPaymentReference: reference });
  res.json({ authorizationUrl: tx.authorization_url, reference });
}));

router.get('/payments/verify/:reference', requireAuth, wrap(async (req, res) => {
  const ref = String(req.params.reference);
  const booking = db.find('bookings', (b) => (b.pendingPaymentReference === ref || b.paymentReference === ref) && b.userId === req.user.id);
  if (!booking) throw new HttpError(404, 'Payment not found.');
  if (booking.paymentStatus === 'paid') return res.json({ booking, paid: true });
  const tx = await paystack.verify(ref);
  const updated = await markPaid(booking, tx);
  res.json({ booking: updated, paid: true });
}));

/** Paystack webhook. Needs the raw body to check the signature, so it is mounted before express.json(). */
export function paystackWebhook() {
  const r = Router();
  r.post('/payments/paystack/webhook', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
    if (!paystack.webhookValid(raw, req.get('x-paystack-signature'))) return res.status(401).end();
    res.sendStatus(200); // acknowledge fast; process below
    try {
      const event = JSON.parse(raw.toString('utf8'));
      if (event.event !== 'charge.success') return;
      const ref = event.data?.reference;
      const booking = db.find('bookings', (b) => b.pendingPaymentReference === ref || b.paymentReference === ref);
      if (booking) await markPaid(booking, event.data);
    } catch (err) { console.error('[drop] paystack webhook', err.message); }
  });
  return r;
}

/** Refund a paid booking that was cancelled before the trip. Called from the cancel route. */
export async function refundBooking(booking) {
  if (booking.paymentStatus !== 'paid') return booking;
  try {
    await paystack.refund(booking.paymentReference);
    recordRefund(booking, { reference: booking.paymentReference, amountCents: cents(booking.fare) });
    return db.update('bookings', booking.id, { paymentStatus: 'refunded', refundedAt: now() });
  } catch (err) {
    console.error('[drop] refund failed', err.message);
    return db.update('bookings', booking.id, { paymentStatus: 'refund_pending' });
  }
}

/* ---------------- Driver wallet ---------------- */
function walletRef(user) {
  if (user.walletRef) return user.walletRef;
  db.get().counters.wallet = (db.get().counters.wallet || 0) + 1;
  const ref = `7${String(db.get().counters.wallet).padStart(10, '0')}`; // 11-digit wallet reference shared with Paymentology
  db.update('users', user.id, { walletRef: ref });
  return ref;
}
const maskAcc = (n) => (n ? `•••• ${String(n).slice(-4)}` : '');
const publicCard = (c) => c && ({ id: c.id, programme: c.programme, maskedNumber: c.maskedNumber, validDate: c.validDate, status: c.status, type: c.type, issuedAt: c.issuedAt, sandbox: c.sandbox, stopReason: c.stopReason || null });

router.get('/wallet', driverOnly, (req, res) => {
  const u = db.find('users', (x) => x.id === req.user.id);
  const card = db.all('cards').filter((c) => c.userId === u.id && c.status !== 'retired').pop();
  const spendToday = db.filter('cardEvents', (e) => e.userId === u.id && e.method === 'Deduct' && e.approved && e.createdAt >= new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()).reduce((s, e) => s + e.amount - (e.reversed || 0), 0);
  const tx = statement(walletAccount(u.id), 100).map((t) => ({ ...t, amount: rands(t.amount) }));
  const declined = db.filter('cardEvents', (e) => e.userId === u.id && e.method === 'Deduct' && e.approved === false).slice(-10).reverse()
    .map((e) => ({ id: e.id, merchant: e.merchant, amount: rands(e.amount), reason: declineText(e.resultCode), createdAt: e.createdAt }));
  res.json({
    balance: rands(walletBalance(u.id)),
    pendingWithdrawals: rands(db.filter('withdrawals', (w) => w.userId === u.id && w.status === 'requested').reduce((s, w) => s + w.amount, 0)),
    transactions: tx,
    declined,
    card: publicCard(card),
    cardProgramme: { enabled: cardsEnabled(), sandbox: isSandbox(), name: PTY.programme, limits: { perTransaction: rands(POLICY.maxTransaction), daily: rands(POLICY.dailyLimit), spentToday: rands(spendToday), atm: POLICY.allowAtm } },
    bankAccount: u.bankAccount ? { holder: u.bankAccount.holder, bank: u.bankAccount.bank, branchCode: u.bankAccount.branchCode, accountType: u.bankAccount.accountType, masked: u.bankAccount.masked, holdUntil: u.bankAccount.holdUntil || null } : null,
    withdrawals: db.filter('withdrawals', (w) => w.userId === u.id).slice(-20).reverse().map(({ accountEnc, ...w }) => ({ ...w, amount: rands(w.amount), fee: rands(w.fee) })),
    rules: { minWithdrawal: rands(WITHDRAWAL.min), withdrawalFee: rands(WITHDRAWAL.fee), cashDebtLimit: rands(WITHDRAWAL.cashDebtLimit) },
    banks: BANKS,
  });
});

router.put('/wallet/bank-account', driverOnly, wrap(async (req, res) => {
  const b = req.body || {};
  if (!isDemoUser(req.user) && !(await checkPassword(String(b.currentPassword || ''), req.user.passwordHash))) throw bad('Enter your DROP password to change your bank account.');
  const previous = db.find('users', (x) => x.id === req.user.id).bankAccount;
  const accountNumber = String(b.accountNumber || '').replace(/\s/g, '');
  if (!/^\d{6,16}$/.test(accountNumber)) throw bad('Account numbers contain 6 to 16 digits.');
  const branchCode = String(b.branchCode || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(branchCode)) throw bad('Branch codes have 6 digits (use your bank’s universal branch code).');
  const holder = str(b.holder, 'Account holder name', { min: 3, max: 100 });
  const v = getVerification(req.user.id); recompute(v);
  const legal = (v.profile?.legalName || '').toLowerCase().replace(/[^a-z]/g, '');
  const holderKey = holder.toLowerCase().replace(/[^a-z]/g, '');
  const bankAccount = { holder, bank: oneOf(b.bank, BANKS, 'Bank'), branchCode, accountType: oneOf(b.accountType || 'Cheque', ['Cheque', 'Savings', 'Transmission'], 'Account type'), accountEnc: encryptText(accountNumber), masked: maskAcc(accountNumber), nameMatchesId: Boolean(legal && legal.slice(-6) && holderKey.includes(legal.slice(-6))), updatedAt: now(), holdUntil: previous && !isDemoUser(req.user) ? new Date(Date.now() + BANK_HOLD_H() * 3_600_000).toISOString() : null };
  audit(req.user, previous ? 'bank_account_changed' : 'bank_account_added', req.user.id, { bank: bankAccount.bank, account: bankAccount.masked });
  db.update('users', req.user.id, { bankAccount });
  db.insert('notifications', { id: id(), userId: req.user.id, title: 'Bank account updated', body: `Withdrawals will now go to ${bankAccount.bank} ${bankAccount.masked}. If this wasn’t you, contact support immediately.`, link: 'wallet', read: false, createdAt: now() });
  res.json({ bankAccount: { holder, bank: bankAccount.bank, branchCode, accountType: bankAccount.accountType, masked: bankAccount.masked, holdUntil: bankAccount.holdUntil } });
}));

router.post('/wallet/withdrawals', driverOnly, wrap(async (req, res) => {
  const u = db.find('users', (x) => x.id === req.user.id);
  if (u.verificationStatus !== 'verified') throw bad('Your account must be verified before you can withdraw.');
  if (!u.bankAccount) throw bad('Add your bank account first.');
  if (u.bankAccount.holdUntil && Date.parse(u.bankAccount.holdUntil) > Date.now()) throw bad(`For your security, withdrawals to a newly changed bank account start ${new Date(u.bankAccount.holdUntil).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`);
  const amount = cents(req.body?.amount);
  if (!Number.isFinite(amount) || amount < WITHDRAWAL.min) throw bad(`The minimum withdrawal is R ${rands(WITHDRAWAL.min)}.`);
  const total = amount + WITHDRAWAL.fee;
  if (total > walletBalance(u.id)) throw bad(`You can withdraw up to R ${rands(Math.max(0, walletBalance(u.id) - WITHDRAWAL.fee)).toFixed(2)}.`);
  if (db.find('withdrawals', (w) => w.userId === u.id && w.status === 'requested' && Date.now() - Date.parse(w.createdAt) < 60_000)) throw bad('Please wait a minute before requesting another withdrawal.');
  const w = db.insert('withdrawals', {
    id: id(), ref: nextRef('withdrawal', 'WDR'), userId: u.id, amount, fee: WITHDRAWAL.fee, status: 'requested',
    bank: u.bankAccount.bank, branchCode: u.bankAccount.branchCode, accountType: u.bankAccount.accountType, holder: u.bankAccount.holder, masked: u.bankAccount.masked, accountEnc: u.bankAccount.accountEnc,
    createdAt: now(),
  });
  post({ type: 'withdrawal.requested', key: `wdr:${w.id}`, memo: `Withdrawal ${w.ref} to ${w.bank} ${w.masked}`, meta: { userId: u.id, withdrawalId: w.id },
    lines: [{ account: walletAccount(u.id), dr: total }, { account: 'payouts_pending', cr: amount }, { account: 'fees', cr: WITHDRAWAL.fee }] });
  const { accountEnc, ...safe } = w;
  res.status(201).json({ withdrawal: { ...safe, amount: rands(amount), fee: rands(w.fee) }, balance: rands(walletBalance(u.id)) });
}));

/* ---------------- Driver card (Paymentology) ---------------- */
function myCard(userId) {
  const card = db.all('cards').filter((c) => c.userId === userId && c.status !== 'retired').pop();
  if (!card) throw new HttpError(404, 'You do not have a DROP card yet.');
  return card;
}

router.post('/wallet/card', driverOnly, wrap(async (req, res) => {
  if (!cardsEnabled()) throw bad('The DROP card programme is not live yet.');
  const u = db.find('users', (x) => x.id === req.user.id);
  if (u.verificationStatus !== 'verified') throw bad('Complete your verification before ordering a DROP card.');
  if (db.find('cards', (c) => c.userId === u.id && ['active', 'frozen', 'stopped'].includes(c.status))) throw bad('You already have a DROP card.');
  const v = getVerification(u.id);
  const [firstName, ...rest] = (v.profile.legalName || u.name).split(' ');
  const reference = walletRef(u);
  const r = await pty.createLinkedCard({ reference, firstName, lastName: rest.join(' ') || firstName, idOrPassport: revealIdNumber(v.profile), cellphone: u.phone });
  if (r.resultCode !== 1) throw new HttpError(502, `The card could not be issued (${r.resultText || r.resultCode}).`);
  const card = db.insert('cards', {
    id: id(), userId: u.id, reference, type: 'virtual', programme: PTY.programme, maskedNumber: r.cardNumber, validDate: r.validDate,
    cardIdentifier: r.trackingNumber || r.cardNumber, trackingNumber: r.trackingNumber || '', status: 'active', sandbox: isSandbox(), issuedAt: now(),
  });
  db.insert('notifications', { id: id(), userId: u.id, title: 'Your DROP card is ready', body: `Card ${r.cardNumber} is active. It spends from your DROP wallet.`, link: 'wallet', read: false, createdAt: now() });
  res.status(201).json({ card: publicCard(card) });
}));

router.post('/wallet/card/:action', driverOnly, wrap(async (req, res) => {
  const action = oneOf(req.params.action, ['freeze', 'unfreeze', 'report'], 'Action');
  const card = myCard(req.user.id);
  if (action === 'freeze') {
    if (card.status !== 'active') throw bad('Only an active card can be frozen.');
    const r = await pty.stopCard({ reference: card.reference, cardIdentifier: card.cardIdentifier, reasonID: 3, note: 'Frozen by cardholder' });
    if (r.resultCode !== 1) throw new HttpError(502, r.resultText || 'Could not freeze the card.');
    return res.json({ card: publicCard(db.update('cards', card.id, { status: 'frozen', stopReason: 3 })) });
  }
  if (action === 'unfreeze') {
    if (card.status !== 'frozen') throw bad('This card is not frozen.');
    const r = await pty.unstopCard({ reference: card.reference, cardIdentifier: card.cardIdentifier, note: 'Unfrozen by cardholder' });
    if (r.resultCode !== 1) throw new HttpError(502, r.resultText || 'Could not unfreeze the card.');
    return res.json({ card: publicCard(db.update('cards', card.id, { status: 'active', stopReason: null })) });
  }
  const reason = oneOf(req.body?.reason, ['lost', 'stolen', 'fraud'], 'Reason');
  const reasonID = { lost: 1, stolen: 2, fraud: 7 }[reason];
  const r = await pty.stopCard({ reference: card.reference, cardIdentifier: card.cardIdentifier, reasonID, note: `Reported ${reason} by cardholder` });
  if (r.resultCode !== 1 && !/not allowed/i.test(r.resultText || '')) throw new HttpError(502, r.resultText || 'Could not stop the card.');
  db.update('cards', card.id, { status: 'retired', stopReason: reasonID, stoppedAt: now() });
  db.insert('tickets', { id: id(), ref: nextRef('ticket', 'SUP'), userId: req.user.id, role: 'driver', type: 'Account', priority: reason === 'fraud' ? 'urgent' : 'normal', bookingRef: '', message: `DROP card ${card.maskedNumber} reported ${reason}. Card stopped permanently; replacement requested.`, status: 'open', replies: [], createdAt: now() });
  res.json({ card: null, message: 'Your card has been stopped permanently. You can order a replacement now.' });
}));

/* ---------------- Finance ---------------- */
router.get('/finance/overview', finance, (_req, res) => {
  const tb = trialBalance();
  const wallets = tb.accounts.filter((a) => a.account.startsWith('wallet:'));
  const since = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const spend = db.filter('cardEvents', (e) => e.method === 'Deduct' && e.approved && e.createdAt >= since);
  res.json({
    balanced: tb.balanced,
    pool: rands(balance('pool')),
    escrow: rands(balance('escrow')),
    driverWallets: rands(wallets.reduce((s, a) => s + a.balance, 0)),
    driversInDebt: wallets.filter((a) => a.balance < 0).length,
    fees: rands(balance('fees')),
    cardSettlement: rands(balance('card_settlement')),
    payoutsPending: rands(balance('payouts_pending')),
    businessReceivable: rands(balance('receivable:business')),
    cardSpendToday: rands(spend.reduce((s, e) => s + e.amount - (e.reversed || 0), 0)),
    cardTransactionsToday: spend.length,
    activeCards: db.filter('cards', (c) => c.status === 'active').length,
    withdrawalsRequested: db.filter('withdrawals', (w) => w.status === 'requested').length,
    providers: { paystack: paystack.paystackMode(), paymentology: PTY.mode, cardsEnabled: cardsEnabled() },
    accounts: tb.accounts.filter((a) => !a.account.startsWith('wallet:')).map((a) => ({ ...a, balance: rands(a.balance) })),
  });
});

router.get('/finance/withdrawals', finance, (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const names = Object.fromEntries(db.all('users').map((u) => [u.id, u.name]));
  res.json({ withdrawals: db.filter('withdrawals', (w) => !status || w.status === status).slice().reverse().map(({ accountEnc, ...w }) => ({ ...w, driver: names[w.userId], amount: rands(w.amount), fee: rands(w.fee) })) });
});

/** Bank payment file for requested withdrawals (contains full account numbers: finance only, audited). */
router.get('/finance/withdrawals.csv', finance, (req, res) => {
  const rows = db.filter('withdrawals', (w) => w.status === 'requested');
  audit(req.user, 'finance.payment_file_exported', 'withdrawals', { count: rows.length });
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['Reference', 'Account holder', 'Bank', 'Branch code', 'Account type', 'Account number', 'Amount (ZAR)', 'Beneficiary reference'].map(esc).join(',')];
  for (const w of rows) lines.push([w.ref, w.holder, w.bank, w.branchCode, w.accountType, decryptText(w.accountEnc), rands(w.amount).toFixed(2), `DROP ${w.ref}`].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="drop-payouts-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(lines.join('\n'));
});

router.post('/finance/withdrawals/:id/:action', finance, wrap(async (req, res) => {
  const w = db.find('withdrawals', (x) => x.id === req.params.id);
  if (!w) throw new HttpError(404, 'Withdrawal not found.');
  if (w.status !== 'requested') throw bad(`This withdrawal is already ${w.status}.`);
  const action = oneOf(req.params.action, ['paid', 'reject'], 'Action');
  if (action === 'paid') {
    const bankReference = str(req.body?.bankReference, 'Bank payment reference', { min: 3, max: 60 });
    post({ type: 'withdrawal.paid', key: `wdr-paid:${w.id}`, memo: `Withdrawal ${w.ref} paid · ${bankReference}`, meta: { userId: w.userId, withdrawalId: w.id, bankReference }, actor: req.user.email,
      lines: [{ account: 'payouts_pending', dr: w.amount }, { account: 'pool', cr: w.amount }] });
    db.update('withdrawals', w.id, { status: 'paid', bankReference, paidAt: now(), processedBy: req.user.name });
    db.insert('notifications', { id: id(), userId: w.userId, title: 'Withdrawal paid', body: `R ${rands(w.amount).toFixed(2)} was sent to ${w.bank} ${w.masked}. Reference ${bankReference}.`, link: 'wallet', read: false, createdAt: now() });
  } else {
    const reason = str(req.body?.reason, 'Reason', { min: 5, max: 200 });
    post({ type: 'withdrawal.rejected', key: `wdr-rej:${w.id}`, memo: `Withdrawal ${w.ref} returned to wallet`, meta: { userId: w.userId, withdrawalId: w.id }, actor: req.user.email,
      lines: [{ account: 'payouts_pending', dr: w.amount }, { account: 'fees', dr: w.fee }, { account: walletAccount(w.userId), cr: w.amount + w.fee }] });
    db.update('withdrawals', w.id, { status: 'rejected', reason, processedBy: req.user.name, processedAt: now() });
    db.insert('notifications', { id: id(), userId: w.userId, title: 'Withdrawal returned to your wallet', body: reason, link: 'wallet', read: false, createdAt: now() });
  }
  audit(req.user, `finance.withdrawal_${action}`, w.userId, { ref: w.ref, amount: rands(w.amount) });
  res.json({ ok: true });
}));

router.get('/finance/ledger', finance, (req, res) => {
  const account = req.query.account ? String(req.query.account) : 'pool';
  res.json({ account, balance: rands(balance(account)), entries: statement(account, 300).map((e) => ({ ...e, amount: rands(e.amount) })) });
});

router.get('/finance/journal.csv', finance, (req, res) => {
  audit(req.user, 'finance.journal_exported', 'ledger');
  const lines = ['Date,Entry,Type,Memo,Account,Debit,Credit'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const t of db.all('ledger')) for (const l of t.lines) lines.push([t.createdAt, t.id, t.type, t.memo, l.account, (l.dr / 100).toFixed(2), (l.cr / 100).toFixed(2)].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="drop-journal-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

router.get('/finance/cards', finance, (_req, res) => {
  const names = Object.fromEntries(db.all('users').map((u) => [u.id, u.name]));
  res.json({ cards: db.all('cards').slice().reverse().map((c) => ({ ...publicCard(c), driver: names[c.userId], userId: c.userId, balance: rands(walletBalance(c.userId)) })) });
});

router.get('/finance/card-transactions', finance, (_req, res) => {
  const names = Object.fromEntries(db.all('users').map((u) => [u.id, u.name]));
  res.json({ events: db.filter('cardEvents', (e) => e.method !== 'Balance').slice(-300).reverse().map((e) => ({ id: e.id, method: e.method, driver: names[e.userId] || '—', merchant: e.merchant, category: e.category, mcc: e.mcc, amount: rands(e.amount), reversed: rands(e.reversed || 0), resultCode: e.resultCode, approved: e.approved, reason: e.approved === false ? declineText(e.resultCode) : '', createdAt: e.createdAt })) });
});

router.post('/finance/cards/:id/stop', finance, wrap(async (req, res) => {
  const card = db.find('cards', (c) => c.id === req.params.id);
  if (!card) throw new HttpError(404, 'Card not found.');
  const r = await pty.stopCard({ reference: card.reference, cardIdentifier: card.cardIdentifier, reasonID: 7, note: str(req.body?.note, 'Note', { optional: true, max: 200 }) || 'Stopped by DROP finance' });
  if (r.resultCode !== 1 && !/not allowed/i.test(r.resultText || '')) throw new HttpError(502, r.resultText || 'Could not stop the card.');
  db.update('cards', card.id, { status: 'stopped', stopReason: 7, stoppedAt: now(), stoppedBy: req.user.name });
  audit(req.user, 'finance.card_stopped', card.userId, { card: card.maskedNumber });
  res.json({ ok: true });
}));

/** Reconciliation: record money that actually moved in the bank. */
router.post('/finance/reconcile', finance, wrap(async (req, res) => {
  const kind = oneOf(req.body?.kind, ['card_settlement_paid', 'business_payment_received'], 'Type');
  const amount = cents(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw bad('Enter a positive amount.');
  const reference = str(req.body?.reference, 'Bank reference', { min: 3, max: 80 });
  const lines = kind === 'card_settlement_paid'
    ? [{ account: 'card_settlement', dr: amount }, { account: 'pool', cr: amount }]
    : [{ account: 'pool', dr: amount }, { account: 'receivable:business', cr: amount }];
  const entry = post({ type: `reconcile.${kind}`, key: `recon:${kind}:${reference}`, memo: `${kind === 'card_settlement_paid' ? 'Card scheme settlement paid' : 'Business account payment received'} · ${reference}`, lines, meta: { reference }, actor: req.user.email });
  audit(req.user, `finance.${kind}`, 'ledger', { amount: rands(amount), reference });
  res.json({ entry });
}));

/** Sandbox only: send a correctly signed Remote API call through the real handler, as Paymentology would. */
router.post('/finance/simulate-card', finance, wrap(async (req, res) => {
  if (!isSandbox()) throw new HttpError(403, 'The card simulator is only available in sandbox mode.');
  const card = db.find('cards', (c) => c.id === req.body?.cardId);
  if (!card) throw new HttpError(404, 'Card not found.');
  const method = oneOf(req.body?.method || 'Deduct', ['Deduct', 'DeductReversal', 'Balance'], 'Method');
  const amount = int(Math.round(Number(req.body?.amount || 0) * 100), 'Amount', { min: 0, max: 10_000_000 });
  const merchant = str(req.body?.merchant, 'Merchant', { optional: true, max: 40 }) || 'ENGEN CAPE TOWN CBD      ZA';
  const mcc = /^\d{4}$/.test(String(req.body?.mcc)) ? String(req.body.mcc) : '5541';
  const tId = String(req.body?.transactionID || Date.now() % 1_000_000);
  const date = xmlDate();
  const klv = buildKlv({ '026': mcc, '250': 'EMV', '049': '710' });
  let params;
  if (method === 'Deduct') params = [terminalId(), card.reference, amount, merchant, '00', klv, tId, date];
  else if (method === 'DeductReversal') params = [terminalId(), card.reference, amount, merchant, '', String(req.body?.referenceID || ''), date, tId, date];
  else params = [terminalId(), card.reference, merchant, klv, tId, date];
  const typed = params.map((v) => (typeof v === 'number' ? { type: 'int', value: v } : { type: v === date ? 'dateTime.iso8601' : 'string', value: v }));
  const xml = buildCall(method, [...typed, { type: 'string', value: checksum(method, params) }]);
  const out = handleRemote(xml, req.ip);
  res.json({ request: xml, response: out.response, explanation: out.response.resultCode === 1 ? 'Approved' : declineText(out.response.resultCode) });
}));

export default router;
