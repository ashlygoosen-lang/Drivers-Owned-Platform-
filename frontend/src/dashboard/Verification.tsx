import { useCallback, useEffect, useState } from 'react';
import { api, protectedBlobUrl, VERIFICATION_LABEL, type Requirement, type Verification, type VerificationDoc, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, input, limeButton, Field, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { Loading, type Notify } from './common';

const STEP_COPY: Record<string, { title: string; body: string }> = {
  not_started: { title: 'Verify your identity', body: 'DROP checks everyone who rides and drives with us. It takes about 3 minutes: add your details, upload your documents, and submit.' },
  in_progress: { title: 'Finish your verification', body: 'Complete the steps below and submit your documents for review.' },
  submitted: { title: 'Your documents are being reviewed', body: 'Our verification team usually responds within one working day. We’ll notify you here and by email.' },
  action_required: { title: 'Some documents need attention', body: 'Please check the notes below, upload new copies and submit again.' },
  verified: { title: 'You’re verified', body: 'Thank you for helping keep DROP safe. Keep your documents up to date to stay active.' },
};

/** Client-side mirror of the SA ID check, to fill in the date of birth as the user types. */
function dobFromSaId(n: string) {
  if (!/^\d{13}$/.test(n)) return '';
  const yy = Number(n.slice(0, 2)), year = yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy;
  const d = `${year}-${n.slice(2, 4)}-${n.slice(4, 6)}`;
  return Number.isNaN(Date.parse(d)) ? '' : d;
}

function DocViewer({ doc, onClose }: { doc: VerificationDoc; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let u = '';
    protectedBlobUrl(`/verification/documents/${doc.id}/file`).then((x) => { u = x; setUrl(x); }).catch((e) => setError(e.message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [doc.id]);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white">
      <div className="flex items-center justify-between border-b border-[#e3e8ef] px-5 py-3 text-sm"><b>{doc.originalName}</b><button onClick={onClose} aria-label="Close document" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-grey"><Icon name="close" /></button></div>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-[#eef1f5]">
        {error ? <ErrorText>{error}</ErrorText> : !url ? <Spinner /> : doc.mime === 'application/pdf' ? <iframe title={doc.originalName} src={url} className="h-full w-full" /> : <img src={url} alt={doc.originalName} className="max-h-full max-w-full object-contain" />}
      </div>
    </div>
  </div>;
}
export { DocViewer };

function DocCard({ req, doc, locked, onChange, notify }: { req: Requirement; doc?: VerificationDoc; locked: boolean; onChange: (v: Verification) => void; notify: Notify }) {
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(false);
  const canUpload = !doc || doc.status === 'rejected' || doc.status === 'expired' || (doc.status === 'pending' && !locked);
  const tone = !doc ? 'border-[#e3e8ef]' : doc.status === 'approved' ? 'border-[#bfe3cf] bg-[#f3faf6]' : doc.status === 'pending' ? 'border-[#e3e8ef]' : 'border-[#f3c2c2] bg-[#fff7f7]';

  async function upload() {
    if (!file) { setError('Choose a file first.'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('Files must be 8 MB or smaller.'); return; }
    const form = new FormData();
    form.append('type', req.type);
    if (req.expires) form.append('expiresAt', expiresAt);
    if (req.maxAgeDays) form.append('issuedAt', issuedAt);
    form.append('file', file);
    setBusy(true); setError('');
    try {
      const r = await api<{ verification: Verification }>('/verification/documents', { form });
      onChange(r.verification); setFile(null); notify(`${req.label} uploaded.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!doc) return;
    try { onChange((await api<{ verification: Verification }>(`/verification/documents/${doc.id}`, { method: 'DELETE' })).verification); } catch (e) { setError((e as Error).message); }
  }

  return <div className={`doc-card rounded-2xl border p-5 ${tone}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-semibold">{req.label}{req.required ? <span className="rounded-full bg-navy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Required</span> : <span className="rounded-full bg-grey px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#5b6b82]">Optional</span>}</p>
        <p className="mt-1 text-[13px] leading-5 text-[#5b6b82]">{req.hint}</p></div>
      {doc && <StatusPill status={doc.status === 'pending' ? 'awaiting review' : doc.status} />}
    </div>
    {doc && <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
      <span className="flex min-w-0 items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-[#e3e8ef]"><Icon name="file" size={16} /><span className="truncate">{doc.originalName}</span></span>
      {doc.expiresAt && <span className="text-[#5b6b82]">Expires {doc.expiresAt}</span>}
      <button className="font-semibold underline" onClick={() => setViewing(true)}>View</button>
      {doc.status === 'pending' && !locked && <button className="text-[#D93636] underline" onClick={remove}>Remove</button>}
    </div>}
    {doc?.reason && <p className="mt-3 rounded-lg bg-white p-3 text-[13px] text-[#a12424] ring-1 ring-[#f3c2c2]"><b>Reviewer note:</b> {doc.reason}</p>}
    {canUpload && <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3">
      <label className={`upload-zone relative flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 text-sm ${file ? 'border-orange bg-orange/5' : 'border-[#c7d0dc] bg-white hover:border-navy'}`}>
        <Icon name={file ? 'check' : 'upload'} size={18} /><span className="min-w-0 truncate">{file ? file.name : doc ? 'Upload a new copy' : `Choose file · ${req.imageOnly ? 'JPG or PNG' : 'PDF, JPG or PNG'} · max 8 MB`}</span>
        <input type="file" accept={req.imageOnly ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png'} capture={req.imageOnly ? 'user' : undefined} className="absolute inset-0 opacity-0" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }} />
      </label>
      {(req.expires || req.maxAgeDays) && <div className="grid gap-3 sm:grid-cols-2">
        {req.expires && <Field label="Expiry date on the document"><input type="date" className={input} value={expiresAt} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setExpiresAt(e.target.value)} /></Field>}
        {req.maxAgeDays && <Field label="Date on the document"><input type="date" className={input} value={issuedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setIssuedAt(e.target.value)} /></Field>}
      </div>}
      <ErrorText>{error}</ErrorText>
      <button className={`${button} w-fit`} disabled={busy || !file} onClick={upload}>{busy ? <Spinner /> : <Icon name="upload" size={16} />}Upload</button>
    </div>}
    {viewing && doc && <DocViewer doc={doc} onClose={() => setViewing(false)} />}
  </div>;
}

export function VerificationCentre({ notify, onDone }: { notify: Notify; onDone?: () => void }) {
  const { setUser, refresh } = useAuth();
  const [v, setV] = useState<Verification | null>(null);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [idType, setIdType] = useState<'sa_id' | 'passport'>('sa_id');

  const load = useCallback(async () => {
    try {
      const r = await api<{ verification: Verification; provinces: string[] }>('/verification');
      setV(r.verification); setProvinces(r.provinces); setIdType(r.verification.profile.idType || 'sa_id');
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const update = (next: Verification) => { setV(next); void refresh(); };

  if (error && !v) return <ErrorText>{error}</ErrorText>;
  if (!v) return <Loading />;
  const p = v.profile;
  const locked = v.status === 'submitted' || v.status === 'verified';
  const detailsDone = v.missingProfile.length === 0;
  const required = v.requirements.filter((r) => r.required);
  const docFor = (t: string) => v.documents.find((d) => d.type === t);
  const docsDone = required.every((r) => ['pending', 'approved'].includes(docFor(r.type)?.status || ''));
  const copy = STEP_COPY[v.status];

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    try { update((await api<{ verification: Verification }>('/verification/profile', { method: 'PUT', body: Object.fromEntries(new FormData(e.currentTarget)) })).verification); notify('Your details are saved.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError('');
    try {
      update((await api<{ verification: Verification }>('/verification/submit', { body: { consent } })).verification);
      const me = await api<{ user: User }>('/auth/me'); setUser(me.user);
      notify('Submitted. We’ll let you know as soon as your documents are reviewed.');
      onDone?.();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const steps = [['Your details', detailsDone], ['Documents', docsDone], ['Submit', !!v.submittedAt || v.status === 'verified']] as const;
  const dob = idType === 'sa_id' ? dobFromSaId(idNumber.replace(/\s/g, '')) : '';

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
    <div className={`rounded-2xl p-6 ${v.status === 'verified' ? 'bg-[#e8f5ee]' : v.status === 'action_required' ? 'bg-[#fff1e6]' : 'bg-navy text-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-xl"><p className={`text-[12px] font-bold uppercase tracking-[1.6px] ${v.status === 'verified' ? 'text-[#1E8E5A]' : 'text-orange'}`}>{VERIFICATION_LABEL[v.status]}</p><h4 className="mt-2 font-display text-2xl font-extrabold">{copy.title}</h4><p className={`mt-2 text-sm leading-6 ${v.status === 'verified' || v.status === 'action_required' ? 'text-[#3b4a60]' : 'text-[#c9d3e3]'}`}>{copy.body}</p>
        {v.decisionNote && v.status === 'action_required' && <p className="mt-3 rounded-lg bg-white p-3 text-sm text-navy"><b>Note from our team:</b> {v.decisionNote}</p>}</div>
        <Icon name={v.status === 'verified' ? 'check' : 'shield'} size={40} className={v.status === 'verified' ? 'text-[#1E8E5A]' : 'text-orange'} /></div>
      <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Verification steps">{steps.map(([label, done], i) => <li key={label} className="grid gap-2 text-[12px] font-semibold"><span className={`h-1.5 rounded-full ${done ? 'bg-orange' : v.status === 'verified' || v.status === 'action_required' ? 'bg-black/10' : 'bg-white/20'}`} />{i + 1}. {label}</li>)}</ol>
    </div>

    <section className="rounded-2xl border border-[#e3e8ef] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3"><h4 className="font-display text-lg font-extrabold">1. Your details</h4>{detailsDone && <StatusPill status="complete" />}</div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProfile} key={v.status}>
        <fieldset disabled={locked} className="contents">
          {v.role === 'business' && <>
            <Field label="Registered company name"><input name="companyName" required defaultValue={p.companyName} className={input} /></Field>
            <Field label="Company registration number" hint="As on your CIPC certificate, e.g. 2018/079316/07"><input name="registrationNumber" required defaultValue={p.registrationNumber} className={input} placeholder="YYYY/NNNNNN/NN" /></Field>
            <Field label="VAT number (optional)"><input name="vatNumber" defaultValue={p.vatNumber} className={input} /></Field>
            <p className="self-end text-[13px] text-[#5b6b82] sm:col-span-1">The person details below are for the authorised representative of the business.</p>
          </>}
          <Field label="Full legal name" hint="Exactly as it appears on your ID or passport"><input name="legalName" required defaultValue={p.legalName} autoComplete="name" className={input} /></Field>
          <Field label="Identity document"><select name="idType" value={idType} onChange={(e) => setIdType(e.target.value as 'sa_id' | 'passport')} className={input}><option value="sa_id">South African ID</option><option value="passport">Passport (foreign nationals)</option></select></Field>
          <Field label={idType === 'sa_id' ? 'SA ID number' : 'Passport number'} hint={locked ? undefined : 'Stored securely and only visible to our verification team.'}><input name="idNumber" required={!p.idNumber || p.idType !== idType} defaultValue={locked ? p.idNumber : ''} placeholder={p.idNumber ? `Saved: ${p.idNumber}` : idType === 'sa_id' ? '13 digits' : 'Letters and numbers'} inputMode={idType === 'sa_id' ? 'numeric' : 'text'} maxLength={idType === 'sa_id' ? 13 : 20} onChange={(e) => setIdNumber(e.target.value)} className={input} /></Field>
          <Field label="Date of birth" hint={idType === 'sa_id' ? 'Filled in from your ID number' : undefined}><input name="dateOfBirth" type="date" required={idType === 'passport'} readOnly={idType === 'sa_id'} value={idType === 'sa_id' ? (dob || p.dateOfBirth || '') : undefined} defaultValue={idType === 'passport' ? p.dateOfBirth : undefined} className={input} /></Field>
          <Field label="Nationality"><input name="nationality" required defaultValue={p.nationality || (idType === 'sa_id' ? 'South African' : '')} className={input} /></Field>
          <div className="sm:col-span-2"><p className="mb-2 mt-2 text-sm font-semibold">{v.role === 'business' ? 'Business address' : 'Residential address'} <span className="font-normal text-[#5b6b82]">· must match your proof of address</span></p></div>
          <Field label="Street address"><input name="addressLine1" required defaultValue={p.addressLine1} autoComplete="address-line1" className={input} /></Field>
          <Field label="Complex, unit (optional)"><input name="addressLine2" defaultValue={p.addressLine2} autoComplete="address-line2" className={input} /></Field>
          <Field label="Suburb"><input name="suburb" defaultValue={p.suburb} className={input} /></Field>
          <Field label="City or town"><input name="city" required defaultValue={p.city} autoComplete="address-level2" className={input} /></Field>
          <Field label="Province"><select name="province" required defaultValue={p.province || ''} className={input}><option value="" disabled>Choose…</option>{provinces.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Postal code"><input name="postalCode" required defaultValue={p.postalCode} inputMode="numeric" maxLength={4} autoComplete="postal-code" className={input} /></Field>
          {v.role !== 'business' && <>
            <div className="sm:col-span-2"><p className="mb-2 mt-2 text-sm font-semibold">Emergency contact {v.role === 'driver' ? '' : <span className="font-normal text-[#5b6b82]">(optional)</span>}</p></div>
            <Field label="Name"><input name="emergencyName" required={v.role === 'driver'} defaultValue={p.emergencyName} className={input} /></Field>
            <Field label="Mobile number"><input name="emergencyPhone" type="tel" required={v.role === 'driver'} defaultValue={p.emergencyPhone} className={input} /></Field>
          </>}
          {!locked && <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button className={button} disabled={busy}>{busy && <Spinner />}{detailsDone ? 'Update details' : 'Save details'}</button>{v.missingProfile.length > 0 && v.missingProfile.length < 9 && <span className="text-[13px] text-[#5b6b82]">Still needed: {v.missingProfile.length} field{v.missingProfile.length > 1 ? 's' : ''}</span>}</div>}
        </fieldset>
      </form>
      {locked && <p className="mt-4 text-[13px] text-[#5b6b82]">Your details are locked while {v.status === 'verified' ? 'verified' : 'under review'}. Contact support if something has changed.</p>}
    </section>

    <section className="rounded-2xl border border-[#e3e8ef] p-5 sm:p-6">
      <div className="mb-2 flex items-center justify-between gap-3"><h4 className="font-display text-lg font-extrabold">2. Documents</h4>{docsDone && <StatusPill status="complete" />}</div>
      <p className="mb-5 text-[13px] leading-5 text-[#5b6b82]">Clear colour scans or photos, all four corners visible, nothing covered. Files are encrypted and only seen by DROP’s verification team.</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">{v.requirements.map((r) => <DocCard key={r.type} req={r} doc={docFor(r.type)} locked={locked} onChange={update} notify={notify} />)}</div>
    </section>

    {v.status !== 'verified' && <section className="rounded-2xl border border-[#e3e8ef] p-5 sm:p-6">
      <h4 className="mb-4 font-display text-lg font-extrabold">3. Review and submit</h4>
      {v.status === 'submitted' ? <p className="text-sm text-[#3b4a60]">Submitted on {new Date(v.submittedAt!).toLocaleString('en-ZA')}. We’ll notify you when the review is complete. If a document is rejected you can replace it here and it goes straight back to the reviewer.</p> : <>
        <ul className="mb-5 grid gap-2 text-sm">{[['Personal details complete', detailsDone], ...required.map((r) => [r.label, ['pending', 'approved'].includes(docFor(r.type)?.status || '')] as const)].map(([l, ok]) => <li key={l as string} className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok ? 'bg-[#1E8E5A] text-white' : 'bg-grey text-[#8a97a8] ring-1 ring-[#d5dce6]'}`}>{ok ? <Icon name="check" size={12} /> : ''}</span>{l as string}</li>)}</ul>
        <label className="mb-5 flex items-start gap-3 rounded-xl bg-grey p-4 text-[13px] leading-5"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#FF6B00]" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I confirm that the information and documents I have provided are true, belong to me{v.role === 'business' ? ' or the business I am authorised to represent' : ''}, and are not altered. I consent to DROP processing this personal information to verify my identity, in line with the Protection of Personal Information Act (POPIA) and the DROP privacy policy.</span></label>
        <ErrorText>{error}</ErrorText>
        <button className={limeButton} disabled={busy || !detailsDone || !docsDone || !consent} onClick={submit}>{busy && <Spinner />}Submit for verification <Icon name="arrow" size={16} /></button>
      </>}
    </section>}
    {error && v.status === 'verified' && <ErrorText>{error}</ErrorText>}
    {v.history.length > 0 && <details className="rounded-2xl border border-[#e3e8ef] p-5 text-sm"><summary className="cursor-pointer font-semibold">Verification history</summary><ol className="mt-3 grid gap-2">{v.history.slice().reverse().map((h, i) => <li key={i} className="flex flex-wrap gap-2"><StatusPill status={h.status.replace('_', ' ')} /><span className="text-[#5b6b82]">{new Date(h.at).toLocaleString('en-ZA')}{h.by ? ` · ${h.by}` : ''}</span>{h.note && <span>“{h.note}”</span>}</li>)}</ol></details>}
  </div>;
}

/** Compact prompt shown on dashboards and in flows that need verification. */
export function VerificationBanner({ status, onOpen }: { status?: string; onOpen: () => void }) {
  if (!status || status === 'verified') return null;
  const s = status as keyof typeof STEP_COPY;
  return <div className={`mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 ${s === 'action_required' ? 'bg-[#fff1e6]' : s === 'submitted' ? 'bg-grey' : 'bg-navy text-white'}`}>
    <div className="flex items-center gap-4"><Icon name="shield" size={28} className="text-orange" /><div><p className="font-semibold">{STEP_COPY[s]?.title}</p><p className={`text-[13px] ${s === 'not_started' || s === 'in_progress' ? 'text-[#c9d3e3]' : 'text-[#5b6b82]'}`}>{STEP_COPY[s]?.body}</p></div></div>
    {s !== 'submitted' && <button className={s === 'action_required' ? button : limeButton} onClick={onOpen}>{s === 'not_started' ? 'Start verification' : s === 'action_required' ? 'Fix documents' : 'Continue'} <Icon name="arrow" size={16} /></button>}
    {s === 'submitted' && <button className={outline} onClick={onOpen}>View status</button>}
  </div>;
}
