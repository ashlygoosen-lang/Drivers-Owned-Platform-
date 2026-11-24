import { useState } from 'react';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, input, Field, ErrorText, Icon, Spinner } from '../components/ui';

type Mode = 'signin' | 'register';

export function AuthForm({ initialMode = 'signin', onDone, onDriver, note }: {
  initialMode?: Mode; onDone: (user: User) => void; onDriver?: () => void; note?: string;
}) {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accountType, setAccountType] = useState<'passenger' | 'business'>('passenger');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setError('');
    setBusy(true);
    try {
      const res = mode === 'signin'
        ? await api<{ token: string; user: User }>('/auth/login', { body: { email: f.email, password: f.password } })
        : await api<{ token: string; user: User }>('/auth/register', { body: { ...f, role: accountType } });
      signIn(res.token, res.user);
      onDone(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-5">
    {note && <p className="rounded-lg bg-[#e3eaf2] p-3 text-sm leading-6 text-forest">{note}</p>}
    <div className="flex gap-1 rounded-lg bg-[#eef1f4] p-1" role="tablist" aria-label="Sign in or create account">
      {(['signin', 'register'] as Mode[]).map((m) => <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => { setMode(m); setError(''); }} className={`min-h-10 flex-1 rounded-md text-sm font-semibold ${mode === m ? 'bg-forest text-white shadow-sm' : 'text-[#5a6575]'}`}>{m === 'signin' ? 'Sign in' : 'Create account'}</button>)}
    </div>
    <form className="grid gap-4" onSubmit={submit} key={mode}>
      {mode === 'register' && <>
        <div className="grid grid-cols-2 gap-2">
          {(['passenger', 'business'] as const).map((t) => <button type="button" key={t} aria-pressed={accountType === t} onClick={() => setAccountType(t)} className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border text-sm ${accountType === t ? 'border-forest bg-[#dfe6f0] font-semibold' : 'border-[#d2dae4]'}`}><Icon name={t === 'passenger' ? 'user' : 'building'} size={17} />{t === 'passenger' ? 'Personal' : 'Business'}</button>)}
        </div>
        <Field label="Full name"><input name="name" required minLength={2} autoComplete="name" className={input} placeholder="Your full name" /></Field>
        {accountType === 'business' && <Field label="Company name"><input name="company" required minLength={2} autoComplete="organization" className={input} placeholder="Registered company name" /></Field>}
        <Field label="Mobile number"><input name="phone" type="tel" autoComplete="tel" className={input} placeholder="+27 82 000 0000" /></Field>
      </>}
      <Field label="Email address"><input name="email" type="email" required autoComplete="email" className={input} placeholder="you@example.com" /></Field>
      <Field label="Password" hint={mode === 'register' ? 'At least 8 characters, with letters and numbers.' : undefined}>
        <input name="password" type="password" required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className={input} placeholder={mode === 'register' ? 'Create a password' : 'Your password'} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <button className={button} disabled={busy}>{busy ? <Spinner /> : null}{mode === 'signin' ? 'Sign in' : 'Create my account'} <Icon name="arrow" size={17} /></button>
      {onDriver && <button type="button" className={outline} onClick={onDriver}>Apply as a driver or delivery partner</button>}
      {mode === 'register' && <p className="text-[12px] leading-5 text-[#576478]">By creating an account you agree to the DROP passenger terms and privacy policy.</p>}
    </form>
  </div>;
}
