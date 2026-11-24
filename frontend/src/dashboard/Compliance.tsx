import { useEffect, useState } from 'react';
import { api, date, protectedBlobUrl, VERIFICATION_LABEL, type Application, type AuditEntry, type QueueItem, type User, type Verification, type VerificationDoc, type VerificationStatus } from '../lib/api';
import { button, outline, limeButton, input, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { Empty, Loading, Table, useLoad, type Notify } from './common';

const QUICK_REASONS = ['Image is blurry or unreadable', 'Document is cut off: all four corners must be visible', 'Name does not match the ID document', 'Document has expired', 'Proof of address is older than 3 months', 'Wrong document type uploaded', 'Selfie does not clearly show your face and ID'];

function Preview({ doc }: { doc: VerificationDoc }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let u = ''; setUrl(''); setError('');
    protectedBlobUrl(`/verification/documents/${doc.id}/file`).then((x) => { u = x; setUrl(x); }).catch((e) => setError(e.message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [doc.id]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!url) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return doc.mime === 'application/pdf'
    ? <iframe title={doc.originalName} src={url} className="h-full min-h-[480px] w-full rounded-lg bg-white" />
    : <a href={url} target="_blank" rel="noopener" className="block h-full"><img src={url} alt={doc.originalName} className="mx-auto max-h-[560px] rounded-lg object-contain" /></a>;
}

function Reviewer({ userId, onBack, notify }: { userId: string; onBack: () => void; notify: Notify }) {
  const [data, setData] = useState<{ verification: Verification; user: User; application: Application | null; archived: VerificationDoc[] } | null>(null);
  const [active, setActive] = useState<string>('');
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { const r = await api<NonNullable<typeof data>>(`/compliance/verifications/${userId}`); setData(r); setActive((a) => a || r.verification.documents[0]?.id || ''); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);
  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const v = data.verification;
  const doc = v.documents.find((d) => d.id === active);
  const label = (t: string) => v.requirements.find((r) => r.type === t)?.label || t;
  const p = v.profile;

  async function review(decision: 'approved' | 'rejected') {
    if (!doc) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ verification: Verification }>(`/compliance/documents/${doc.id}/review`, { body: { decision, reason, ...(expiry && { expiresAt: expiry }) } });
      setData({ ...data!, verification: r.verification }); setReason(''); setExpiry('');
      const next = r.verification.documents.find((d) => d.status === 'pending');
      if (next) setActive(next.id);
      notify(`${label(doc.type)} ${decision}.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function decide(decision: 'approve' | 'request_changes') {
    setBusy(true); setError('');
    try {
      const r = await api<{ verification: Verification }>(`/compliance/verifications/${userId}/decision`, { body: { decision, note } });
      setData({ ...data!, verification: r.verification }); setNote('');
      notify(decision === 'approve' ? `${p.legalName} is verified.` : 'Changes requested. The customer has been notified.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const missingRequired = v.requirements.filter((r) => r.required && !v.documents.some((d) => d.type === r.type));

  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><button className="flex min-h-10 items-center gap-2 text-sm font-semibold" onClick={onBack}><Icon name="arrow" size={16} className="rotate-180" />Back to queue</button><StatusPill status={VERIFICATION_LABEL[v.status]} /></div>
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <aside className="grid content-start gap-4">
        <div className="rounded-2xl bg-grey p-5 text-sm">
          <p className="font-display text-lg font-extrabold">{p.legalName || data.user.name}</p>
          <p className="mb-3 text-[#5b6b82]"><span className="capitalize">{v.role}</span> · {data.user.email}{data.user.phone && ` · ${data.user.phone}`}</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13px]">
            {v.role === 'business' && <><dt className="text-[#5b6b82]">Company</dt><dd>{p.companyName}</dd><dt className="text-[#5b6b82]">Reg. no.</dt><dd>{p.registrationNumber}</dd>{p.vatNumber && <><dt className="text-[#5b6b82]">VAT</dt><dd>{p.vatNumber}</dd></>}</>}
            <dt className="text-[#5b6b82]">{p.idType === 'passport' ? 'Passport' : 'SA ID'}</dt><dd className="font-mono">{p.idNumber || '—'}</dd>
            <dt className="text-[#5b6b82]">Date of birth</dt><dd>{p.dateOfBirth || '—'}</dd>
            <dt className="text-[#5b6b82]">Nationality</dt><dd>{p.nationality || '—'}</dd>
            <dt className="text-[#5b6b82]">Address</dt><dd>{[p.addressLine1, p.addressLine2, p.suburb, p.city, p.province, p.postalCode].filter(Boolean).join(', ') || '—'}</dd>
            {p.emergencyName && <><dt className="text-[#5b6b82]">Emergency</dt><dd>{p.emergencyName} · {p.emergencyPhone}</dd></>}
            <dt className="text-[#5b6b82]">Submitted</dt><dd>{v.submittedAt ? date(v.submittedAt) : 'Not yet'}</dd>
          </dl>
          {data.application && <div className="mt-4 border-t border-[#dfe5ec] pt-3 text-[13px]"><b>Driver application {data.application.ref}</b><br />{data.application.participation} · {data.application.vehicle}{data.application.city && ` · ${data.application.city}`}</div>}
        </div>
        <div className="grid gap-2">{v.documents.map((d) => <button key={d.id} onClick={() => { setActive(d.id); setReason(''); setExpiry(''); }} className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left text-sm ${active === d.id ? 'border-orange bg-orange/5' : 'border-[#e3e8ef] hover:border-navy'}`}><span className="min-w-0"><b className="block truncate">{label(d.type)}</b><span className="text-[12px] text-[#5b6b82]">{d.expiresAt ? `Expires ${d.expiresAt}` : d.issuedAt ? `Dated ${d.issuedAt}` : date(d.uploadedAt)}</span></span><StatusPill status={d.status} /></button>)}
          {missingRequired.map((r) => <p key={r.type} className="rounded-xl border border-dashed border-[#e3e8ef] p-3 text-[13px] text-[#5b6b82]">{r.label}: not uploaded</p>)}</div>
      </aside>
      <section className="grid content-start gap-4">
        {doc ? <>
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-display text-lg font-extrabold">{label(doc.type)}</h4><span className="text-[12px] text-[#5b6b82]">{doc.originalName} · {(doc.size / 1024).toFixed(0)} KB · uploaded {date(doc.uploadedAt)}{doc.reviewedBy && ` · reviewed by ${doc.reviewedBy}`}</span></div>
          <div className="min-h-[480px] rounded-2xl bg-[#eef1f5] p-3"><Preview doc={doc} /></div>
          {doc.reason && <p className="rounded-lg bg-[#fff7f7] p-3 text-[13px] text-[#a12424]">Previous note: {doc.reason}</p>}
          <div className="grid gap-3 rounded-2xl border border-[#e3e8ef] p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_200px]">
              <label className="grid gap-1 text-sm">Reason (required to reject; shown to the customer)<textarea className={`${input} min-h-20 py-3`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The image is blurry, please upload a clearer photo." /></label>
              <label className="grid gap-1 text-sm">Correct expiry date<input type="date" className={input} value={expiry || doc.expiresAt || ''} onChange={(e) => setExpiry(e.target.value)} /></label>
            </div>
            <div className="flex flex-wrap gap-2">{QUICK_REASONS.map((r) => <button key={r} className="rounded-full bg-grey px-3 py-1.5 text-[12px] hover:bg-[#e6ebf2]" onClick={() => setReason(r)}>{r}</button>)}</div>
            <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={() => review('approved')}><Icon name="check" size={16} />Approve document</button><button className={`${outline} border-[#f3c2c2] text-[#a12424]`} disabled={busy || reason.trim().length < 5} onClick={() => review('rejected')}>Reject document</button></div>
          </div>
        </> : <Empty>No documents uploaded yet.</Empty>}
        <div className="grid gap-3 rounded-2xl bg-navy p-5 text-white">
          <h4 className="font-display text-lg font-extrabold">Final decision</h4>
          <p className="text-[13px] text-[#c9d3e3]">Approve once every required document is approved{v.role === 'driver' ? '. This activates the driver.' : '.'} Request changes to send the file back with a note.</p>
          <textarea className="min-h-16 rounded-xl border border-white/20 bg-white/5 p-3 text-sm text-white placeholder:text-white/50" placeholder="Note to the customer (required when requesting changes)" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-3"><button className={limeButton} disabled={busy || v.status === 'verified'} onClick={() => decide('approve')}>Approve and verify</button><button className="motion-button inline-flex min-h-12 items-center rounded-xl border border-white/25 px-6 text-sm font-semibold hover:bg-white/10 disabled:opacity-50" disabled={busy || note.trim().length < 5} onClick={() => decide('request_changes')}>Request changes</button></div>
        </div>
        {data.archived.length > 0 && <details className="rounded-2xl border border-[#e3e8ef] p-4 text-sm"><summary className="cursor-pointer font-semibold">Earlier uploads ({data.archived.length})</summary><ul className="mt-3 grid gap-1 text-[13px]">{data.archived.map((d) => <li key={d.id}>{label(d.type)} · {date(d.uploadedAt)} · <StatusPill status={d.status} />{d.reason && ` · ${d.reason}`}</li>)}</ul></details>}
      </section>
    </div>
  </div>;
}

export function VerificationQueue({ notify, initialUser = '' }: { notify: Notify; initialUser?: string }) {
  const [status, setStatus] = useState<VerificationStatus | 'all'>('submitted');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(initialUser);
  const { data, error, reload } = useLoad<{ queue: QueueItem[]; counts: Record<string, number> }>(`/compliance/queue?${new URLSearchParams({ status, ...(role && { role }), ...(q && { q }) })}`);
  if (open) return <Reviewer userId={open} notify={notify} onBack={() => { setOpen(''); void reload(); }} />;
  const tabs: [VerificationStatus | 'all', string][] = [['submitted', 'Awaiting review'], ['action_required', 'Waiting on customer'], ['verified', 'Verified'], ['in_progress', 'In progress'], ['all', 'All']];
  return <div className="grid gap-4">
    <div className="flex flex-wrap gap-2">{tabs.map(([s, l]) => <button key={s} onClick={() => setStatus(s)} className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${status === s ? 'bg-navy text-white' : 'bg-grey text-navy hover:bg-[#e6ebf2]'}`}>{l}{s !== 'all' && data?.counts[s] !== undefined && <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${status === s ? 'bg-orange text-navy' : 'bg-white'}`}>{data.counts[s]}</span>}</button>)}</div>
    <div className="flex flex-wrap gap-3"><input className={`${input} max-w-sm`} placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search verifications" /><select className={`${input} max-w-[200px]`} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by account type"><option value="">All account types</option><option value="driver">Drivers</option><option value="passenger">Passengers</option><option value="business">Businesses</option></select></div>
    {error ? <ErrorText>{error}</ErrorText> : !data ? <Loading /> : !data.queue.length ? <Empty>{status === 'submitted' ? 'Nothing waiting for review. Nice work.' : 'No verifications in this view.'}</Empty> :
      <Table head={['Name', 'Account', 'Documents', 'Submitted', 'Status', '']} rows={data.queue.map((i) => [
        <span key="n"><b>{i.name}</b><span className="block text-[12px] text-[#5b6b82]">{i.email}</span></span>,
        <span key="r" className="capitalize">{i.role}</span>,
        <span key="d">{i.documents.total} uploaded{i.documents.pending ? ` · ${i.documents.pending} to review` : ''}{i.documents.rejected ? ` · ${i.documents.rejected} rejected` : ''}</span>,
        i.submittedAt ? date(i.submittedAt) : '—',
        <StatusPill key="s" status={VERIFICATION_LABEL[i.status]} />,
        <button key="o" className={`${button} min-h-9 px-4`} onClick={() => setOpen(i.userId)}>Review</button>,
      ])} />}
  </div>;
}

export function ExpiringDocuments({ notify }: { notify: Notify }) {
  const [days, setDays] = useState(30);
  const { data } = useLoad<{ documents: { userId: string; name: string; email: string; role: string; label: string; expiresAt: string; status: string }[] }>(`/compliance/expiring?days=${days}`);
  return <div className="grid gap-4">
    <select className={`${input} max-w-[220px]`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window"><option value={7}>Next 7 days</option><option value={30}>Next 30 days</option><option value={90}>Next 90 days</option></select>
    {!data ? <Loading /> : !data.documents.length ? <Empty>No approved documents expire in this window.</Empty> : <Table head={['Person', 'Document', 'Expires', 'Status', '']} rows={data.documents.map((d) => [
      <span key="n"><b>{d.name}</b><span className="block text-[12px] capitalize text-[#5b6b82]">{d.role} · {d.email}</span></span>, d.label, d.expiresAt, <StatusPill key="s" status={d.status} />,
      <button key="r" className="text-sm font-semibold underline" onClick={async () => { await api(`/compliance/remind/${d.userId}`, { body: { message: `Your ${d.label.toLowerCase()} expires on ${d.expiresAt}. Please upload a current copy in the Verification tab to stay active on DROP.` } }); notify(`Reminder sent to ${d.name}.`); }}>Send reminder</button>,
    ])} />}
  </div>;
}

const ACTIONS: Record<string, string> = { 'verification.viewed': 'Opened file', 'document.approved': 'Approved document', 'document.rejected': 'Rejected document', 'verification.approved': 'Verified account', 'verification.changes_requested': 'Requested changes', 'verification.reminder_sent': 'Sent expiry reminder' };
export function AuditLog() {
  const { data } = useLoad<{ entries: AuditEntry[] }>('/compliance/audit');
  if (!data) return <Loading />;
  if (!data.entries.length) return <Empty>No review activity yet.</Empty>;
  return <Table head={['When', 'Staff member', 'Action', 'Customer', 'Detail']} rows={data.entries.map((e) => [date(e.at), <span key="a">{e.actorName}<span className="block text-[12px] capitalize text-[#5b6b82]">{e.actorRole}</span></span>, ACTIONS[e.action] || e.action, e.subjectName, [e.detail?.type?.replace(/_/g, ' '), e.detail?.reason || e.detail?.note].filter(Boolean).join(' · ')])} />;
}
