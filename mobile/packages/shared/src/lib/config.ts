import Constants from 'expo-constants';

/** Build-time configuration from app.config.ts `extra`. Nothing here is secret: anything in an app is public. */
export interface AppExtra {
  apiUrl: string;
  app: 'passenger' | 'driver';
  cloudProjectNumber?: string; // Google Cloud project number for Play Integrity
  easProjectId?: string;
  pins?: string[]; // base64 SHA-256 SPKI pins for the API host (primary + backup)
  privacyUrl?: string;
  termsUrl?: string;
}
export const extra = ((Constants.expoConfig?.extra || {}) as Partial<AppExtra>);
export const API_ORIGIN = (extra.apiUrl || 'https://drop.example.com').replace(/\/$/, '');
export const API_URL = `${API_ORIGIN}/api`;
export const APP: 'passenger' | 'driver' = extra.app === 'driver' ? 'driver' : 'passenger';
export const VERSION = Constants.expoConfig?.version || '1.0.0';
export const PRIVACY_URL = extra.privacyUrl || `${API_ORIGIN}/privacy`;
export const TERMS_URL = extra.termsUrl || `${API_ORIGIN}/terms`;
