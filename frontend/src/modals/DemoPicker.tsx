import { useEffect, useState } from 'react';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon, Spinner, type IconName } from '../components/ui';

interface DemoAccount { role: string; title: string; name: string; blurb: string }
const ICONS: Record<string, IconName> = { passenger: 'user', driver: 'car', business: 'building', admin: 'star', compliance: 'shield', support: 'mail', finance: 'wallet' };

export function useDemoAccounts() {
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null);
  useEffect(() => { api<{ enabled: boolean; accounts: DemoAccount[] }>('/auth/demo').then((r) => setAccounts(r.enabled ? r.accounts : [])).catch(() => setAccounts([])); }, []);
  return accounts;
}

/** One-click demo logins for every dashboard. Renders nothing when demo mode is off. */
export function DemoPicker({ onDone, compact = false }: { onDone: (u: User) => void; compact?: boolean }) {
  const { signIn } = useAuth();
  const accounts = useDemoAccounts();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!accounts?.length) return null;
  async function open(role: string) {
    setBusy(role); setError('');
    try { const r = await api<{ token: string; user: User }>('/auth/demo', { body: { role } }); signIn(r.token, r.user); onDone(r.user); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <div className="grid gap-3">
    {!compact && <div><p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[1.6px] text-orange-dark"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-orange" />Demo dashboards</p><p className="mt-1 text-sm text-[#5b6b82]">Explore DROP with sample data. One click, no password.</p></div>}
    <div className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
      {accounts.map((a) => <button key={a.role} onClick={() => open(a.role)} disabled={!!busy} className="demo-card group flex items-start gap-3 rounded-xl border border-[#e3e8ef] bg-white p-3 text-left transition hover:border-orange hover:shadow-[0_6px_18px_#071b3a14] disabled:opacity-60">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy text-white group-hover:bg-orange group-hover:text-navy">{busy === a.role ? <Spinner /> : <Icon name={ICONS[a.role] || 'user'} size={18} />}</span>
        <span className="min-w-0"><b className="block text-sm text-navy">{a.title}</b>{!compact && <span className="block text-[12px] leading-4 text-[#5b6b82]">{a.blurb}</span>}</span>
      </button>)}
    </div>
    {error && <p role="alert" className="text-sm text-[#b42828]">{error}</p>}
  </div>;
}
