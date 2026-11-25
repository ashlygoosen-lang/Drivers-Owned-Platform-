import { Router } from 'express';
import { db, id, now, nextRef } from '../db.js';
import { optionalAuth, requireAuth, requireRole } from '../auth.js';
import { str, email, phone, oneOf, wrap, bad } from '../validate.js';

const router = Router();

export const TICKET_TYPES = ['Trip help', 'Payment or fee dispute', 'Safety concern', 'Lost item', 'Account', 'Other'];
export const ENQUIRY_TOPICS = ['General enquiry', 'Business solutions', 'Driver ownership', 'Partnerships', 'Media', 'Report an issue'];

// Support tickets: signed-in users (passengers, drivers, business).
router.post('/support/tickets', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  let bookingRef = str(b.bookingRef, 'Booking reference', { optional: true, max: 20 });
  const refTrip = bookingRef ? await db.faultIn('bookings', 'ref', bookingRef) : null;
  if (bookingRef && !(refTrip && (refTrip.userId === req.user.id || refTrip.driverId === req.user.id))) {
    throw bad('We could not find that booking reference on your account.');
  }
  const type = oneOf(b.type || 'Trip help', TICKET_TYPES, 'Issue type');
  const ticket = db.insert('tickets', {
    id: id(),
    ref: nextRef('ticket', 'SUP'),
    userId: req.user.id,
    role: req.user.role,
    type,
    priority: type === 'Safety concern' ? 'urgent' : 'normal',
    bookingRef,
    message: str(b.message, 'Message', { min: 10, max: 2000 }),
    status: 'open',
    replies: [],
    createdAt: now(),
  });
  res.status(201).json({ ticket });
}));

router.get('/support/tickets', requireAuth, (req, res) => {
  res.json({ tickets: db.filter('tickets', (t) => t.userId === req.user.id).slice().reverse() });
});

// Public enquiries: contact form, business solutions, report an issue (no account needed).
router.post('/enquiries', optionalAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot: silently drop bots
  const enquiry = db.insert('enquiries', {
    id: id(),
    ref: nextRef('enquiry', 'ENQ'),
    userId: req.user?.id || null,
    topic: oneOf(b.topic || 'General enquiry', ENQUIRY_TOPICS, 'Topic'),
    name: str(b.name, 'Your name', { min: 2, max: 80 }),
    email: email(b.email),
    phone: phone(b.phone, 'Phone number', true),
    company: str(b.company, 'Company', { optional: true, max: 120 }),
    message: str(b.message, 'Message', { min: 10, max: 2000 }),
    status: 'new',
    createdAt: now(),
  });
  res.status(201).json({ ok: true, ref: enquiry.ref });
}));

// Business accounts: manage employees who can travel on the company account.
router.get('/business/employees', requireRole('business'), (req, res) => res.json({ employees: req.user.employees || [] }));

router.post('/business/employees', requireRole('business'), wrap(async (req, res) => {
  const employees = req.user.employees || [];
  const employee = {
    id: id(),
    name: str(req.body?.name, 'Employee name', { min: 2, max: 80 }),
    email: email(req.body?.email, 'Employee email'),
    department: str(req.body?.department, 'Department', { optional: true, max: 60 }),
    addedAt: now(),
  };
  if (employees.some((e) => e.email === employee.email)) throw bad('That employee is already on your account.');
  db.update('users', req.user.id, { employees: [...employees, employee] });
  res.status(201).json({ employee });
}));

router.delete('/business/employees/:id', requireRole('business'), (req, res) => {
  db.update('users', req.user.id, { employees: (req.user.employees || []).filter((e) => e.id !== req.params.id) });
  res.json({ ok: true });
});

export default router;
