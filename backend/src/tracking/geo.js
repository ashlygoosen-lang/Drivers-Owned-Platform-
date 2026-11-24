import { findPlace, haversineKm } from '../pricing.js';

/**
 * Google Maps Platform on the server: Geocoding (addresses → coordinates) and the Routes API
 * (driving route, distance and traffic-aware ETA). Everything falls back to straight-line estimates
 * when no server key is set, so the site still works without Google.
 *
 * Keys: GOOGLE_MAPS_SERVER_KEY (Geocoding API + Routes API; restrict by IP or leave unrestricted
 * but API-limited) and GOOGLE_MAPS_BROWSER_KEY (Maps JavaScript API; restrict to your domain).
 * GOOGLE_MAPS_API_KEY is used for both when the specific ones are not set.
 */
const env = (k) => (process.env[k] || '').trim();
export const serverKey = () => env('GOOGLE_MAPS_SERVER_KEY') || env('GOOGLE_MAPS_API_KEY');
export const browserKey = () => env('GOOGLE_MAPS_BROWSER_KEY') || env('GOOGLE_MAPS_API_KEY');
const BASE = () => env('GOOGLE_MAPS_API_BASE') || 'https://maps.googleapis.com';
const ROUTES = () => env('GOOGLE_ROUTES_API_BASE') || 'https://routes.googleapis.com';

export const distanceKm = (a, b) => haversineKm(a, b);

export function bearing(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Straight-line ETA for when no route is available (city driving ~28 km/h, roads ~1.3× straight line). */
export function roughEta(from, to) {
  const km = distanceKm(from, to) * 1.3;
  return { distanceM: Math.round(km * 1000), durationSec: Math.max(60, Math.round((km / 28) * 3600)), estimated: true };
}

const geoCache = new Map();
/** Coordinates for an address: known DROP places first, then Google Geocoding (South Africa). */
export async function locate(address) {
  const known = findPlace(address);
  if (known) return { lat: known.lat, lng: known.lng, source: 'places' };
  const key = serverKey();
  const q = String(address || '').trim();
  if (!key || !q) return null;
  if (geoCache.has(q.toLowerCase())) return geoCache.get(q.toLowerCase());
  try {
    const url = `${BASE()}/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=za&components=country:ZA&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    const hit = data.results?.[0];
    const loc = hit ? { lat: hit.geometry.location.lat, lng: hit.geometry.location.lng, source: 'google', formatted: hit.formatted_address } : null;
    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') geoCache.set(q.toLowerCase(), loc);
    else console.warn('[drop] geocoding:', data.status, data.error_message || '');
    return loc;
  } catch (err) {
    console.warn('[drop] geocoding failed:', err.message);
    return null;
  }
}

/** Driving route from → to with live traffic. Returns { polyline, distanceM, durationSec } or a rough estimate. */
export async function drivingRoute(from, to) {
  const key = serverKey();
  if (!key) return roughEta(from, to);
  try {
    const res = await fetch(`${ROUTES()}/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', regionCode: 'ZA', units: 'METRIC',
      }),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const r = data.routes?.[0];
    if (!res.ok || !r) { console.warn('[drop] routes:', data.error?.message || 'no route'); return roughEta(from, to); }
    return { polyline: r.polyline?.encodedPolyline || '', distanceM: r.distanceMeters || 0, durationSec: Number(String(r.duration || '0s').replace('s', '')) || 0, estimated: false };
  } catch (err) {
    console.warn('[drop] routes failed:', err.message);
    return roughEta(from, to);
  }
}

export function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
