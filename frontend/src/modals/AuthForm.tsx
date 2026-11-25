import { useState } from 'react';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, input, Field, ErrorText, Icon, Spinner } from '../components/ui';
import { DemoPicker } from './DemoPicker';
import { MfaSetup, MfaVerify } from '../components/TwoStep';

type Mode = 'signin' | 'register' | 'forgot';

export function AuthForm({ initialMode = 'signin', onDone, onDriver, note, showDemo = false }: {
  initialMode?: Mode; onDone: (user: User) => void; onDriver?: () => void; note?: string; showDemo?: boolean;
}) {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accountType, setAccountType] = useState<'passenger' | 'business'>('passenger');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ kind: 'verify' | 'setup'; mfaToken: string } | null>(null);
  const finish = (r: { token?: string; user: User }) => { if (r.token) signIn(r.token, r.user); onDone(r.user); };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setError('');
    setBusy(true);
    try {
      type Res = { token: string; user: User; mfa?: 'verify' | 'setup'; mfaToken?: string };
      const res = mode === 'signin'
        ? await api<Res>('/auth/login', { body: { email: f.email, password: f.password } })
        : await api<Res>('/auth/register', { body: { ...f, role: accountType } });
      if (res.mfa && res.mfaToken) { setStep({ kind: res.mfa, mfaToken: res.mfaToken }); return; }
      finish(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot') return <ForgotPassword onBack={() => setMode('signin')} />;
  if (step?.kind === 'verify') return <MfaVerify mfaToken={step.mfaToken} onDone={finish} onBack={() => setStep(null)} />;
  if (step?.kind === 'setup') return <MfaSetup mfaToken={step.mfaToken} onDone={finish} required />;

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
      {mode === 'signin' && <button type="button" className="-mt-2 w-fit text-sm underline" onClick={() => { setMode('forgot'); setError(''); }}>Forgot your password?</button>}
      <ErrorText>{error}</ErrorText>
      <button className={button} disabled={busy}>{busy ? <Spinner /> : null}{mode === 'signin' ? 'Sign in' : 'Create my account'} <Icon name="arrow" size={17} /></button>
      {onDriver && <button type="button" className={outline} onClick={onDriver}>Apply as a driver or delivery partner</button>}
      {mode === 'register' && <p className="text-[12px] leading-5 text-[#576478]">By creating an account you agree to the DROP passenger terms and privacy policy.</p>}
    </form>
  </div>;
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return sent ? <div className="grid gap-4"><p className="flex items-start gap-3 text-sm leading-6"><Icon name="mail" size={22} className="shrink-0 text-orange" />{sent}</p><button className={outline} onClick={onBack}>Back to sign in</button></div>
    : <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { setSent((await api<{ message: string }>('/auth/password/forgot', { body: { email: new FormData(e.currentTarget).get('email') } })).message); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
      <p className="text-sm leading-6">Enter the email you use for DROP. We’ll send a link to choose a new password.</p>
      <Field label="Email address"><input name="email" type="email" required autoComplete="email" className={input} placeholder="you@example.com" /></Field>
      <ErrorText>{error}</ErrorText>
      <button className={button} disabled={busy}>{busy && <Spinner />}Send reset link</button>
      <button type="button" className="text-sm underline" onClick={onBack}>Back to sign in</button>
    </form>;
}

/** Opened from the email link: /reset-password?token=… */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  if (done) return <div className="grid gap-4"><p className="flex items-center gap-2 text-sm font-semibold text-[#17744a]"><Icon name="check" size={18} />{done}</p><button className={button} onClick={onDone}>Sign in</button></div>;
  return <form className="grid gap-4" onSubmit={async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (f.newPassword !== f.confirm) { setError('The two passwords don’t match.'); return; }
    setBusy(true); setError('');
    try { setDone((await api<{ message: string }>('/auth/password/reset', { body: { token, newPassword: f.newPassword } })).message); window.history.replaceState(null, '', '/'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>
    <Field label="New password" hint="At least 8 characters, with letters and numbers. Avoid passwords you use elsewhere."><input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={input} /></Field>
    <Field label="Confirm new password"><input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={input} /></Field>
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy}>{busy && <Spinner />}Save new password</button>
  </form>;
}
