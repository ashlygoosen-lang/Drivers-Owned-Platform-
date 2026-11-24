/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from './api';

/**
 * Google Maps JavaScript API loader. The browser key comes from the server (/api/maps/config) so it
 * can be changed in Railway without rebuilding. Restrict that key to your site's domain in Google Cloud.
 */
export interface MapsConfig { provider: 'google' | 'none'; browserKey: string | null; mapId: string; routes: boolean; center: { lat: number; lng: number } }
export interface LatLng { lat: number; lng: number }

let configP: Promise<MapsConfig> | null = null;
export function mapsConfig() {
  configP ||= api<MapsConfig>('/maps/config').catch(() => ({ provider: 'none', browserKey: null, mapId: '', routes: false, center: { lat: -33.9249, lng: 18.4241 } }) as MapsConfig);
  return configP;
}

let loadP: Promise<any> | null = null;
let authFailed = false;
const failListeners = new Set<() => void>();
export const onMapsAuthFailure = (fn: () => void) => { failListeners.add(fn); return () => { failListeners.delete(fn); }; };
export const mapsAuthFailed = () => authFailed;

/** Load the Maps JavaScript API once. Resolves with `google.maps`, or rejects if it can't load. */
export function loadGoogleMaps(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google.maps);
  loadP ||= new Promise((resolve, reject) => {
    // Google calls this if the key is invalid or not allowed on this domain.
    w.gm_authFailure = () => { authFailed = true; failListeners.forEach((f) => f()); };
    w.__dropMapsReady = () => resolve(w.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=en&region=ZA&callback=__dropMapsReady`;
    s.async = true;
    s.onerror = () => { loadP = null; reject(new Error('Google Maps could not load.')); };
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('Google Maps took too long to load.')), 15_000);
  });
  return loadP;
}

/** Decode a Google encoded polyline (Routes API) without needing the geometry library. */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

export const fmtEta = (sec: number) => sec < 90 ? '1 min' : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
export const fmtDist = (m: number) => m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
