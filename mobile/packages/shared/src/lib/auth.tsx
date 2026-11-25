import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, endSession, refresh, setSignedOutHandler, startSession, ApiError } from './api';
import { registerForPush, unregisterPush } from './push';
import { APP } from './config';
import type { User } from '../types';

type SignInResult = { done: true } | { mfa: 'verify' | 'setup'; mfaToken: string };
interface AuthValue {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  finishMfa: (r: { token: string; refreshToken?: string; user: User }) => Promise<void>;
  register: (body: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
  reload: () => Promise<void>;
}
const Ctx = createContext<AuthValue | null>(null);
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('useAuth outside AuthProvider'); return c; };

/** Roles each app accepts. Staff use the website. */
const ALLOWED = APP === 'driver' ? ['driver'] : ['passenger', 'business'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const accept = useCallback(async (u: User) => {
    if (!ALLOWED.includes(u.role)) {
      await endSession();
      throw new ApiError(403, APP === 'driver' ? 'This is the DROP Driver app. Passengers, please use DROP.' : u.role === 'driver' ? 'Drivers, please use the DROP Driver app.' : 'Staff accounts use the DROP website.');
    }
    setUser(u);
    void registerForPush().catch(() => null);
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    refresh().then((r) => (r ? accept(r.user).catch(() => setUser(null)) : null)).finally(() => setReady(true));
  }, [accept]);

  const value = useMemo<AuthValue>(() => ({
    user, ready, setUser,
    async signIn(email, password) {
      const r = await api<{ token?: string; refreshToken?: string; user?: User; mfa?: 'verify' | 'setup'; mfaToken?: string }>('/auth/login', { body: { email, password } });
      if (r.mfa && r.mfaToken) return { mfa: r.mfa, mfaToken: r.mfaToken };
      await startSession({ token: r.token!, refreshToken: r.refreshToken });
      await accept(r.user!);
      return { done: true };
    },
    async finishMfa(r) { await startSession(r); await accept(r.user); },
    async register(body) {
      const r = await api<{ token: string; refreshToken?: string; user: User }>('/auth/register', { body });
      await startSession(r);
      await accept(r.user);
    },
    async signOut() { await unregisterPush(); await endSession(); setUser(null); },
    async reload() { setUser((await api<{ user: User }>('/auth/me')).user); },
  }), [user, ready, accept]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
