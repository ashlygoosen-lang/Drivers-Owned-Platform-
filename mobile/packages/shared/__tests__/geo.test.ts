import { compareVersions, decodePolyline, fmtDist, fmtEta } from '../src/lib/geo';

test('decodes a Google encoded polyline', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  expect(pts).toHaveLength(3);
  expect(pts[0]).toEqual({ latitude: 38.5, longitude: -120.2 });
  expect(pts[2]).toEqual({ latitude: 43.252, longitude: -126.453 });
});

test('formats ETA and distance', () => {
  expect(fmtEta(45)).toBe('1 min');
  expect(fmtEta(600)).toBe('10 min');
  expect(fmtDist(85)).toBe('90 m');
  expect(fmtDist(2400)).toBe('2.4 km');
});

test('compares versions for the force-update gate', () => {
  expect(compareVersions('1.1.9', '1.2.0')).toBeLessThan(0);
  expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  expect(compareVersions('2.0', '1.9.9')).toBeGreaterThan(0);
});
