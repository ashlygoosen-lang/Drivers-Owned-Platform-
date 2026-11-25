import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../lib/api';
import { button, outline, input, Field, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { useLoad, Loading, Empty, Table, type Notify } from './common';

/** Monthly plans: scholar transport (parents and guardians), staff transport (business accounts), and the driver side. */
export type PlanKind = 'scholar' | 'staff';
interface Leg { key: string; label: string; time: string; from?: string; to?: string }
interface PerLeg { key: string; onDemandFare: number; fare: number; driverServiceFee: number; driverEarnings: number }
interface Pricing { dates: string[]; perLeg: PerLeg[]; perDay: number; trips: number; total: number; onDemandTotal: number; saving: number; discountRate: number }
interface Rider { name: string; grade?: string; phone?: string; notes?: string }
export interface Plan {
  id: string; ref: string; kind: PlanKind; kindLabel: string; status: string; category: string; startDate: string; endDate: string;
  days: number[]; legs: Leg[]; pickup?: string; destination: string; school: string; company: string; riderCount: number; riders?: Rider[];
  pricing: Pricing; payment: string; paymentStatus: string; skipDates: string[]; autoRenew: boolean; refundedAmount: number;
  cancelEffective: string | null; renewedToId: string | null; renewedFromId: string | null;
  driver: { name: string; vehicle: string; rating: number | null } | null; owner?: { name: string };
  guardian?: { relationship?: string; emergencyName?: string; emergencyPhone?: string; handover?: string; consentAt?: string } | null;
  distanceKm?: number | null; clash?: boolean; earnings?: number;
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GRADES = ['Grade R', ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
const HANDOVER = ['Hand over to a staff member at school', 'Learner may walk from the drop-off point alone', 'Hand over to the parent or guardian only'];
const RELATIONSHIP = ['Parent', 'Legal guardian', 'Grandparent or family member with parental responsibility', 'Foster parent'];
const STATUS: Record<string, string> = { awaiting_payment: 'Awaiting payment', awaiting_driver: 'Finding a driver', active: 'Active', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired' };
const prettyDate = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
const days = (d: number[]) => (d.join() === '1,2,3,4,5' ? 'Weekdays' : d.map((x) => DAY_NAMES[x - 1]).join(', '));
const sastToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
const firstOfNextMonth = () => { const n = new Date(Date.now() + 2 * 3_600_000); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };
const tomorrow = () => new Date(Date.now() + 2 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);

async function payPlan(id: string) {
  const r = await api<{ authorizationUrl: string }>(`/payments/plans/${id}/checkout`, { body: {} });
  window.location.href = r.authorizationUrl;
}

/* ============ Parent / guardian and business: list and manage ============ */
export function OwnerPlans({ kind, notify }: { kind: PlanKind; notify: Notify }) {
  const { data, error, reload } = useLoad<{ plans: Plan[] }>('/plans');
  const [creating, setCreating] = useState(false);
  const list = (data?.plans || []).filter((p) => p.kind === kind);
  if (creating) return <PlanForm kind={kind} notify={notify} onDone={() => { setCreating(false); void reload(); }} />;
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-xl text-sm leading-6 text-[#4a576a]">{kind === 'scholar'
        ? <p>One vetted driver for the school run, booked by the month. Drivers on scholar plans hold a police clearance, a child-protection clearance and a learner-transport operating licence, checked by our compliance team. Days you skip with {12} hours’ notice, and public holidays, are not charged.</p>
        : <p>Daily commutes for your team on one monthly plan with one driver, invoiced to your business account with your other trips. Set up a plan per route and shift.</p>}
        <p className="mt-2"><a className="underline" href={kind === 'scholar' ? '/legal/scholar-transport' : '/legal/staff-transport'} target="_blank" rel="noopener">{kind === 'scholar' ? 'Scholar transport terms' : 'Staff transport terms'}</a> · <a className="underline" href="/legal/cancellations-refunds" target="_blank" rel="noopener">Cancellations and refunds</a></p>
      </div>
      <button className={button} onClick={() => setCreating(true)}><Icon name="plus" size={16} />New {kind === 'scholar' ? 'scholar' : 'staff'} plan</button>
    </div>
    <ErrorText>{error}</ErrorText>
    {!data ? <Loading /> : !list.length ? <Empty>No {kind === 'scholar' ? 'scholar transport' : 'staff transport'} plans yet.</Empty>
      : list.map((p) => <PlanCard key={p.id} plan={p} notify={notify} onChange={reload} />)}
  </div>;
}

function PlanCard({ plan: p, notify, onChange }: { plan: Plan; notify: Notify; onChange: () => void }) {
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [trips, setTrips] = useState<{ id: string; ref: string; date: string; leg: string; status: string }[] | null>(null);
  const run = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try { await fn(); if (done) notify(done); onChange(); } catch (e) { notify((e as Error).message); } finally { setBusy(''); }
  };
  const future = p.pricing.dates.filter((d) => d > sastToday());
  const live = ['awaiting_payment', 'awaiting_driver', 'active'].includes(p.status);
  useEffect(() => { if (open && !trips) api<{ trips: typeof trips }>(`/plans/${p.id}`).then((r) => setTrips(r.trips)).catch(() => setTrips([])); }, [open, trips, p.id]);
  return <article className="rounded-xl border border-[#d2dae4] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[12px] font-semibold uppercase tracking-wide text-[#5b6b82]">{p.ref} · {p.kindLabel}</p>
        <h4 className="mt-1 text-lg font-semibold">{p.kind === 'scholar' ? p.school : p.destination}</h4>
        <p className="text-sm text-[#4a576a]">{prettyDate(p.startDate)} – {prettyDate(p.endDate)} · {days(p.days)} · {p.legs.map((l) => l.time).join(' & ')} · {p.category}</p></div>
      <div className="text-right"><StatusPill status={STATUS[p.status] || p.status} /><p className="mt-2 text-xl font-semibold">{money(p.pricing.total)}</p><p className="text-[12px] text-[#5b6b82]">{p.pricing.trips} trips · {p.payment === 'Card' ? 'paid by card' : 'invoiced'}</p></div>
    </div>
    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <p><b>{p.kind === 'scholar' ? 'Learners' : 'Staff'}:</b> {(p.riders || []).map((r) => (r.grade ? `${r.name} (${r.grade})` : r.name)).join(', ')}</p>
      <p><b>Driver:</b> {p.driver ? `${p.driver.name}${p.driver.vehicle ? ` · ${p.driver.vehicle}` : ''}${p.driver.rating ? ` · ★ ${p.driver.rating}` : ''}` : 'Not confirmed yet — each trip is offered to the nearest vetted driver until one accepts the month'}</p>
      {p.skipDates.length > 0 && <p className="sm:col-span-2"><b>Skipped:</b> {p.skipDates.map(prettyDate).join(', ')} (refunded at the end of the period)</p>}
      {p.cancelEffective && <p className="sm:col-span-2"><b>Cancelled:</b> no trips after {new Date(p.cancelEffective).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Unused trips are refunded when the period closes.</p>}
      {p.refundedAmount > 0 && <p className="sm:col-span-2"><b>Refunded:</b> {money(p.refundedAmount)} for unused trips.</p>}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {p.status === 'awaiting_payment' && <button className={button} disabled={!!busy} onClick={() => run('pay', () => payPlan(p.id))}>{busy === 'pay' && <Spinner />}Pay {money(p.pricing.total)}</button>}
      {live && future.length > 0 && <label className="flex items-center gap-2 text-sm">Skip a day
        <select className={`${input} min-h-10 w-auto`} disabled={!!busy} value="" onChange={(e) => e.target.value && run('skip', () => api(`/plans/${p.id}/skip`, { body: { date: e.target.value } }), 'Day skipped.')}>
          <option value="">Choose…</option>{future.filter((d) => !p.skipDates.includes(d)).map((d) => <option key={d} value={d}>{prettyDate(d)}</option>)}
        </select></label>}
      {live && p.skipDates.filter((d) => d > sastToday()).map((d) => <button key={d} className={outline} disabled={!!busy} onClick={() => run('undo', () => api(`/plans/${p.id}/skip`, { body: { date: d, undo: true } }), 'Day restored.')}>Restore {prettyDate(d)}</button>)}
      {p.status === 'active' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.autoRenew} disabled={!!busy} onChange={(e) => run('renew', () => api(`/plans/${p.id}/auto-renew`, { body: { autoRenew: e.target.checked } }))} />Renew next month</label>}
      <button className={outline} onClick={() => setOpen(!open)}>{open ? 'Hide trips' : 'Trips'}</button>
      {live && <button className={`${outline} text-red-700`} disabled={!!busy} onClick={() => {
        if (!window.confirm(p.status === 'awaiting_payment' ? 'Cancel this plan?' : 'Cancel this plan? Trips stop 24 hours from now, and every trip that doesn’t run is refunded when the period closes.')) return;
        void run('cancel', () => api(`/plans/${p.id}/cancel`, { body: {} }), 'Plan cancelled.');
      }}>Cancel plan</button>}
    </div>
    {open && <div className="mt-4">{!trips ? <Loading /> : !trips.length ? <Empty>Trips appear here 45 minutes before each pickup.</Empty>
      : <Table head={['Date', 'Trip', 'Ref', 'Status']} rows={trips.map((t) => [prettyDate(t.date), t.leg === 'out' ? p.legs[0].label : p.legs[1]?.label, t.ref, <StatusPill key={t.id} status={t.status} />])} />}</div>}
  </article>;
}

/* ============ New plan ============ */
function PlanForm({ kind, notify, onDone }: { kind: PlanKind; notify: Notify; onDone: () => void }) {
  const scholar = kind === 'scholar';
  const [f, setF] = useState({ school: '', pickup: '', destination: '', outTime: scholar ? '06:45' : '07:00', returnTime: scholar ? '14:30' : '17:00', twoWay: true, category: 'Comfort', startDate: firstOfNextMonth(), days: [1, 2, 3, 4, 5] });
  const [riders, setRiders] = useState<Rider[]>([{ name: '', grade: scholar ? 'Grade 1' : undefined }]);
  const [g, setG] = useState({ relationship: 'Parent', emergencyName: '', emergencyPhone: '', handover: HANDOVER[0], consent: false });
  const [quote, setQuote] = useState<Pricing | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const body = useMemo(() => ({ kind, category: f.category, pickup: f.pickup, destination: f.destination, school: f.school, outTime: f.outTime, returnTime: f.twoWay ? f.returnTime : undefined, days: f.days, startDate: f.startDate }), [kind, f]);
  useEffect(() => {
    if (f.pickup.trim().length < 3 || f.destination.trim().length < 3) { setQuote(null); return; }
    const t = setTimeout(() => {
      api<{ pricing: Pricing }>('/plans/quote', { body: { ...body, riderCount: riders.length } }).then((r) => { setQuote(r.pricing); setQuoteError(''); }).catch((e) => { setQuote(null); setQuoteError((e as Error).message); });
    }, 400);
    return () => clearTimeout(t);
  }, [body, riders.length, f.pickup, f.destination]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api<{ plan: Plan }>('/plans', { body: { ...body, riders: riders.map((x) => ({ ...x, name: x.name.trim() })), ...(scholar && { guardian: g }) } });
      if (r.plan.status === 'awaiting_payment') { notify('Plan created. Taking you to secure card payment…'); await payPlan(r.plan.id); return; }
      notify(`Plan ${r.plan.ref} created. We’re offering it to drivers now.`);
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const maxRiders = f.category === 'XL' ? 6 : 4;
  return <form className="grid gap-6" onSubmit={submit}>
    <div className="flex items-center justify-between"><h4 className="text-lg font-semibold">New {scholar ? 'scholar transport' : 'staff transport'} plan</h4><button type="button" className={outline} onClick={onDone}>Back</button></div>
    <fieldset className="grid items-start gap-4 sm:grid-cols-2"><legend className="mb-2 font-semibold">Route</legend>
      {scholar && <Field label="School name"><input className={input} required value={f.school} onChange={(e) => set('school', e.target.value)} placeholder="e.g. Sea Point Primary" /></Field>}
      <Field label={scholar ? 'Home pickup address' : 'Pickup point'} hint={scholar ? 'Shared with the driver only once they accept the plan.' : undefined}><input className={input} required list="drop-places" value={f.pickup} onChange={(e) => set('pickup', e.target.value)} autoComplete="street-address" /></Field>
      <Field label={scholar ? 'School address' : 'Workplace address'}><input className={input} required list="drop-places" value={f.destination} onChange={(e) => set('destination', e.target.value)} /></Field>
      <Field label={scholar ? 'Morning pickup time (home)' : 'Pickup time'}><input type="time" className={input} required value={f.outTime} onChange={(e) => set('outTime', e.target.value)} /></Field>
      <div className="grid gap-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.twoWay} onChange={(e) => set('twoWay', e.target.checked)} />{scholar ? 'Afternoon trip home' : 'Return trip'}</label>
        {f.twoWay && <input type="time" aria-label={scholar ? 'Afternoon pickup time at school' : 'Return pickup time'} className={input} value={f.returnTime} onChange={(e) => set('returnTime', e.target.value)} />}</div>
      <div className="grid gap-2 text-sm sm:col-span-2">Days<div className="flex flex-wrap gap-2">{DAY_NAMES.map((d, i) => { const on = f.days.includes(i + 1); return <button type="button" key={d} aria-pressed={on} onClick={() => set('days', on ? f.days.filter((x) => x !== i + 1) : [...f.days, i + 1].sort())} className={`min-h-10 rounded-lg border px-3 ${on ? 'border-navy bg-navy text-white' : 'border-[#cbd0d7]'}`}>{d}</button>; })}</div></div>
      <Field label="Start date" hint="The plan runs to the end of that month and can renew monthly."><input type="date" className={input} required min={tomorrow()} value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
      <Field label="Vehicle"><select className={input} value={f.category} onChange={(e) => set('category', e.target.value)}><option value="Comfort">Comfort sedan (up to 4)</option><option value="XL">XL (up to 6)</option></select></Field>
    </fieldset>

    <fieldset className="grid gap-3"><legend className="mb-2 font-semibold">{scholar ? 'Learners' : 'Staff members'}</legend>
      {riders.map((r, i) => <div key={i} className="grid gap-3 rounded-xl bg-[#f1f4f8] p-4 sm:grid-cols-[1fr_160px_1fr_auto]">
        <input className={input} required aria-label={`${scholar ? 'Learner' : 'Staff member'} ${i + 1} name`} placeholder={scholar ? 'First name' : 'Full name'} value={r.name} onChange={(e) => setRiders(riders.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
        {scholar ? <select className={input} aria-label={`Learner ${i + 1} grade`} value={r.grade} onChange={(e) => setRiders(riders.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))}>{GRADES.map((gr) => <option key={gr}>{gr}</option>)}</select>
          : <input className={input} aria-label={`Staff member ${i + 1} phone`} placeholder="Phone (optional)" value={r.phone || ''} onChange={(e) => setRiders(riders.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />}
        <input className={input} aria-label="Notes for the driver" placeholder={scholar ? 'Notes for the driver (e.g. booster seat)' : 'Notes (optional)'} maxLength={200} value={r.notes || ''} onChange={(e) => setRiders(riders.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
        <button type="button" className={outline} disabled={riders.length === 1} onClick={() => setRiders(riders.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="trash" size={16} /></button>
      </div>)}
      <button type="button" className={`${outline} justify-self-start`} disabled={riders.length >= maxRiders} onClick={() => setRiders([...riders, { name: '', grade: scholar ? 'Grade 1' : undefined }])}><Icon name="plus" size={16} />Add {scholar ? 'learner' : 'staff member'}</button>
      {scholar && <p className="text-[12px] text-[#5a6677]">Please don’t include medical details beyond what the driver needs on the day (e.g. “asthma pump in bag”). If a learner needs a car seat or booster, please provide it: the driver can’t take a child who needs one without it.</p>}
    </fieldset>

    {scholar && <fieldset className="grid items-start gap-4 sm:grid-cols-2"><legend className="mb-2 font-semibold">Parent or guardian</legend>
      <Field label="Your relationship to the learner(s)"><select className={input} value={g.relationship} onChange={(e) => setG({ ...g, relationship: e.target.value })}>{RELATIONSHIP.map((r) => <option key={r}>{r}</option>)}</select></Field>
      <Field label="At drop-off"><select className={input} value={g.handover} onChange={(e) => setG({ ...g, handover: e.target.value })}>{HANDOVER.map((h) => <option key={h}>{h}</option>)}</select></Field>
      <Field label="Second emergency contact (name)"><input className={input} required value={g.emergencyName} onChange={(e) => setG({ ...g, emergencyName: e.target.value })} /></Field>
      <Field label="Second emergency contact (phone)"><input className={input} required type="tel" value={g.emergencyPhone} onChange={(e) => setG({ ...g, emergencyPhone: e.target.value })} /></Field>
      <label className="flex items-start gap-3 rounded-xl bg-[#fff6ee] p-4 text-sm leading-6 sm:col-span-2"><input type="checkbox" className="mt-1" checked={g.consent} onChange={(e) => setG({ ...g, consent: e.target.checked })} required />
        <span>I am the parent or legal guardian of the learner(s) above, or have parental responsibility for them. I consent to DROP processing their first names, grades, school, addresses, notes and live trip location to arrange and monitor this transport, and to sharing these with the assigned driver, as set out in the <a className="underline" href="/legal/privacy#children" target="_blank" rel="noopener">privacy policy</a> and the <a className="underline" href="/legal/scholar-transport" target="_blank" rel="noopener">scholar transport terms</a>. I can withdraw consent by cancelling the plan.</span></label>
    </fieldset>}

    <div className="rounded-xl bg-[#ebeff4] p-5" aria-live="polite">
      {quote ? <div className="grid gap-1 text-sm">
        <p className="text-2xl font-semibold">{money(quote.total)} <span className="text-sm font-normal text-[#536175]">for {quote.trips} trips ({quote.dates.length} days)</span></p>
        <p>{money(quote.perDay)} a day · {Math.round(quote.discountRate * 100)}% below on-demand fares · you save {money(quote.saving)}</p>
        <p className="text-[12px] text-[#536175]">Public holidays are excluded. Days you skip with 12 hours’ notice, and trips that don’t run, are refunded when the period closes.{!scholar && ' Staff plans are added to your monthly business invoice.'}</p>
      </div> : <p className="text-sm text-[#536175]">{quoteError || 'Enter the route to see the monthly price.'}</p>}
    </div>
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy || !quote || (scholar && !g.consent)}>{busy && <Spinner />}{scholar ? 'Continue to payment' : 'Create plan'}<Icon name="arrow" size={16} /></button>
  </form>;
}

/* ============ Drivers ============ */
export function DriverPlans({ notify }: { notify: Notify }) {
  const { data, error, reload } = useLoad<{ eligibility: { scholar: boolean; missing: string[] }; offers: Plan[]; mine: Plan[] }>('/drivers/plans');
  const [busy, setBusy] = useState('');
  const act = async (id: string, path: string, body: object, done: string) => {
    setBusy(id);
    try { await api(path, { body }); notify(done); await reload(); } catch (e) { notify((e as Error).message); } finally { setBusy(''); }
  };
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  return <div className="grid gap-6">
    {!data.eligibility.scholar && <div className="rounded-xl bg-[#fff1e6] p-4 text-sm leading-6 text-[#8a3a00]"><b>Scholar transport:</b> to see school-run plans, upload and get approved: {data.eligibility.missing.map((m) => m.replace(/_/g, ' ')).join(', ')} (Verification tab). Staff transport plans are open to every approved driver.</div>}
    <section><h4 className="mb-3 text-lg font-semibold">My monthly plans</h4>
      {!data.mine.length ? <Empty>You have no monthly plans yet.</Empty> : <div className="grid gap-3">{data.mine.map((p) => <article key={p.id} className="rounded-xl border border-[#d2dae4] p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><b>{p.ref} · {p.kindLabel}{p.owner ? ` · ${p.owner.name}` : ''}</b><StatusPill status={STATUS[p.status] || p.status} /></div>
        <p className="mt-1">{prettyDate(p.startDate)} – {prettyDate(p.endDate)} · {days(p.days)}</p>
        <ul className="mt-2 grid gap-1">{p.legs.map((l) => <li key={l.key}><b>{l.time}</b> {l.label}: {l.from} → {l.to}</li>)}</ul>
        <p className="mt-2"><b>{p.kind === 'scholar' ? 'Learners' : 'Passengers'}:</b> {(p.riders || []).map((r) => `${r.name}${r.grade ? ` (${r.grade})` : ''}${r.notes ? ` — ${r.notes}` : ''}`).join('; ')}</p>
        {p.guardian?.handover && <p><b>Drop-off:</b> {p.guardian.handover} · <b>Emergency:</b> {p.guardian.emergencyName} {p.guardian.emergencyPhone}</p>}
        {p.skipDates.length > 0 && <p><b>No trips on:</b> {p.skipDates.map(prettyDate).join(', ')}</p>}
        <button className={`${outline} mt-3`} disabled={busy === p.id} onClick={() => { const reason = window.prompt('Why can’t you continue with this plan? The customer is told a new driver is being found.'); if (reason) void act(p.id, `/drivers/plans/${p.id}/release`, { reason }, 'Plan released.'); }}>Release plan</button>
      </article>)}</div>}
    </section>
    <section><h4 className="mb-3 text-lg font-semibold">Plans looking for a driver</h4>
      {!data.offers.length ? <Empty>No plans near you right now. New plans also arrive as notifications.</Empty> : <div className="grid gap-3">{data.offers.map((p) => <article key={p.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#d2dae4] p-4 text-sm">
        <div><b>{p.kindLabel} · {p.riderCount} {p.kind === 'scholar' ? 'learner(s)' : 'passenger(s)'} · {p.category}</b>
          <p>{p.legs.map((l) => `${l.time} ${l.label}`).join(' · ')}</p>
          <p>{days(p.days)} · {prettyDate(p.startDate)} – {prettyDate(p.endDate)} · to {p.kind === 'scholar' ? p.school : p.destination}{p.distanceKm != null ? ` · pickup ${p.distanceKm} km from you` : ''}</p>
          {p.clash && <p className="text-red-700">Overlaps a plan you already drive.</p>}</div>
        <div className="text-right"><p className="text-lg font-semibold">{money(p.earnings || 0)}</p><p className="text-[12px] text-[#5b6b82]">your earnings for {p.pricing.trips} trips</p>
          <button className={`${button} mt-2`} disabled={busy === p.id || p.clash} onClick={() => act(p.id, `/drivers/plans/${p.id}/accept`, {}, 'Plan accepted. You’ll see each trip 45 minutes before pickup.')}>{busy === p.id && <Spinner />}Accept month</button></div>
      </article>)}</div>}
    </section>
  </div>;
}

/* ============ Staff ============ */
export function AdminPlans() {
  const { data, error } = useLoad<{ plans: Plan[] }>('/admin/plans');
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  if (!data.plans.length) return <Empty>No monthly plans yet.</Empty>;
  return <Table head={['Plan', 'Customer', 'Period', 'Driver', 'Total', 'Status']} rows={data.plans.map((p) => [`${p.ref} · ${p.kindLabel}`, p.owner?.name || '', `${p.startDate} – ${p.endDate}`, p.driver?.name || '—', money(p.pricing.total), <StatusPill key={p.id} status={STATUS[p.status] || p.status} />])} />;
}
