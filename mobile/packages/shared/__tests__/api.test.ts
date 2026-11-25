/* The mobile API client: tokens in secure storage, silent refresh, integrity proofs, sign-out. */
const mockStore = new Map<string, string>();
const store = mockStore;
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'w', AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'a',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string, o: { keychainAccessible: string }) => { mockStore.set(k, v); mockStore.set(`${k}:opts`, o.keychainAccessible); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockStore.delete(k); }),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0', extra: { apiUrl: 'https://api.test', app: 'driver', cloudProjectNumber: '123' } } } }));
jest.mock('@expo/app-integrity', () => ({
  isSupported: false,
  prepareIntegrityTokenProviderAsync: jest.fn(async () => undefined),
  requestIntegrityCheckAsync: jest.fn(async (hash: string) => `play-token-for-${hash}`),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let responder: (c: Call) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
  const c = { url, init }; calls.push(c);
  const r = responder(c);
  return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
}) as unknown as typeof fetch;

import { api, startSession, endSession, refresh } from '../src/lib/api';
const headers = (c: Call) => c.init.headers as Record<string, string>;

beforeEach(() => { calls.length = 0; store.clear(); });

test('identifies as the mobile app and keeps the refresh token only in secure storage', async () => {
  await startSession({ token: 'access-1', refreshToken: 'refresh-1' });
  expect(store.get('drop.refresh')).toBe('refresh-1');
  expect(store.get('drop.refresh:opts')).toBe('a'); // driver: readable for background GPS after first unlock
  responder = () => ({ status: 200, body: { ok: true } });
  await api('/dashboard');
  expect(calls[0].url).toBe('https://api.test/api/dashboard');
  expect(headers(calls[0])['x-drop-client']).toBe('mobile');
  expect(headers(calls[0])['x-drop-app']).toBe('driver');
  expect(headers(calls[0]).authorization).toBe('Bearer access-1');
});

test('renews an expired access token once with the rotating refresh token, then retries', async () => {
  await startSession({ token: 'old', refreshToken: 'r1' });
  responder = (c) => {
    if (c.url.endsWith('/auth/refresh')) return { status: 200, body: { token: 'new', refreshToken: 'r2', user: { id: 'u' } } };
    return headers(c).authorization === 'Bearer new' ? { status: 200, body: { wallet: 1 } } : { status: 401, body: { error: 'expired' } };
  };
  await expect(api('/wallet')).resolves.toEqual({ wallet: 1 });
  expect(store.get('drop.refresh')).toBe('r2');
  expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/auth/refresh'))!.init.body))).toEqual({ refreshToken: 'r1' });
});

test('a rejected refresh token is wiped', async () => {
  await startSession({ token: 'old', refreshToken: 'stolen-and-reused' });
  responder = () => ({ status: 401, body: { error: 'Please sign in again.' } });
  expect(await refresh()).toBeNull();
  expect(store.has('drop.refresh')).toBe(false);
});

test('sensitive requests carry a Play Integrity proof bound to a fresh server challenge', async () => {
  await startSession({ token: 'a', refreshToken: 'r' });
  responder = (c) => (c.url.endsWith('/app/attest/challenge') ? { status: 200, body: { challenge: 'ch-1' } } : { status: 200, body: {} });
  await api('/wallet/withdrawals', { body: { amount: 100 } });
  const req = calls.find((c) => c.url.endsWith('/wallet/withdrawals'))!;
  expect(headers(req)['x-drop-challenge']).toBe('ch-1');
  expect(headers(req)['x-drop-integrity']).toBe('android play-token-for-ch-1');
  calls.length = 0;
  await api('/wallet'); // reads don't need a proof
  expect(calls.some((c) => c.url.endsWith('/app/attest/challenge'))).toBe(false);
});

test('booking requests carry one idempotency key, reused when the token is refreshed and retried', async () => {
  await startSession({ token: 'expired', refreshToken: 'r' });
  let first = true;
  responder = (c) => {
    if (c.url.endsWith('/app/attest/challenge')) return { status: 200, body: { challenge: 'ch' } };
    if (c.url.endsWith('/auth/refresh')) return { status: 200, body: { token: 'fresh', refreshToken: 'r2' } };
    if (c.url.endsWith('/bookings') && first) { first = false; return { status: 401, body: {} }; }
    return { status: 201, body: { booking: { id: 'b1' } } };
  };
  calls.length = 0;
  await api('/bookings', { body: { service: 'Ride' } });
  const keys = calls.filter((c) => c.url.endsWith('/bookings')).map((c) => headers(c)['idempotency-key']);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  calls.length = 0;
  await api('/bookings'); // listing trips is a read
  expect(headers(calls.find((c) => c.url.endsWith('/bookings'))!)['idempotency-key']).toBeUndefined();
});

test('sign-out revokes the session on the server and clears secure storage', async () => {
  await startSession({ token: 'a', refreshToken: 'r9' });
  responder = () => ({ status: 200, body: { ok: true } });
  await endSession();
  const out = calls.find((c) => c.url.endsWith('/auth/logout'))!;
  expect(JSON.parse(String(out.init.body))).toEqual({ refreshToken: 'r9' });
  expect(store.has('drop.refresh')).toBe(false);
});
