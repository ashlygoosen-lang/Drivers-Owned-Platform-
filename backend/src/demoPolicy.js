import { db } from './db.js';

/**
 * When demo logins are allowed (SEC-001).
 *
 * Demo accounts share one database with real customers, so a demo staff login on a live site would
 * expose real people's ID documents and bank details. The rules:
 * - DEMO_MODE=false: demo is off.
 * - DEMO_MODE unset: demo is on only until the first real passenger, driver or business account
 *   exists, then switches itself off.
 * - DEMO_MODE=true: passenger, driver and business demos stay on even with real users, but the demo
 *   STAFF dashboards (admin, compliance, support, finance) are always refused once real users exist.
 * Demo and real trips are kept apart: demo drivers only see demo passengers' requests and vice versa.
 */
export const DEMO_DOMAIN = 'demo.drop.co.za';
export const isDemoUser = (u) => Boolean(u?.email?.endsWith(`@${DEMO_DOMAIN}`));
const CUSTOMER_ROLES = ['passenger', 'driver', 'business'];
const STAFF = ['admin', 'compliance', 'support', 'finance'];

let realSeen = false;
export function realUsersExist() {
  if (!realSeen) realSeen = Boolean(db.find('users', (u) => CUSTOMER_ROLES.includes(u.role) && !isDemoUser(u)));
  return realSeen;
}
/** Test hook. */
export function resetRealUsersCache() { realSeen = false; }

export function demoEnabled() {
  const v = String(process.env.DEMO_MODE || '').trim().toLowerCase();
  if (v === 'false' || v === 'off' || v === '0') return false;
  if (v === 'true' || v === 'on' || v === '1') return true;
  return !realUsersExist();
}

export const demoRoleAllowed = (role) => demoEnabled() && (!STAFF.includes(role) || !realUsersExist());

/** A demo session is valid only while its role is still allowed. */
export const demoSessionAllowed = (user) => !isDemoUser(user) || demoRoleAllowed(user.role);

/** Demo and real accounts never meet on a trip. */
export const sameWorld = (a, b) => isDemoUser(a) === isDemoUser(b);
