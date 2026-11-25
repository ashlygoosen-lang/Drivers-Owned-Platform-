import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, BASE, token, ApiError } from './api';
import { button, outline, input, ErrorText, Spinner } from '../components/ui';

/**
 * Step-up for sensitive downloads (SEC-023): files with decrypted bank or passport numbers need a fresh
 * authenticator code. The server answers 403 { code: 'step_up_required' }; we ask for a code, send it to
 * /auth/step-up (valid 5 minutes), then retry the download.
 */
export class StepUpNeeded extends Error {}

async function protectedFetch(path: string) {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${token.get()}` } });
  if (res.ok) return res;
  const data = await res.json().catch(() => ({} as { error?: string; code?: string }));
  if (res.status === 403 && data.code === 'step_up_required') throw new StepUpNeeded(data.error);
  throw new ApiError(res.status, data.error || 'Could not download this file.');
}

/** Download a protected file under a name. */
export async function downloadProtected(path: string, filename: string) {
  const url = URL.createObjectURL(await (await protectedFetch(path)).blob());
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Print a protected HTML page (e.g. a manifest) via a hidden frame, so no script runs inside it. */
export async function printProtected(path: string) {
  const url = URL.createObjectURL(await (await protectedFetch(path)).blob());
  const frame = Object.assign(document.createElement('iframe'), { src: url, title: 'Print preview' });
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); };
  document.body.appendChild(frame);
  setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
}

/** Open a protected page in a new tab. */
export async function openProtected(path: string) {
  const url = URL.createObjectURL(await (await protectedFetch(path)).blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** `guard(fn)` runs fn; if the server wants a fresh code it shows `dialog`, then runs fn again. */
export function useStepUp() {
  const pending = useRef<(() => Promise<unknown>) | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Resolves true if fn ran now, false if it is waiting for the code (it then runs after the code is accepted). */
  async function guard(fn: () => Promise<unknown>) {
    try { await fn(); return true; } catch (e) {
      if (!(e instanceof StepUpNeeded)) throw e;
      pending.current = fn; setCode(''); setError(''); setOpen(true);
      return false;
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/step-up', { body: /^\d{6}$/.test(code.replace(/\s/g, '')) ? { code: code.replace(/\s/g, '') } : { recoveryCode: code } });
      setOpen(false);
      await pending.current?.();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const dialog = open ? createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-navy/70 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="stepup-title" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
    <form onSubmit={submit} className="grid w-full max-w-sm gap-4 rounded-2xl bg-white p-6 shadow-2xl">
      <div><h2 id="stepup-title" className="font-display text-xl font-extrabold text-navy">Confirm it’s you</h2>
        <p className="mt-1 text-sm text-[#4D5B71]">This file contains full bank or passport numbers. Enter the 6-digit code from your authenticator app (or a recovery code). You won’t be asked again for 5 minutes.</p></div>
      <input className={`${input} text-center font-mono text-lg tracking-[0.3em]`} autoFocus inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={20} />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-3"><button className={button} disabled={busy || code.trim().length < 6}>{busy && <Spinner />}Confirm and download</button><button type="button" className={outline} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  </div>, document.body) : null;
  return { guard, dialog };
}
