import { canDoSummary, eligibleRules, oldestYear, vehicleChoiceBody, type VehicleCatalogue } from '../src/lib/vehicles';

// Same rules as backend/src/vehicles.js (a trimmed copy of the catalogue response).
const c: Pick<VehicleCatalogue, 'year' | 'rules' | 'types'> = {
  year: 2026,
  rules: [
    { key: 'Ride:Go', label: 'Ride · Go', types: { hatchback: 12, sedan: 12 } },
    { key: 'Ride:Comfort', label: 'Ride · Comfort', types: { sedan: 8, suv: 8 } },
    { key: 'Ride:XL', label: 'Ride · XL', types: { mpv: 8, minibus: 10 }, minSeats: 7 },
    { key: 'Ride:Minibus', label: 'Minibus', types: { minibus: 12 }, minSeats: 8 },
    { key: 'Delivery:Documents', label: 'Delivery · Documents', types: { motorbike: 10, sedan: 15 } },
  ],
  types: [{ key: 'motorbike', label: 'Motorbike', seats: 1, blurb: '', serves: [{ key: 'Delivery:Documents', label: '', maxAge: 10 }] }, { key: 'sedan', label: 'Sedan', seats: 5, blurb: '', serves: [{ key: 'Ride:Go', label: '', maxAge: 12 }, { key: 'Ride:Comfort', label: '', maxAge: 8 }, { key: 'Delivery:Documents', label: '', maxAge: 15 }] }],
};

test('what a vehicle can do, by type, age and seats', () => {
  expect(eligibleRules(c, 'sedan', 2020, 5).map((r) => r.key)).toEqual(['Ride:Go', 'Ride:Comfort', 'Delivery:Documents']);
  expect(eligibleRules(c, 'sedan', 2016, 5).map((r) => r.key)).toEqual(['Ride:Go', 'Delivery:Documents']);
  expect(eligibleRules(c, 'minibus', 2014, 14).map((r) => r.key)).toEqual(['Ride:Minibus']); // 12 years: too old for XL (10), fine for plans (12)
  expect(eligibleRules(c, 'minibus', 2022, 6).map((r) => r.key)).toEqual([]); // too few seats
  expect(eligibleRules(c, 'motorbike', 2014, 1)).toEqual([]);
});

test('oldest accepted year and API body', () => {
  expect(oldestYear(c, 'sedan')).toBe(2011);
  expect(oldestYear(c, 'motorbike')).toBe(2016);
  expect(vehicleChoiceBody({ type: 'sedan', catalogueId: 'toyota|corolla', make: 'Toyota', model: 'Corolla', seats: 5, year: '2022', colour: ' White ', plate: 'CA 1 ' }))
    .toEqual({ catalogueId: 'toyota|corolla', year: 2022, colour: 'White', plate: 'CA 1' });
  expect(vehicleChoiceBody({ type: 'sedan', catalogueId: '', make: 'Chery ', model: 'Arrizo 6', seats: 5, year: '2025', colour: 'Grey', plate: 'GP 1' }))
    .toEqual({ type: 'sedan', make: 'Chery', model: 'Arrizo 6', seats: 5, year: 2025, colour: 'Grey', plate: 'GP 1' });
});

test('summary groups categories by service', () => {
  expect(canDoSummary(['Ride:Go', 'Ride:Comfort', 'Delivery:Documents', 'Delivery:Bakkie', 'Ride:Minibus'])).toBe('Ride: Go, Comfort · Delivery: Documents, Bakkie (bulky goods) · School and staff transport: Minibus');
});
