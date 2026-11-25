import { useEffect, useState } from 'react';
import { api, type User } from '../lib/api';
import { button, input, Field, ErrorText, Icon, Spinner } from './ui';

interface Session { token?: string; user: User }

/** Set up an authenticator app: QR code, confirm a code, then show one-time recovery codes. */
export function MfaSetup({ mfaToken, onDone, required = false }: { mfaToken?: string; onDone: (s: Session) => void; required?: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ secret: string; qrSvg: string }>('/auth/mfa/setup', { body: mfaToken ? { mfaToken } : {} }).then(setSetup).catch((err) => setError((err as Error).message));
  }, [mfaToken]);

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') || '');
    setBusy(true); setError('');
    try {
      const r = await api<{ recoveryCodes: string[]; token?: string; user: User }>('/auth/mfa/confirm', { body: { code, ...(mfaToken && { mfaToken }) } });
      setCodes(r.recoveryCodes); setSession({ token: r.token, user: r.user });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (codes && session) return <div className="grid gap-4">
    <p className="flex items-center gap-2 text-sm font-semibold text-[#17744a]"><Icon name="check" size={18} />Two-step sign-in is on.</p>
    <p className="text-sm leading-6">Save these recovery codes somewhere safe, such as a password manager. Each one works once if you lose your phone. <b>They won’t be shown again.</b></p>
    <ol className="grid grid-cols-2 gap-2 rounded-xl bg-[#f5f7fa] p-4 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="text-sm font-semibold underline" onClick={() => { void navigator.clipboard?.writeText(codes.join('\n')); }}>Copy codes</button>
      <a className="text-sm font-semibold underline" download="drop-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`DROP recovery codes\n\n${codes.join('\n')}\n`)}`}>Download codes</a>
    </div>
    <button className={button} onClick={() => onDone(session)}>I’ve saved my codes <Icon name="arrow" size={17} /></button>
  </div>;

  return <form className="grid gap-4" onSubmit={confirm}>
    {required && <p className="rounded-lg bg-[#fff4ec] p-3 text-sm leading-6 text-[#8a3a00]"><b>DROP staff accounts need two-step sign-in.</b> It protects customers’ ID documents and money if your password is ever stolen.</p>}
    <ol className="grid gap-2 text-sm leading-6">
      <li>1. Install an authenticator app, such as Google Authenticator, Microsoft Authenticator or Authy.</li>
      <li>2. Scan this code with the app (or type the key).</li>
      <li>3. Enter the 6-digit code it shows.</li>
    </ol>
    {setup ? <div className="flex flex-wrap items-center gap-4">
      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR code for your authenticator app" className="h-44 w-44 rounded-xl border border-[#d2dae4] bg-white p-2" />
      <p className="min-w-0 text-[12px] text-[#4d5b71]">Can’t scan? Enter this key:<br /><code className="break-all text-sm font-semibold text-navy">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
    </div> : !error && <p className="flex items-center gap-2 text-sm"><Spinner /> Preparing…</p>}
    <Field label="6-digit code"><input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className={`${input} tracking-[0.3em]`} placeholder="123456" /></Field>
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy || !setup}>{busy && <Spinner />}Turn on two-step sign-in</button>
  </form>;
}

/** Second sign-in step: authenticator code, or a recovery code. */
export function MfaVerify({ mfaToken, onDone, onBack }: { mfaToken: string; onDone: (s: Session) => void; onBack: () => void }) {
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('code') || '');
    setBusy(true); setError('');
    try {
      const r = await api<{ token: string; user: User; recoveryCodesLeft: number }>('/auth/mfa/verify', { body: { mfaToken, ...(recovery ? { recoveryCode: v } : { code: v }) } });
      onDone({ token: r.token, user: r.user });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="grid gap-4" onSubmit={submit} key={String(recovery)}>
    <p className="flex items-start gap-3 text-sm leading-6"><Icon name="shield" size={22} className="shrink-0 text-orange" />{recovery ? 'Enter one of the recovery codes you saved when you set up two-step sign-in.' : 'Open your authenticator app and enter the 6-digit code for DROP.'}</p>
    <Field label={recovery ? 'Recovery code' : '6-digit code'}><input name="code" required autoFocus inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 11 : 6} className={`${input} tracking-[0.3em]`} placeholder={recovery ? 'XXXXX-XXXXX' : '123456'} /></Field>
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy}>{busy && <Spinner />}Verify and sign in</button>
    <div className="flex justify-between text-sm"><button type="button" className="underline" onClick={() => { setRecovery(!recovery); setError(''); }}>{recovery ? 'Use my authenticator app' : 'Lost your phone? Use a recovery code'}</button><button type="button" className="underline" onClick={onBack}>Back</button></div>
  </form>;
}
