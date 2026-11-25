import { skippableDates, firstOfNextMonth, tomorrowSast, sastToday, daysLabel, isTime, planIsLive } from '../src/lib/plans';

const plan = (dates: string[], skipDates: string[] = []) => ({ pricing: { dates } as never, skipDates, legs: [{ key: 'out', label: 'Morning', time: '06:45' }] });

test('days can be skipped only with 12 hours’ notice before the first pickup, and not twice', () => {
  const now = Date.parse('2026-12-01T12:00:00+02:00'); // noon on 1 Dec
  const p = plan(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'], ['2026-12-04']);
  // 2 Dec 06:45 is 18h45 away → allowed; 1 Dec has passed; 4 Dec already skipped
  expect(skippableDates(p, now)).toEqual(['2026-12-02', '2026-12-03']);
  const late = Date.parse('2026-12-01T19:00:00+02:00'); // 11h45 before 2 Dec 06:45
  expect(skippableDates(p, late)).toEqual(['2026-12-03']);
});

test('South African dates, labels and validation', () => {
  const lateNight = Date.parse('2026-11-30T23:30:00+02:00'); // still 30 Nov in SA, already 30 Nov 21:30 UTC
  expect(sastToday(lateNight)).toBe('2026-11-30');
  expect(tomorrowSast(lateNight)).toBe('2026-12-01');
  expect(firstOfNextMonth(Date.parse('2026-12-31T23:30:00+02:00'))).toBe('2027-01-01');
  expect(daysLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
  expect(daysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
  expect(isTime('06:45')).toBe(true);
  expect(isTime('6:45')).toBe(false);
  expect(isTime('24:00')).toBe(false);
  expect(planIsLive({ status: 'active' })).toBe(true);
  expect(planIsLive({ status: 'completed' })).toBe(false);
});
