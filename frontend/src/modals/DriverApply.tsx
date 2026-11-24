import { useRef, useState } from 'react';
import { api, type Application, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, input, Field, ErrorText, Icon, Spinner } from '../components/ui';

const DOCS = [
  ['identityDocument', 'Identity document (SA ID or passport)'],
  ['drivingLicence', 'Driving licence (with PrDP if you have one)'],
  ['vehicleDocument', 'Vehicle registration or licence disc'],
] as const;

export function DriverApply({ onDashboard }: { onDashboard: () => void }) {
  const { user, signIn, setUser } = useAuth();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Application | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const details = useRef<Record<string, string>>({});

  if (user && (user.role === 'business' || user.role === 'admin')) {
    return <p className="text-sm leading-7">You're signed in with a {user.role} account. Please sign out and apply with a personal account.</p>;
  }

  if (done) return <div className="grid gap-5">
    <div className="rounded-xl bg-[#eaf0df] p-6"><Icon name="check" size={32} /><h3 className="mt-4 text-xl font-semibold">Application {done.ref} received</h3>
      <p className="mt-3 text-sm leading-7">Documents: received securely<br />Identity verification: {done.checks.identity}<br />Vehicle inspection: {done.checks.inspection}<br />Account activation: {done.checks.activation}</p></div>
    <p className="text-sm leading-6 text-[#627059]">Our onboarding team will review your documents and contact you about your vehicle inspection. Track progress any time from your driver dashboard.</p>
    <button className={button} onClick={onDashboard}>Open my driver dashboard <Icon name="arrow" size={17} /></button>
  </div>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    if (step === 0) {
      details.current = Object.fromEntries(form) as Record<string, string>;
      setStep(1);
      return;
    }
    for (const [k, v] of Object.entries(details.current)) form.append(k, v);
    form.set('consent', form.get('consent') ? 'true' : 'false');
    setBusy(true);
    try {
      const res = await api<{ application: Application; token: string | null; user: User }>('/drivers/apply', { form });
      if (res.token) signIn(res.token, res.user); else setUser(res.user);
      setDone(res.application);
    } catch (err) {
      setError((err as Error).message);
      if (/email|password|name|mobile/i.test((err as Error).message)) setStep(0);
    } finally { setBusy(false); }
  }

  return <form className="grid gap-4" onSubmit={submit}>
    <div className="mb-1 flex gap-2">{['Your details', 'Documents & vehicle'].map((t, i) => <span key={t} className={`flex-1 border-b-2 pb-3 text-[12px] transition-colors ${step === i ? 'border-forest font-bold' : 'border-[#dfe6d6]'}`}>0{i + 1} {t}</span>)}</div>
    <div className="step-panel grid gap-4" key={step}>
      {step === 0 ? <>
        <Field label="Participation type"><select name="participation" defaultValue={details.current.participation} className={input}><option>Driver-owner programme</option><option>Delivery partner</option><option>Fleet owner</option></select></Field>
        <Field label="City"><select name="city" defaultValue={details.current.city || 'Cape Town'} className={input}>{['Cape Town', 'Johannesburg', 'Pretoria', 'Durban', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        {!user && <>
          <Field label="Full name"><input name="name" required minLength={2} defaultValue={details.current.name} autoComplete="name" className={input} placeholder="As it appears on your ID" /></Field>
          <Field label="Email"><input name="email" required type="email" defaultValue={details.current.email} autoComplete="email" className={input} placeholder="you@example.com" /></Field>
          <Field label="Mobile number"><input name="phone" required type="tel" defaultValue={details.current.phone} autoComplete="tel" className={input} placeholder="+27 82 000 0000" /></Field>
          <Field label="Create a password" hint="You'll use this to sign in to your driver dashboard."><input name="password" required minLength={8} type="password" defaultValue={details.current.password} autoComplete="new-password" className={input} placeholder="At least 8 characters, letters and numbers" /></Field>
        </>}
        {user && <p className="rounded-lg bg-[#edf2e3] p-3 text-sm">Applying as <b>{user.name}</b> ({user.email}).</p>}
      </> : <>
        <p className="text-[12px] leading-5 text-[#64725b]">PDF, JPG or PNG, up to 5 MB each. Documents are stored securely and only seen by the DROP onboarding team.</p>
        {DOCS.map(([name, label]) => <Field key={name} label={label}>
          <span className={`upload-zone relative flex min-h-14 items-center gap-3 rounded-lg border border-dashed px-4 text-sm ${files[name] ? 'border-forest bg-[#eef4e6]' : 'border-[#c9d3c0] bg-[#f7f8f4]'}`}>
            <Icon name={files[name] ? 'check' : 'upload'} size={18} /><span className="truncate">{files[name] || 'Choose a file'}</span>
            <input name={name} required type="file" accept=".pdf,.jpg,.jpeg,.png" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setFiles((f) => ({ ...f, [name]: e.target.files?.[0]?.name || '' }))} />
          </span>
        </Field>)}
        <Field label="Vehicle make, model & registration"><input name="vehicle" required minLength={3} className={input} placeholder="e.g. Toyota Corolla · CA 123-456" /></Field>
        <label className="flex items-start gap-3 text-sm leading-6"><input name="consent" required type="checkbox" className="mt-1.5 h-5 w-5 accent-forest" />I confirm these documents are mine and accurate. I understand programme participation is subject to eligibility and does not automatically grant shares or equity.</label>
      </>}
    </div>
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy}>{busy && <Spinner />}{step === 0 ? 'Continue to documents' : 'Submit application'}<Icon name="arrow" size={17} /></button>
    {step === 1 && <button type="button" className={outline} onClick={() => setStep(0)}>Back</button>}
  </form>;
}
