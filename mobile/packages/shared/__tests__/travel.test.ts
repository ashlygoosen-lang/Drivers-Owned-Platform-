import { ageOn, fillLabel, travelAmounts, passengerProblem, groupBookingTone, isUpcomingBooking } from '../src/lib/travel';

const ctx = { international: true, departureDate: '2027-01-12', travelUntil: '2027-01-19', today: '2026-11-25' };
const ok = { fullName: 'Thandi Dlamini', dateOfBirth: '1990-04-02', nationality: 'South African', passportNumber: 'a1234567', passportExpiry: '2030-01-01' };

test('age on the travel date, including the day before a birthday', () => {
  expect(ageOn('2009-01-12', '2027-01-12')).toBe(18);
  expect(ageOn('2009-01-13', '2027-01-12')).toBe(17);
});

test('fill line and amounts match the website', () => {
  expect(fillLabel(31, 40, 28)).toBe('31 of 40 seats · minimum reached, trip goes ahead');
  expect(fillLabel(11, 40, 26)).toBe('11 of 40 seats · 15 more needed to confirm');
  expect(travelAmounts(9800, 2, 30, 'deposit')).toEqual({ total: 19600, dueNow: 5880, later: 13720 });
  expect(travelAmounts(650, 1, 30, 'full')).toEqual({ total: 650, dueNow: 650, later: 0 });
  expect(travelAmounts(650, 1, 0, 'deposit').dueNow).toBe(650); // no deposit option on this route
});

test('passenger checks mirror the server', () => {
  expect(passengerProblem(ok, 0, ctx)).toBe('');
  expect(passengerProblem({ ...ok, passportNumber: '' }, 0, ctx)).toMatch(/passport number/);
  expect(passengerProblem({ ...ok, passportExpiry: '2027-01-19' }, 1, ctx)).toMatch(/^Traveller 2: the passport must be valid/);
  expect(passengerProblem({ ...ok, passportNumber: '', passportExpiry: '' }, 0, { ...ctx, international: false })).toBe('');
  expect(passengerProblem({ ...ok, dateOfBirth: '2030-01-01' }, 0, ctx)).toMatch(/date of birth/);
  expect(passengerProblem({ ...ok, fullName: 'T' }, 0, ctx)).toMatch(/full name/);
});

test('status tones and upcoming filter', () => {
  expect(groupBookingTone('ticketed')).toBe('good');
  expect(groupBookingTone('deposit_paid')).toBe('warn');
  expect(groupBookingTone('refunded')).toBe('bad');
  expect(isUpcomingBooking('transfer_offered')).toBe(true);
  expect(isUpcomingBooking('completed')).toBe(false);
});
