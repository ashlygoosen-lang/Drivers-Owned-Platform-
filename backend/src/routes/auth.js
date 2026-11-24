import { Router } from 'express';
import { db, id, now } from '../db.js';
import { hashPassword, checkPassword, signToken, publicUser, requireAuth } from '../auth.js';
import { str, email, phone, password, oneOf, wrap, bad, HttpError } from '../validate.js';

const router = Router();

export async function createUser({ name, emailAddress, mobile, pw, role, company }) {
  if (db.find('users', (u) => u.email === emailAddress)) {
    throw new HttpError(409, 'An account with this email already exists. Please sign in instead.');
  }
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
  const user = db.find('users', (u) => u.email === emailAddress);
  if (!user || !(await checkPassword(pw, user.passwordHash))) {
    throw new HttpError(401, 'That email and password combination is not recognised.');
  }
  if (user.disabled) throw new HttpError(403, 'This account has been suspended. Please contact support.');
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
  if (b.newPassword) {
    if (!(await checkPassword(String(b.currentPassword || ''), req.user.passwordHash))) throw bad('Your current password is incorrect.');
    patch.passwordHash = await hashPassword(password(b.newPassword));
  }
  const user = db.update('users', req.user.id, patch);
  res.json({ user: publicUser(user) });
}));

export default router;
