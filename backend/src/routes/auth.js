import { Router } from 'express';
import { db, id, now } from '../db.js';
import QRCode from 'qrcode';
import { hashPassword, checkPassword, signToken, signStepToken, readStepToken, endAllSessions, publicUser, requireAuth, STAFF_ROLES } from '../auth.js';
import { loginLocked, loginFailed, loginSucceeded, passwordBreachCount, newTotpSecret, verifyTotp, otpauthUrl, recoveryCodes, hashCode } from '../security.js';
import { encryptText, decryptText, audit } from '../kyc.js';
import { str, email, phone, password, oneOf, wrap, bad, HttpError } from '../validate.js';
import { demoEnabled, DEMO_ACCOUNTS, isDemoUser, seedDemoTrip, demoRoleAllowed } from '../demo.js';

const router = Router();

/** Refuse passwords that appear in known data breaches (SEC-004). */
export async function assertNotBreached(pw) {
  const n = await passwordBreachCount(pw);
  if (n > 0) throw bad(`This password has appeared in ${n > 1000 ? 'thousands of' : 'known'} data breaches, so attackers try it first. Please choose a different one.`);
}

const staffMfaRequired = (u) => STAFF_ROLES.includes(u.role) && !isDemoUser(u) && String(process.env.STAFF_MFA || 'required').toLowerCase() !== 'off';
const DUMMY_HASH = await hashPassword(id()); // equalises login timing for unknown emails

export async function createUser({ name, emailAddress, mobile, pw, role, company }) {
  if (db.find('users', (u) => u.email === emailAddress)) {
    throw new HttpError(409, 'An account with this email already exists. Please sign in instead.');
  }
  await assertNotBreached(pw);
  return db.insert('users', {
    id: id(),
    name,
    email: emailAddress,
    phone: mobile,
    role,
    company: company || '',
    passwordHash: await hashPassword(pw),
    driverStatus: role === 'driver' ? 'pending' : undefined,
    online: false,
    savedPlaces: { home: '', work: '' },
    paymentPreference: 'Card',
    notifications: 'Email',
    employees: role === 'business' ? [] : undefined,
    createdAt: now(),
  });
}

// Self-service sign-up: passengers and business accounts. Drivers register via /api/drivers/apply.
router.post('/register', wrap(async (req, res) => {
  const role = oneOf(req.body.role || 'passenger', ['passenger', 'business'], 'Account type');
  const user = await createUser({
    name: str(req.body.name, 'Full name', { min: 2, max: 80 }),
    emailAddress: email(req.body.email),
    mobile: phone(req.body.phone, 'Mobile number', true),
    pw: password(req.body.password),
    role,
    company: role === 'business' ? str(req.body.company, 'Company name', { min: 2, max: 120 }) : '',
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', wrap(async (req, res) => {
  const emailAddress = email(req.body.email);
  const pw = typeof req.body.password === 'string' ? req.body.password : '';
  if (!pw) throw bad('Password is required.');
  const key = `login:${emailAddress}`;
  const locked = loginLocked(key);
  if (locked) throw new HttpError(429, `Too many sign-in attempts. Please try again in ${locked} minute${locked > 1 ? 's' : ''}.`);
  const user = db.find('users', (u) => u.email === emailAddress);
  if (user && isDemoUser(user)) throw new HttpError(401, 'Demo accounts open with the demo buttons, not a password.');
  const ok = await checkPassword(pw, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) {
    loginFailed(key);
    throw new HttpError(401, 'That email and password combination is not recognised.');
  }
  if (user.disabled) throw new HttpError(403, 'This account has been suspended. Please contact support.');
  loginSucceeded(key);
  // Second step: required for staff, optional (if switched on) for everyone else.
  if (user.mfa?.enabledAt) return res.json({ mfa: 'verify', mfaToken: signStepToken(user, 'mfa') });
  if (staffMfaRequired(user)) return res.json({ mfa: 'setup', mfaToken: signStepToken(user, 'mfa') });
  db.update('users', user.id, { lastLoginAt: now() });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

/* ---------- Two-step sign-in (authenticator app) ---------- */

/** The user from a pending MFA step token, or the signed-in user. */
function mfaSubject(req) {
  if (req.body?.mfaToken) {
    const u = readStepToken(req.body.mfaToken, 'mfa');
    if (!u) throw new HttpError(401, 'Your sign-in step has expired. Please sign in again.');
    return { user: u, step: true };
  }
  const header = req.get('authorization') || '';
  if (!header) throw new HttpError(401, 'Please sign in to continue.');
  return null;
}

function checkCode(user, { code, recoveryCode }) {
  const key = `mfa:${user.id}`;
  const locked = loginLocked(key);
  if (locked) throw new HttpError(429, `Too many incorrect codes. Please try again in ${locked} minute${locked > 1 ? 's' : ''}.`);
  if (recoveryCode) {
    const h = hashCode(recoveryCode);
    const codes = user.mfa?.recovery || [];
    if (!codes.includes(h)) { loginFailed(key); throw bad('That recovery code is not valid.'); }
    db.update('users', user.id, { mfa: { ...user.mfa, recovery: codes.filter((c) => c !== h) } });
    loginSucceeded(key);
    return 'recovery';
  }
  const secret = user.mfa?.secretEnc ? decryptText(user.mfa.secretEnc) : null;
  const step = secret && verifyTotp(secret, code, user.mfa.lastStep ?? -1);
  if (step == null) { loginFailed(key); throw bad('That code is not correct. Check the time on your phone and try the newest code.'); }
  db.update('users', user.id, { mfa: { ...user.mfa, lastStep: step } });
  loginSucceeded(key);
  return 'totp';
}

async function startSetup(user, res) {
  const secret = newTotpSecret();
  db.update('users', user.id, { mfaPending: { secretEnc: encryptText(secret), at: now() } });
  const url = otpauthUrl(secret, user.email);
  res.json({ secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#071B3A', light: '#FFFFFF' } }) });
}

async function finishSetup(user, code) {
  const secret = user.mfaPending?.secretEnc ? decryptText(user.mfaPending.secretEnc) : null;
  if (!secret) throw bad('Start the set-up again to get a new code.');
  const step = verifyTotp(secret, code);
  if (step == null) throw bad('That code is not correct. Check the time on your phone and try the newest code.');
  const codes = recoveryCodes();
  db.update('users', user.id, { mfa: { secretEnc: user.mfaPending.secretEnc, enabledAt: now(), lastStep: step, recovery: codes.map(hashCode) }, mfaPending: null });
  audit(user, 'mfa_enabled', user.id, {});
  return codes;
}

router.post('/mfa/setup', wrap(async (req, res, next) => {
  const s = mfaSubject(req);
  if (!s) return next();
  if (s.user.mfa?.enabledAt) throw bad('Two-step sign-in is already on.');
  await startSetup(s.user, res);
}), requireAuth, wrap(async (req, res) => {
  if (isDemoUser(req.user)) throw bad('Two-step sign-in is not available on demo accounts.');
  if (req.user.mfa?.enabledAt) throw bad('Two-step sign-in is already on.');
  await startSetup(req.user, res);
}));

router.post('/mfa/confirm', wrap(async (req, res, next) => {
  const s = mfaSubject(req);
  if (!s) return next();
  const codes = await finishSetup(s.user, req.body?.code);
  const fresh = db.update('users', s.user.id, { lastLoginAt: now() });
  res.json({ recoveryCodes: codes, token: signToken(fresh), user: publicUser(fresh) });
}), requireAuth, wrap(async (req, res) => {
  const codes = await finishSetup(req.user, req.body?.code);
  res.json({ recoveryCodes: codes, user: publicUser(db.find('users', (u) => u.id === req.user.id)) });
}));

router.post('/mfa/verify', wrap(async (req, res) => {
  const user = readStepToken(req.body?.mfaToken, 'mfa');
  if (!user) throw new HttpError(401, 'Your sign-in step has expired. Please sign in again.');
  if (!user.mfa?.enabledAt) throw bad('Two-step sign-in is not set up yet.');
  const how = checkCode(user, req.body || {});
  const fresh = db.update('users', user.id, { lastLoginAt: now() });
  if (how === 'recovery') audit(fresh, 'mfa_recovery_code_used', user.id, { left: String(fresh.mfa.recovery.length) });
  res.json({ token: signToken(fresh), user: publicUser(fresh), recoveryCodesLeft: fresh.mfa.recovery.length });
}));

router.post('/mfa/disable', requireAuth, wrap(async (req, res) => {
  if (staffMfaRequired(req.user)) throw new HttpError(403, 'Two-step sign-in is required for DROP staff accounts.');
  if (!req.user.mfa?.enabledAt) throw bad('Two-step sign-in is not on.');
  if (!(await checkPassword(String(req.body?.password || ''), req.user.passwordHash))) throw bad('Your password is incorrect.');
  checkCode(req.user, req.body || {});
  db.update('users', req.user.id, { mfa: null });
  audit(req.user, 'mfa_disabled', req.user.id, {});
  res.json({ user: publicUser(db.find('users', (u) => u.id === req.user.id)) });
}));

/** Sign out on every device (ends all sessions, including this one). */
router.post('/logout-all', requireAuth, wrap(async (req, res) => {
  endAllSessions(req.user.id);
  res.json({ ok: true });
}));

// One-click demo logins (only while DEMO_MODE is on). Demo accounts have no usable password.
router.get('/demo', (_req, res) => {
  res.json({ enabled: demoEnabled(), accounts: DEMO_ACCOUNTS.filter((a) => demoRoleAllowed(a.role)).map(({ role, title, name, blurb }) => ({ role, title, name, blurb })) });
});

router.post('/demo', wrap(async (req, res) => {
  if (!demoEnabled()) throw new HttpError(404, 'Demo accounts are not available.');
  const acc = DEMO_ACCOUNTS.find((a) => a.role === req.body?.role);
  if (!acc) throw bad('Choose a demo dashboard.');
  if (!demoRoleAllowed(acc.role)) throw new HttpError(404, 'This demo dashboard is not available on a live site.');
  if (['passenger', 'driver'].includes(acc.role)) seedDemoTrip(); // keep a live trip to try chat and calls
  const user = db.find('users', (u) => u.email === acc.email);
  if (!user) throw new HttpError(503, 'Demo accounts are still being prepared. Try again in a moment.');
  db.update('users', user.id, { lastLoginAt: now() });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.name = str(b.name, 'Full name', { min: 2, max: 80 });
  if (b.phone !== undefined) patch.phone = phone(b.phone, 'Mobile number', true);
  if (b.company !== undefined && req.user.role === 'business') patch.company = str(b.company, 'Company name', { max: 120 });
  if (b.savedPlaces) {
    patch.savedPlaces = {
      home: str(b.savedPlaces.home, 'Home address', { optional: true, max: 160 }),
      work: str(b.savedPlaces.work, 'Work address', { optional: true, max: 160 }),
    };
  }
  if (b.paymentPreference !== undefined) patch.paymentPreference = oneOf(b.paymentPreference, ['Card', 'Cash', 'Business account'], 'Payment preference');
  if (b.notifications !== undefined) patch.notifications = oneOf(b.notifications, ['Email', 'SMS', 'None'], 'Notification preference');
  if (isDemoUser(req.user) && (b.newPassword || b.name !== undefined)) throw bad('Demo account names and passwords cannot be changed.');
  if (b.newPassword) {
    if (!(await checkPassword(String(b.currentPassword || ''), req.user.passwordHash))) throw bad('Your current password is incorrect.');
    const pw = password(b.newPassword);
    await assertNotBreached(pw);
    patch.passwordHash = await hashPassword(pw);
    patch.tokenVersion = (req.user.tokenVersion || 0) + 1; // a new password signs out every other device
  }
  const user = db.update('users', req.user.id, patch);
  res.json({ user: publicUser(user), ...(patch.passwordHash && { token: signToken(user) }) });
}));

export default router;
