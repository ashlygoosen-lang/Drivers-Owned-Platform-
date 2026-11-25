import { API_URL, APP, VERSION } from './config';
import { secure, KEYS } from './secureStore';
import { integrityHeaders } from './integrity';
import type { User } from '../types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

/**
 * The same secured API as the website. The access token lives only in memory (15 minutes); the
 * rotating refresh token is in the Keychain/Keystore. Sensitive calls carry an app-integrity proof.
 */
let access: string | null = null;
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };
export const accessToken = () => access;

const SENSITIVE = /^\/(auth\/(login|register)|bookings|payments\/bookings\/[^/]+\/checkout|wallet\/(withdrawals|bank-account))$/;
const baseHeaders = () => ({ 'x-drop-client': 'mobile', 'x-drop-app': APP, 'x-drop-version': VERSION });

async function raw<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method || (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers: { ...baseHeaders(), ...(init.body !== undefined && { 'content-type': 'application/json' }), ...init.headers },
      body: init.form || (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.', data.code);
  return data as T;
}

let refreshing: Promise<{ token: string; user: User } | null> | null = null;
export function refresh() {
  refreshing ||= (async () => {
    const rt = await secure.get(KEYS.refresh);
    if (!rt) return null;
    try {
      const r = await raw<{ token: string; refreshToken: string; user: User }>('/auth/refresh', { method: 'POST', body: { refreshToken: rt } });
      access = r.token;
      await secure.set(KEYS.refresh, r.refreshToken, APP === 'driver');
      return r;
    } catch (err) {
      if ((err as ApiError).status === 401) { await secure.set(KEYS.refresh, null); access = null; }
      return null;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Requests that create money or trips: each user action gets one key, reused on retries, so the server runs it once. */
const IDEMPOTENT = /^\/(bookings|plans|payments\/(bookings|plans)\/[^/]+\/checkout|wallet\/withdrawals)$/;
function newKey() {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; idempotencyKey?: string } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (!access && !path.startsWith('/auth/') && !path.startsWith('/app/')) await refresh(); // e.g. cold start or background task
  if (access) headers.authorization = `Bearer ${access}`;
  const method = init.method || (init.body !== undefined || init.form ? 'POST' : 'GET');
  if (method !== 'GET' && SENSITIVE.test(path)) Object.assign(headers, await integrityHeaders(raw));
  if (method === 'POST' && IDEMPOTENT.test(path)) { init = { ...init, idempotencyKey: init.idempotencyKey || newKey() }; headers['idempotency-key'] = init.idempotencyKey!; }
  try {
    return await raw<T>(path, { ...init, method, headers });
  } catch (err) {
    if ((err as ApiError).status === 401 && access && !retried && !path.startsWith('/auth/')) {
      if (await refresh()) return api<T>(path, init, true);
      onSignedOut?.();
    }
    throw err;
  }
}

/** After sign-in, sign-up or MFA: keep the refresh token in secure storage. */
export async function startSession(r: { token: string; refreshToken?: string }) {
  access = r.token;
  if (r.refreshToken) await secure.set(KEYS.refresh, r.refreshToken, APP === 'driver');
}
export async function endSession() {
  const rt = await secure.get(KEYS.refresh);
  if (rt) await raw('/auth/logout', { method: 'POST', body: { refreshToken: rt } }).catch(() => undefined);
  access = null;
  await secure.set(KEYS.refresh, null);
}

/** Multipart upload (verification documents). */
export function upload<T>(path: string, form: FormData) { return api<T>(path, { form }); }
export { raw as rawApi };
