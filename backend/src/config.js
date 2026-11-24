import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const PORT = Number(process.env.PORT || 4000);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';

// Persistent storage. On Railway, mount a volume and point DATA_DIR at it (e.g. /data).
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

if (IS_PROD && !process.env.JWT_SECRET) {
  console.warn('[drop] JWT_SECRET is not set. A random secret is being used, so sign-ins will reset on every restart.');
}
export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Comma-separated list of allowed browser origins for CORS. Empty = same-origin + localhost dev.
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// The first Super Admin is created from these on boot if no admin exists yet.
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const ADMIN_NAME = process.env.ADMIN_NAME || 'DROP Administrator';

// Built frontend to serve (single-service deploy). Ignored if the folder does not exist.
export const FRONTEND_DIST = path.resolve(process.env.FRONTEND_DIST || path.join(ROOT, '..', 'frontend', 'dist'));

export const COMPANY = {
  brand: 'DROP',
  name: 'Drivers Owned Platform',
  parent: 'VINK Group (Pty) Ltd',
  registration: '2018/079316/07',
  parentUrl: 'https://vinklife-production.up.railway.app',
  email: process.env.CONTACT_EMAIL || 'hello@drop.co.za',
  city: 'Cape Town, South Africa',
};
