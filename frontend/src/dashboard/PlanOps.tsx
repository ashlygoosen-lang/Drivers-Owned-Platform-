import { useEffect, useRef, useState } from 'react';
import { api, money, token, BASE } from '../lib/api';
import { button, outline, input, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { Loading, Empty, type Notify } from './common';
import { Calendar, type PlanStats } from './PlanDashboard';
import type { Plan } from './Plans';

/**
 * Operations console for monthly plans (admin, support, finance): portfolio KPIs, plans at risk,
 * search and filters, and a plan file with trips, money and history. Admin and support can assign or
 * reassign a driver (only vetted, clash-free drivers for scholar plans) and cancel for a customer.
 */
type OpsPlan = Plan & { stats: Omit<PlanStats, 'byDate'>; owner?: { name: string } };
interface OpsData {
  kpis: { active: number; awaitingDriver: number; awaitingPayment: number; scholar: number; staff: number; tripsToday: number; escrowHeld: number; refundsFailing: number };
  risks: { id: string; ref: string; kind: string; status: string; startDate: string; reason: string }[];
  plans: OpsPlan[];
}
interface Detail {
  plan: Plan & { stats: PlanStats; usedAmount: number | null; refundError: string | null; refundFailures: number; closedAt: string | null; cancelReason: string; history: { status: string; at: string; note?: string }[] };
  owner: { id: string; name: string; email: string; phone: string; company: string } | null;
  trips: { id: string; ref: string; date: string; leg: string; status: string; fare: number; driver: string | null; scheduledFor: string; startedAt: string | null }[];
}
interface Candidate { id: string; name: string; vehicle: string; rating: number | null; online: boolean; plans: number; distanceKm: number | null }
const STATUS: Record<string, string> = { awaiting_payment: 'Awaiting payment', awaiting_driver: 'Finding a driver', active: 'Active', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired' };
const short = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function PlanOps({ notify, canWrite }: { notify: Notify; canWrite: boolean }) {
  const [filters, setFilters] = useState({ q: '', status: '', kind: '' });
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    try { setData(await api<OpsData>(`/admin/plans${qs ? `?${qs}` : ''}`)); setError(''); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  if (openId) return <PlanFile id={openId} canWrite={canWrite} notify={notify} onBack={() => { setOpenId(null); void load(); }} />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const k = data.kpis;
  return <div className="grid gap-6">
    <header><h3 className="font-display text-2xl font-extrabold text-navy">Monthly plans</h3><p className="text-sm text-[#536175]">Scholar and staff transport across all customers.</p></header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Active plans" value={k.active} sub={`${k.scholar} scholar · ${k.staff} staff (incl. matching)`} />
      <Stat label="Finding a driver" value={k.awaitingDriver} sub="need matching" tone={k.awaitingDriver ? 'warn' : undefined} />
      <Stat label="Plan trips today" value={k.tripsToday} sub={`${k.awaitingPayment} plan(s) awaiting payment`} />
      <Stat label="Held for unused trips" value={money(k.escrowHeld)} sub={k.refundsFailing ? `${k.refundsFailing} refund(s) failing` : 'refunds healthy'} tone={k.refundsFailing ? 'bad' : undefined} />
    </div>

    {data.risks.length > 0 && <section className="rounded-2xl border border-[#f3c9a6] bg-[#fff8f2] p-5">
      <h4 className="mb-3 flex items-center gap-2 font-semibold text-[#8a3a00]"><Icon name="shield" size={18} />Needs attention ({data.risks.length})</h4>
      <ul className="grid gap-2">{data.risks.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm">
        <span><b>{r.ref}</b> · {r.kind === 'scholar' ? 'Scholar' : 'Staff'} · {r.reason}</span>
        <button className="font-semibold underline" onClick={() => setOpenId(r.id)}>Open</button></li>)}</ul>
    </section>}

    <section className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_200px]">
        <input className={input} placeholder="Search ref, school, address, customer or driver" aria-label="Search plans" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select className={input} aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className={input} aria-label="Type" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}><option value="">Scholar and staff</option><option value="scholar">Scholar transport</option><option value="staff">Staff transport</option></select>
      </div>
      {!data.plans.length ? <Empty>No plans match.</Empty> : <div className="overflow-x-auto rounded-2xl border border-[#d2dae4] bg-white"><table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr className="border-b border-[#e1e6ed] text-[12px] uppercase tracking-wide text-[#5b6b82]"><th className="p-3">Plan</th><th className="p-3">Customer</th><th className="p-3">Period</th><th className="p-3">Driver</th><th className="p-3">Trips</th><th className="p-3">Amount</th><th className="p-3">Status</th></tr></thead>
        <tbody>{data.plans.map((p) => <tr key={p.id} className="cursor-pointer border-b border-[#eef1f5] hover:bg-[#f7f9fb]" onClick={() => setOpenId(p.id)}>
          <td className="p-3"><b>{p.ref}</b><span className="block text-[12px] text-[#5b6b82]">{p.kindLabel} · {p.kind === 'scholar' ? p.school : p.destination}</span></td>
          <td className="p-3">{p.owner?.name || '—'}</td>
          <td className="p-3">{short(p.startDate)} – {short(p.endDate)}<span className="block text-[12px] text-[#5b6b82]">{p.legs.map((l) => l.time).join(' & ')}</span></td>
          <td className="p-3">{p.driver?.name || <span className="font-semibold text-[#b34a00]">None</span>}</td>
          <td className="p-3">{p.stats.tripsDriven}/{p.stats.tripsPlanned}<span className="block text-[12px] text-[#5b6b82]">{p.stats.onTimeRate == null ? 'no pickups yet' : `${p.stats.onTimeRate}% on time`}</span></td>
          <td className="p-3">{money(p.pricing.total)}<span className="block text-[12px] text-[#5b6b82]">{p.payment === 'Card' ? p.paymentStatus.replace(/_/g, ' ') : 'invoiced'}</span></td>
          <td className="p-3"><StatusPill status={STATUS[p.status] || p.status} /></td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub: string; tone?: 'warn' | 'bad' }) {
  return <div className="rounded-xl border border-[#dde3eb] bg-white p-4"><p className="text-[12px] font-semibold uppercase tracking-wide text-[#5b6b82]">{label}</p>
    <p className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${tone === 'bad' ? 'text-[#b42828]' : tone === 'warn' ? 'text-[#b34a00]' : 'text-navy'}`}>{value}</p><p className="text-[12px] text-[#5b6b82]">{sub}</p></div>;
}

function PlanFile({ id, canWrite, notify, onBack }: { id: string; canWrite: boolean; notify: Notify; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState({ driverId: '', reason: '' });
  const [cancel, setCancel] = useState<{ reason: string; immediate: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setD(await api<Detail>(`/admin/plans/${id}`)); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }); }, [id, Boolean(d)]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!d) return <Loading />;
  const p = d.plan;
  const open = ['awaiting_driver', 'active', 'awaiting_payment'].includes(p.status);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); notify(done); setAssigning(null); setCancel(null); await load(); } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const statement = async () => {
    const res = await fetch(`${BASE}/plans/${p.id}/statement.csv`, { headers: { authorization: `Bearer ${token.get()}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `${p.ref}-statement.csv` }).click();
  };
  return <div ref={top} className="grid scroll-mt-4 gap-5">
    <button className="justify-self-start text-sm font-semibold underline" onClick={onBack}>← All plans</button>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[12px] font-semibold uppercase tracking-wide text-[#5b6b82]">{p.ref} · {p.kindLabel}</p><h3 className="font-display text-2xl font-extrabold text-navy">{p.kind === 'scholar' ? p.school : `${p.pickup} → ${p.destination}`}</h3>
        <p className="text-sm text-[#536175]">{short(p.startDate)} – {short(p.endDate)} · {p.legs.map((l) => `${l.time} ${l.label}`).join(' · ')}</p></div>
      <StatusPill status={STATUS[p.status] || p.status} />
    </header>
    {p.refundFailures > 0 && <p className="rounded-xl bg-[#fdecec] p-4 text-sm text-[#b42828]"><b>Refund failing</b> after {p.refundFailures} attempts: {p.refundError}. The system retries every 30 minutes; check Paystack if this persists.</p>}
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="grid content-start gap-3 rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm">
        <h4 className="font-semibold">Customer</h4>
        {d.owner ? <p><b>{d.owner.company || d.owner.name}</b>{d.owner.company && <span className="block">{d.owner.name}</span>}<span className="block">{d.owner.email}</span><span className="block">{d.owner.phone}</span></p> : <p>—</p>}
        <h4 className="mt-2 font-semibold">{p.kind === 'scholar' ? 'Learners' : 'Staff'}</h4>
        <ul>{(p.riders || []).map((r) => <li key={r.name}>{r.name}{r.grade ? ` · ${r.grade}` : ''}{r.notes ? ` — ${r.notes}` : ''}</li>)}</ul>
        {p.guardian && <p><b>Consent:</b> {p.guardian.relationship}{p.guardian.consentAt ? `, ${when(p.guardian.consentAt)}` : ''}<br /><b>Handover:</b> {p.guardian.handover}<br /><b>Emergency:</b> {p.guardian.emergencyName} · {p.guardian.emergencyPhone}</p>}
      </section>
      <section className="grid content-start gap-3 rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm">
        <h4 className="font-semibold">Driver</h4>
        <p>{p.driver ? <><b>{p.driver.name}</b><span className="block">{p.driver.vehicle}{p.driver.rating ? ` · ★ ${p.driver.rating}` : ''}</span></> : <span className="font-semibold text-[#b34a00]">No driver assigned</span>}</p>
        {canWrite && open && !assigning && <button className={outline} onClick={() => api<{ candidates: Candidate[] }>(`/admin/plans/${p.id}/candidates`).then((r) => setAssigning(r.candidates)).catch((e) => notify((e as Error).message))}>{p.driver ? 'Reassign driver' : 'Assign a driver'}</button>}
        {assigning && <div className="grid gap-2">
          <p className="text-[12px] text-[#536175]">{p.kind === 'scholar' ? 'Only drivers vetted for scholar transport, without a clashing plan, are listed.' : 'Approved drivers without a clashing plan, nearest first.'}</p>
          {!assigning.length ? <Empty>{p.kind === 'scholar' ? 'No vetted scholar-transport driver is free at these times. Trips are still offered to vetted drivers nearby each day.' : 'No approved driver is free at these times.'}</Empty> : <ul className="grid max-h-64 gap-1 overflow-y-auto">{assigning.map((c) => <li key={c.id}><label className={`flex cursor-pointer items-center gap-2 rounded-lg p-2 ${pick.driverId === c.id ? 'bg-[#eef2f7]' : ''}`}>
            <input type="radio" name="driver" checked={pick.driverId === c.id} onChange={() => setPick({ ...pick, driverId: c.id })} />
            <span><b>{c.name}</b> {c.online && <span className="text-[#17744a]">● online</span>}<span className="block text-[12px] text-[#536175]">{c.vehicle}{c.rating ? ` · ★ ${c.rating}` : ''}{c.distanceKm != null ? ` · ${c.distanceKm} km` : ''} · {c.plans} plan(s)</span></span></label></li>)}</ul>}
          {assigning.length > 0 && <input className={input} placeholder="Reason (recorded in the audit log)" value={pick.reason} onChange={(e) => setPick({ ...pick, reason: e.target.value })} />}
          <div className="flex gap-2">{assigning.length > 0 && <button className={button} disabled={busy || !pick.driverId || pick.reason.trim().length < 3} onClick={() => act(() => api(`/admin/plans/${p.id}/assign`, { body: pick }), 'Driver assigned. Driver and customer notified.')}>{busy && <Spinner />}Assign</button>}<button className={outline} onClick={() => setAssigning(null)}>Close</button></div>
        </div>}
      </section>
      <section className="grid content-start gap-2 rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm">
        <h4 className="font-semibold">Money</h4>
        <dl className="grid grid-cols-2 gap-y-1">
          <dt className="text-[#536175]">Price</dt><dd className="text-right font-semibold">{money(p.pricing.total)}</dd>
          <dt className="text-[#536175]">Payment</dt><dd className="text-right font-semibold">{p.payment === 'Card' ? p.paymentStatus.replace(/_/g, ' ') : 'Business invoice'}</dd>
          <dt className="text-[#536175]">Driven</dt><dd className="text-right font-semibold">{p.stats.tripsDriven} trips · {money(p.stats.spent)}</dd>
          <dt className="text-[#536175]">Refunded</dt><dd className="text-right font-semibold">{money(p.refundedAmount || 0)}</dd>
          <dt className="text-[#536175]">Closed</dt><dd className="text-right font-semibold">{p.closedAt ? when(p.closedAt) : 'Open'}</dd>
        </dl>
        <button className={`${outline} mt-2`} onClick={() => void statement()}>Statement (CSV)</button>
      </section>
    </div>
    <section className="rounded-2xl border border-[#d2dae4] bg-white p-5"><h4 className="mb-3 font-semibold">Calendar</h4><div className="max-w-xl"><Calendar plan={p} /></div></section>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm"><h4 className="mb-3 font-semibold">Trips</h4>
        {!d.trips.length ? <Empty>No trips generated yet.</Empty> : <ul className="grid max-h-80 gap-1 overflow-y-auto">{d.trips.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 border-b border-[#eef1f5] py-2">
          <span><b>{short(t.date)}</b> {t.leg === 'out' ? 'Morning' : 'Return'} · {t.ref}<span className="block text-[12px] text-[#536175]">{t.driver || 'no driver'}{t.startedAt ? ` · picked up ${when(t.startedAt)}` : ''}</span></span><StatusPill status={t.status} /></li>)}</ul>}
      </section>
      <section className="rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm"><h4 className="mb-3 font-semibold">History</h4>
        <ol className="grid max-h-80 gap-2 overflow-y-auto">{[...p.history].reverse().map((h, i) => <li key={i} className="border-l-2 border-orange pl-3"><b>{STATUS[h.status] || h.status}</b> · {when(h.at)}{h.note && <span className="block text-[#536175]">{h.note}</span>}</li>)}</ol>
      </section>
    </div>
    {canWrite && open && <div className="rounded-2xl bg-[#eef2f7] p-4">
      {!cancel ? <button className={`${outline} text-red-700`} onClick={() => setCancel({ reason: '', immediate: false })}>Cancel for the customer</button> : <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <input className={input} placeholder="Reason, e.g. customer phoned in" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cancel.immediate} onChange={(e) => setCancel({ ...cancel, immediate: e.target.checked })} />Immediately (admin)</label>
        <div className="flex gap-2"><button className={`${button} bg-red-700`} disabled={busy || cancel.reason.trim().length < 3} onClick={() => act(() => api(`/admin/plans/${p.id}/cancel`, { body: cancel }), 'Plan cancelled. Customer and driver notified.')}>Confirm cancel</button><button className={outline} onClick={() => setCancel(null)}>Keep</button></div>
      </div>}
      <p className="mt-2 text-[12px] text-[#536175]">Cancelling stops trips (after 24 hours unless immediate) and refunds every trip that doesn’t run when the period closes. Every action is recorded in the audit log.</p>
    </div>}
  </div>;
}
