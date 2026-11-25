import crypto from 'node:crypto';
import { Router } from 'express';
import { db, id, now, settings } from '../db.js';
import { requireAuth, checkPassword, hashPassword, endAllSessions, STAFF_ROLES } from '../auth.js';
import { str, email, password, oneOf, wrap, bad, HttpError } from '../validate.js';
import { assertNotBreached } from './auth.js';
import { audit, removeFile } from '../kyc.js';
import { walletBalance } from '../money/ledger.js';
import { isDemoUser } from '../demoPolicy.js';
import { sendMail, emailLayout } from '../mailer.js';
import { registerDevice, removeDevice, removeUserDevices } from '../push.js';
import { securityEvent } from '../monitor.js';
import { revokeFamily } from '../sessions.js';
import * as kv from '../kv.js';

/**
 * Account lifecycle used by the website and both apps:
 * - forgotten password (single-use, 30-minute, hashed tokens; no account enumeration)
 * - account deletion (required by Google Play and the App Store; POPIA right to erasure)
 * - push-notification devices
 * - app version policy (force update) for the mobile apps
 */
const router = Router();
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const PUBLIC_URL = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

/* ---------- Forgotten password ---------- */

router.post('/auth/password/forgot', wrap(async (req, res) => {
  const addr = email(req.body?.email);
  const generic = { ok: true, message: 'If an account exists for that email, we’ve sent a link to reset the password. It expires in 30 minutes.' };
  // Per-email throttle (3 per hour) on top of the IP limiter, without revealing whether it exists.
  if (await kv.incr(`pwreset:${addr}`, 3600) > 3) return res.json(generic);
  const user = db.find('users', (u) => u.email === addr && !u.disabled && !u.deletedAt);
  if (!user || isDemoUser(user)) return res.json(generic);
  const token = crypto.randomBytes(32).toString('base64url');
  for (const r of db.filter('passwordResets', (x) => x.userId === user.id && !x.usedAt)) db.update('passwordResets', r.id, { usedAt: now() }); // only the newest link works
  db.insert('passwordResets', { id: id(), userId: user.id, hash: sha(token), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), usedAt: null, ip: req.ip, createdAt: now() });
  const url = `${PUBLIC_URL(req)}/reset-password?token=${token}`;
  const r = await sendMail({
    to: user.email,
    subject: 'Reset your DROP password',
    text: `Hi ${user.name.split(' ')[0]},\n\nUse this link to choose a new DROP password. It works once and expires in 30 minutes:\n${url}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.`,
    html: emailLayout('Reset your password', [`Hi ${user.name.split(' ')[0]},`, 'Use the button below to choose a new DROP password. It works once and expires in 30 minutes.', 'If you didn’t ask for this, you can ignore this email. Your password stays the same.'], { url, label: 'Choose a new password' }),
  });
  if (!r.sent && !r.dev) securityEvent('password_reset_email_failed', { user: user.id }, 'medium');
  res.json({ ...generic, ...(r.dev && process.env.NODE_ENV === 'test' && { devToken: token }) });
}));

router.post('/auth/password/reset', wrap(async (req, res) => {
  const token = str(req.body?.token, 'Reset link', { max: 200 });
  const r = db.find('passwordResets', (x) => x.hash === sha(token));
  if (!r || r.usedAt || Date.parse(r.expiresAt) < Date.now()) throw bad('This reset link has expired or was already used. Please request a new one.');
  const user = db.find('users', (u) => u.id === r.userId && !u.disabled && !u.deletedAt);
  if (!user) throw bad('This reset link has expired or was already used. Please request a new one.');
  const pw = password(req.body?.newPassword);
  await assertNotBreached(pw);
  db.update('passwordResets', r.id, { usedAt: now() });
  db.update('users', user.id, { passwordHash: await hashPassword(pw), tokenVersion: (user.tokenVersion || 0) + 1 }); // signs out every device
  for (const s of db.filter('sessions', (x) => x.userId === user.id && !x.revokedAt)) revokeFamily(s.family, 'password_reset');
  audit(user, 'password_reset', user.id, {});
  if (STAFF_ROLES.includes(user.role)) securityEvent('staff_password_reset', { user: user.id }, 'high');
  void sendMail({ to: user.email, subject: 'Your DROP password was changed', text: 'Your DROP password was just changed. If this wasn’t you, contact DROP support immediately.', html: emailLayout('Your password was changed', ['Your DROP password was just changed and you’ve been signed out on all devices.', 'If this wasn’t you, contact DROP support immediately.']) });
  res.json({ ok: true, message: 'Your password has been changed. Please sign in with your new password.' });
}));

/* ---------- Account deletion ---------- */

/**
 * Deleting an account removes or anonymises personal information straight away. Records the law
 * requires DROP to keep (trips and the money ledger for tax; identity verification for FICA/KYC) are
 * kept, unlinked from contact details, until KYC_RETENTION_DAYS (default 5 years) after closure, and
 * then a daily job removes the documents.
 */
router.post('/auth/delete-account', requireAuth, wrap(async (req, res) => {
  const u = req.user;
  if (isDemoUser(u)) throw bad('Demo accounts can’t be deleted.');
  if (STAFF_ROLES.includes(u.role)) throw bad('Staff accounts are closed by a DROP administrator.');
  if (!(await checkPassword(String(req.body?.password || ''), u.passwordHash))) throw bad('Your password is incorrect.');
  if (str(req.body?.confirm, 'Confirmation', { max: 20 }).toUpperCase() !== 'DELETE') throw bad('Type DELETE to confirm.');
  const active = db.find('bookings', (b) => (b.userId === u.id || b.driverId === u.id) && ['awaiting_payment', 'requested', 'accepted', 'arriving', 'in_progress'].includes(b.status));
  if (active) throw bad(`Finish or cancel trip ${active.ref} first.`);
  if (u.role === 'driver') {
    const bal = walletBalance(u.id);
    if (bal > 0) throw bad('Please withdraw your wallet balance before closing your account.');
    if (bal < 0) throw bad('Your wallet owes DROP service fees. Please settle it or contact support before closing your account.');
    for (const c of db.filter('cards', (x) => x.userId === u.id && ['active', 'frozen'].includes(x.status))) db.update('cards', c.id, { status: 'retired', retiredAt: now() });
  }
  const retainUntil = new Date(Date.now() + Number(process.env.KYC_RETENTION_DAYS || 1825) * 86_400_000).toISOString();
  db.update('users', u.id, {
    name: 'Deleted user', email: `deleted+${u.id}@deleted.drop`, phone: '', company: '', savedPlaces: { home: '', work: '' }, employees: u.employees ? [] : undefined,
    passwordHash: '!', mfa: null, mfaPending: null, bankAccount: null, location: null, online: false, disabled: true, deletedAt: now(), tokenVersion: (u.tokenVersion || 0) + 1,
  });
  const v = db.find('verifications', (x) => x.userId === u.id);
  if (v) db.update('verifications', v.id, { closedAt: now(), retainUntil, profile: { ...v.profile, addressLine1: '', addressLine2: '', suburb: '', emergencyName: '', emergencyPhone: '' } });
  for (const m of db.filter('messages', (x) => x.senderId === u.id)) db.update('messages', m.id, { senderName: 'Deleted user' });
  for (const n of db.filter('notifications', (x) => x.userId === u.id)) db.update('notifications', n.id, { body: '' });
  for (const s of db.filter('sessions', (x) => x.userId === u.id && !x.revokedAt)) revokeFamily(s.family, 'account_deleted');
  removeUserDevices(u.id);
  audit(u, 'account_deleted', u.id, { retainUntil });
  res.json({ ok: true, message: 'Your DROP account has been deleted.' });
}));

/** Daily: remove identity documents whose legal retention period has ended. */
export function purgeExpiredKyc() {
  let n = 0;
  for (const v of db.filter('verifications', (x) => x.retainUntil && Date.parse(x.retainUntil) < Date.now() && !x.purgedAt)) {
    for (const d of v.documents || []) removeFile(d.file);
    db.update('verifications', v.id, { documents: [], profile: { legalName: 'Deleted user' }, purgedAt: now() });
    n++;
  }
  return n;
}

/* ---------- Push devices ---------- */

router.post('/devices', requireAuth, wrap(async (req, res) => {
  const token = str(req.body?.token, 'Device token', { max: 200 });
  if (!/^(Exp(o|onent)PushToken\[[\w-]+\]|[\w:-]{20,200})$/.test(token)) throw bad('Invalid device token.');
  registerDevice(req.user.id, { token, platform: oneOf(req.body?.platform, ['ios', 'android'], 'Platform'), app: oneOf(req.body?.app, ['passenger', 'driver'], 'App') });
  res.json({ ok: true });
}));
router.post('/devices/remove', requireAuth, wrap(async (req, res) => { removeDevice(String(req.body?.token || ''), req.user.id); res.json({ ok: true }); }));

/* ---------- App version policy (force update) ---------- */

const cmp = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
router.get('/app/config', (req, res) => {
  const app = req.query.app === 'driver' ? 'driver' : 'passenger';
  const platform = req.query.platform === 'ios' ? 'ios' : 'android';
  const version = String(req.query.version || '0.0.0').slice(0, 20);
  const min = process.env[`MOBILE_MIN_VERSION_${app.toUpperCase()}`] || process.env.MOBILE_MIN_VERSION || '1.0.0';
  const latest = process.env[`MOBILE_LATEST_VERSION_${app.toUpperCase()}`] || process.env.MOBILE_LATEST_VERSION || min;
  const ids = { passenger: { ios: process.env.IOS_APP_ID_PASSENGER, android: 'za.co.drop.passenger' }, driver: { ios: process.env.IOS_APP_ID_DRIVER, android: 'za.co.drop.driver' } };
  const storeUrl = platform === 'android' ? `https://play.google.com/store/apps/details?id=${ids[app].android}` : ids[app].ios ? `https://apps.apple.com/app/id${ids[app].ios}` : 'https://apps.apple.com';
  res.json({ forceUpdate: cmp(version, min) < 0, updateAvailable: cmp(version, latest) < 0, minVersion: min, latestVersion: latest, storeUrl, maintenance: Boolean(settings().maintenance?.on || process.env.MAINTENANCE_MODE === 'on'), supportEmail: process.env.CONTACT_EMAIL || 'hello@drop.co.za' });
});

export default router;
export { HttpError };
