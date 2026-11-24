import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, token, type User } from './api';

interface AuthValue {
  user: User | null;
  ready: boolean;
  signIn: (t: string, u: User) => void;
  signOut: () => void;
  setUser: (u: User) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!token.get()) { setUser(null); return; }
    try { setUser((await api<{ user: User }>('/auth/me')).user); }
    catch { token.set(null); setUser(null); }
  }, []);

  useEffect(() => { void refresh().finally(() => setReady(true)); }, [refresh]);

  const value = useMemo<AuthValue>(() => ({
    user, ready, refresh, setUser,
    signIn: (t, u) => { token.set(t); setUser(u); },
    signOut: () => { token.set(null); setUser(null); },
  }), [user, ready, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
