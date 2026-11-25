import { PlanMap } from './PlanMap';
import { sideView } from '../lib/vehicleArt';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, token, BASE, type Booking } from '../lib/api';
import { button, outline, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { useLoad, Loading, Empty, type Notify } from './common';
import { PlanForm, payPlan, type Plan, type PlanKind } from './Plans';

/**
 * Professional dashboards for monthly plans:
 *  - parents and guardians (scholar transport): next pickup, today's runs with live status, learners,
 *    driver, a month calendar to skip days, statements;
 *  - businesses (staff transport): routes board, staff covered, punctuality, month-to-date spend,
 *    today's trips, calendar per route and CSV statements for the accounts department.
 */
interface TripCell { id: string; ref: string; status: string; startedAt: string | null }
export interface PlanStats {
  byDate: Record<string, Record<string, TripCell>>; holidays: string[];
  next: { date: string; time: string; label: string; departure: string; bookingId: string | null } | null;
  tripsPlanned: number; tripsDriven: number; tripsMissed: number; spent: number; onTimeRate: number | null;
}
type PlanWithStats = Plan & { stats: PlanStats; month: string };
interface TodayTrip { planId: string; planRef: string; title: string; time: string; label: string; from: string; to: string; riders: string[]; status: string; bookingId: string | null; driver: { name: string; vehicle: string } | null; departure: string }
interface Dash {
  kind: PlanKind; today: string;
  kpis: { activePlans: number; awaitingDriver: number; awaitingPayment: number; riders: number; tripsDrivenThisMonth: number; tripsPlannedThisMonth: number; spentThisMonth: number; committedThisMonth: number; refunded: number; onTimeRate: number | null };
  nextUp: (TodayTrip & { date: string }) | null; todayTrips: TodayTrip[]; plans: PlanWithStats[];
}

const PLAN_STATUS: Record<string, string> = { awaiting_payment: 'Awaiting payment', awaiting_driver: 'Finding a driver', active: 'Active', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired' };
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const longDate = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const days = (d: number[]) => (d.join() === '1,2,3,4,5' ? 'Weekdays' : d.map((x) => DAY[x - 1]).join(', '));
const sastNow = () => new Date(Date.now() + 2 * 3_600_000).toISOString();

/** The four stages of a trip, worded for learners or staff. */
function stages(kind: PlanKind) {
  return kind === 'scholar'
    ? [['scheduled', 'Scheduled'], ['accepted', 'Driver assigned'], ['arriving', 'On the way to pickup'], ['in_progress', 'Picked up'], ['completed', 'Dropped off']]
    : [['scheduled', 'Scheduled'], ['accepted', 'Driver assigned'], ['arriving', 'On the way to pickup'], ['in_progress', 'On board'], ['completed', 'Arrived']];
}
const stageIndex = (s: string) => ({ scheduled: 0, requested: 0, accepted: 1, arriving: 2, in_progress: 3, completed: 4 } as Record<string, number>)[s] ?? -1;

async function download(path: string, filename: string) {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${token.get()}` } });
  if (!res.ok) throw new Error('Could not download the statement.');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function PlanDashboard({ kind, notify, onTrack }: { kind: PlanKind; notify: Notify; onTrack: (b: Booking) => void }) {
  const { data, error, reload } = useLoad<Dash>('/plans/dashboard');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => void reload(), 30_000); return () => clearInterval(t); }, [reload]); // keep today's statuses fresh
  const track = useCallback(async (bookingId: string) => {
    try { onTrack((await api<{ booking: Booking }>(`/bookings/${bookingId}`)).booking); } catch (e) { notify((e as Error).message); }
  }, [onTrack, notify]);
  if (creating) return <PlanForm kind={kind} notify={notify} onDone={() => { setCreating(false); void reload(); }} />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const scholar = kind === 'scholar';
  const open = data.plans.find((p) => p.id === openId);
  if (open) return <PlanDetail plan={open} kind={kind} notify={notify} onBack={() => setOpenId(null)} onChange={reload} onTrack={track} />;
  const k = data.kpis;
  const rank: Record<string, number> = { active: 0, awaiting_driver: 1, awaiting_payment: 2 };
  const live = data.plans.filter((p) => p.status in rank).sort((a, b) => a.startDate.localeCompare(b.startDate) || rank[a.status] - rank[b.status]);
  const past = data.plans.filter((p) => !live.includes(p));
  const pct = k.tripsPlannedThisMonth ? Math.round((k.tripsDrivenThisMonth / k.tripsPlannedThisMonth) * 100) : 0;

  return <div className="grid gap-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h3 className="font-display text-2xl font-extrabold text-navy">{scholar ? 'Your school runs' : 'Your staff transport'}</h3>
        <p className="text-sm text-[#536175]">{longDate(data.today)} · {scholar ? 'vetted drivers, live tracking, one driver per month' : 'routes, punctuality and spend in one place'}</p></div>
      <div className="flex flex-wrap gap-2">
        <a className={outline} href={scholar ? '/legal/scholar-transport' : '/legal/staff-transport'} target="_blank" rel="noopener">Terms</a>
        <button className={button} onClick={() => setCreating(true)}><Icon name="plus" size={16} />{scholar ? 'New school plan' : 'New staff route'}</button>
      </div>
    </header>

    {k.awaitingPayment > 0 && <Alert tone="warn" text={`${k.awaitingPayment} plan${k.awaitingPayment > 1 ? 's are' : ' is'} waiting for payment. Pay to confirm ${k.awaitingPayment > 1 ? 'them' : 'it'} and keep your driver.`} />}
    {k.awaitingDriver > 0 && <Alert tone="info" text={`${k.awaitingDriver} plan${k.awaitingDriver > 1 ? 's are' : ' is'} still matching a ${scholar ? 'vetted scholar-transport ' : ''}driver. Until one accepts the month, each trip is offered to the nearest suitable driver.`} />}

    {/* Next pickup + KPIs */}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
      <section className="rounded-2xl bg-navy p-6 text-white shadow-[0_12px_30px_#071b3a33]" aria-label="Next pickup">
        <p className="text-[12px] font-bold uppercase tracking-wider text-orange">Next pickup</p>
        {data.nextUp ? <>
          <p className="mt-2 font-display text-5xl font-extrabold tabular-nums">{data.nextUp.time}</p>
          <p className="mt-1 text-sm text-[#c9d3e1]">{data.nextUp.date === data.today ? 'Today' : longDate(data.nextUp.date)} · {data.nextUp.label}</p>
          <p className="mt-4 text-lg font-semibold">{data.nextUp.title}</p>
          <p className="text-sm text-[#c9d3e1]">{data.nextUp.riders.join(', ')}</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/10 p-3">
            <span className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange font-bold text-navy">{(data.nextUp.driver?.name || '?').slice(0, 1)}</span>
              <span><span className="block text-sm font-semibold">{data.nextUp.driver?.name || 'Driver being matched'}</span><span className="block text-[12px] text-[#c9d3e1]">{data.nextUp.driver?.vehicle || (scholar ? 'Vetted for scholar transport' : 'Approved DROP driver')}</span></span></span>
            {data.nextUp.bookingId && <button className="rounded-lg bg-orange px-4 py-2 text-sm font-bold text-navy" onClick={() => void track(data.nextUp!.bookingId!)}>Track live</button>}
          </div>
        </> : <p className="mt-3 text-sm text-[#c9d3e1]">No upcoming trips. {live.length ? 'Your next trips will appear here.' : 'Set up a plan to get started.'}</p>}
      </section>
      <section className="grid grid-cols-2 gap-3" aria-label="This month">
        <Kpi label={scholar ? 'Active plans' : 'Active routes'} value={String(k.activePlans)} sub={k.awaitingDriver ? `${k.awaitingDriver} matching a driver` : 'all with a driver'} />
        <Kpi label={scholar ? 'Learners covered' : 'Staff covered'} value={String(k.riders)} sub={`on ${live.length} plan${live.length === 1 ? '' : 's'}`} />
        <Kpi label="Trips this month" value={`${k.tripsDrivenThisMonth}/${k.tripsPlannedThisMonth}`} sub={`${pct}% of planned trips driven`} progress={pct} />
        <Kpi label="On-time pickups" value={k.onTimeRate == null ? '—' : `${k.onTimeRate}%`} sub="picked up within 10 minutes" tone={k.onTimeRate == null ? undefined : k.onTimeRate >= 90 ? 'good' : k.onTimeRate >= 75 ? 'warn' : 'bad'} />
        <Kpi label={scholar ? 'Paid for this month' : 'Spend this month'} value={money(scholar ? k.committedThisMonth : k.spentThisMonth)} sub={scholar ? `${money(k.spentThisMonth)} driven so far` : 'invoiced with your business trips'} />
        <Kpi label="Refunded" value={money(k.refunded)} sub="skipped days and trips that didn’t run" />
      </section>
    </div>

    {/* Today */}
    <section className="rounded-2xl border border-[#d2dae4] bg-white p-5">
      <div className="mb-4 flex items-center justify-between"><h4 className="text-lg font-semibold">Today</h4><span className="text-[12px] text-[#5b6b82]">Updates every 30 seconds</span></div>
      {!data.todayTrips.length ? <Empty>No {scholar ? 'school runs' : 'staff trips'} today.</Empty> : <ol className="grid gap-3">{data.todayTrips.map((t) => <TodayRow key={`${t.planId}${t.time}`} trip={t} kind={kind} onTrack={track} />)}</ol>}
    </section>

    {/* Plans / routes */}
    <section>
      <h4 className="mb-3 text-lg font-semibold">{scholar ? 'Plans' : 'Routes'}</h4>
      {!live.length ? <Empty>{scholar ? 'No school transport plans yet. Create one to book a month of school runs with a vetted driver.' : 'No staff routes yet. Create a route per pickup point and shift.'}</Empty>
        : scholar ? <div className="grid gap-4 lg:grid-cols-2">{live.map((p) => <PlanCard key={p.id} plan={p} onOpen={() => setOpenId(p.id)} />)}</div>
          : <RoutesTable plans={live} onOpen={setOpenId} />}
    </section>
    {past.length > 0 && <section>
      <h4 className="mb-3 text-lg font-semibold">Previous months</h4>
      <div className="overflow-x-auto rounded-xl border border-[#d2dae4] bg-white"><table className="w-full min-w-[560px] text-left text-sm">
        <thead><tr className="border-b border-[#e1e6ed] text-[12px] uppercase tracking-wide text-[#5b6b82]"><th className="p-3">Plan</th><th className="p-3">Period</th><th className="p-3">Trips driven</th><th className="p-3">Amount</th><th className="p-3">Refunded</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
        <tbody>{past.map((p) => <tr key={p.id} className="border-b border-[#eef1f5]"><td className="p-3 font-semibold">{p.ref}<span className="block text-[12px] font-normal text-[#5b6b82]">{scholar ? p.school : p.destination}</span></td><td className="p-3">{shortDate(p.startDate)} – {shortDate(p.endDate)}</td><td className="p-3">{p.stats.tripsDriven}/{p.stats.tripsPlanned}</td><td className="p-3">{money(p.stats.spent)}</td><td className="p-3">{money(p.refundedAmount || 0)}</td><td className="p-3"><StatusPill status={PLAN_STATUS[p.status] || p.status} /></td>
          <td className="p-3 text-right"><button className="font-semibold underline" onClick={() => void download(`/plans/${p.id}/statement.csv`, `${p.ref}-statement.csv`).catch((e) => notify((e as Error).message))}>Statement</button></td></tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
}

function Alert({ tone, text }: { tone: 'warn' | 'info'; text: string }) {
  return <div role="status" className={`flex items-start gap-3 rounded-xl p-4 text-sm ${tone === 'warn' ? 'bg-[#fff1e6] text-[#8a3a00]' : 'bg-[#e9eef4] text-navy'}`}><Icon name={tone === 'warn' ? 'wallet' : 'clock'} size={18} className="mt-0.5 shrink-0" />{text}</div>;
}

function Kpi({ label, value, sub, progress, tone }: { label: string; value: string; sub: string; progress?: number; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'text-[#17744a]' : tone === 'warn' ? 'text-[#b34a00]' : tone === 'bad' ? 'text-[#b42828]' : 'text-navy';
  return <div className="rounded-xl border border-[#dde3eb] bg-white p-4">
    <p className="text-[12px] font-semibold uppercase tracking-wide text-[#5b6b82]">{label}</p>
    <p className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${color}`}>{value}</p>
    {progress != null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e6ebf1]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={label}><div className="h-full rounded-full bg-orange" style={{ width: `${Math.min(100, progress)}%` }} /></div>}
    <p className="mt-1 text-[12px] text-[#5b6b82]">{sub}</p>
  </div>;
}

function TodayRow({ trip: t, kind, onTrack }: { trip: TodayTrip; kind: PlanKind; onTrack: (id: string) => void }) {
  const st = stages(kind);
  const idx = t.status === 'cancelled' ? -1 : stageIndex(t.status);
  const done = t.status === 'completed';
  const liveNow = ['accepted', 'arriving', 'in_progress'].includes(t.status);
  return <li className={`rounded-xl border p-4 ${liveNow ? 'border-orange bg-[#fff8f2]' : 'border-[#e1e6ed]'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-4"><p className="w-14 font-display text-xl font-extrabold tabular-nums text-navy">{t.time}</p>
        <div><p className="font-semibold">{t.label} · {t.title}</p><p className="text-sm text-[#536175]">{t.riders.join(', ')} · {t.driver ? `${t.driver.name}${t.driver.vehicle ? `, ${t.driver.vehicle}` : ''}` : 'driver being matched'}</p></div></div>
      <div className="flex items-center gap-2">{t.status === 'cancelled' ? <StatusPill status="Cancelled" /> : done ? <span className="rounded-full bg-[#e8f5ee] px-3 py-1 text-[12px] font-semibold text-[#17744a]">{kind === 'scholar' ? 'Dropped off' : 'Arrived'}</span> : <StatusPill status={st[Math.max(0, idx)][1]} />}
        {t.bookingId && !['completed', 'cancelled'].includes(t.status) && <button className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white" onClick={() => onTrack(t.bookingId!)}>Track live</button>}</div>
    </div>
    {t.status !== 'cancelled' && <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Trip progress">{st.map(([key, label], i) => <li key={key} className="grid gap-1">
      <span className={`h-1.5 rounded-full ${i <= idx ? 'bg-orange' : 'bg-[#e6ebf1]'}`} />
      <span className={`hidden text-[11px] sm:block ${i <= idx ? 'font-semibold text-navy' : 'text-[#8a96a8]'}`}>{label}</span></li>)}</ol>}
  </li>;
}

function PlanCard({ plan: p, onOpen }: { plan: PlanWithStats; onOpen: () => void }) {
  const pct = p.stats.tripsPlanned ? Math.round((p.stats.tripsDriven / p.stats.tripsPlanned) * 100) : 0;
  return <article className="flex flex-col rounded-2xl border border-[#d2dae4] bg-white p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-semibold uppercase tracking-wide text-[#5b6b82]">{p.ref}</p><h5 className="text-lg font-semibold">{p.school}</h5></div><StatusPill status={PLAN_STATUS[p.status] || p.status} /></div>
    <p className="mt-1 text-sm text-[#536175]">{shortDate(p.startDate)} – {shortDate(p.endDate)} · {days(p.days)} · {p.legs.map((l) => l.time).join(' & ')}</p>
    <div className="mt-4 flex flex-wrap gap-2">{(p.riders || []).map((r) => <span key={r.name} className="rounded-full bg-[#eef2f7] px-3 py-1 text-[13px] font-semibold text-navy">{r.name}{r.grade ? ` · ${r.grade}` : ''}</span>)}</div>
    <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f4f6f9] p-3"><span className="w-16 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: sideView(p.vehicleType || 'sedan', { width: 64 }) }} /><span className="hidden h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">{(p.driver?.name || '?').slice(0, 1)}</span>
      <span className="text-sm"><b className="block">{p.driver?.name || 'Matching a vetted driver'}</b><span className="text-[#536175]">{p.driver ? `${p.driver.vehicle}${p.driver.rating ? ` · ★ ${p.driver.rating}` : ''}` : 'Trips are still covered by nearby vetted drivers'}</span></span></div>
    <div className="mt-4"><div className="flex justify-between text-[12px] text-[#5b6b82]"><span>{p.stats.tripsDriven} of {p.stats.tripsPlanned} trips driven</span><span>{p.stats.onTimeRate == null ? '' : `${p.stats.onTimeRate}% on time`}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e6ebf1]"><div className="h-full rounded-full bg-orange" style={{ width: `${pct}%` }} /></div></div>
    <div className="mt-auto flex items-center justify-between pt-4"><span className="font-display text-xl font-extrabold">{money(p.pricing.total)}</span><button className={p.status === 'awaiting_payment' ? button : outline} onClick={onOpen}>{p.status === 'awaiting_payment' ? 'Pay now' : 'Manage'}<Icon name="arrow" size={16} /></button></div>
  </article>;
}

function RoutesTable({ plans, onOpen }: { plans: PlanWithStats[]; onOpen: (id: string) => void }) {
  return <div className="overflow-x-auto rounded-2xl border border-[#d2dae4] bg-white"><table className="w-full min-w-[780px] text-left text-sm">
    <thead><tr className="border-b border-[#e1e6ed] text-[12px] uppercase tracking-wide text-[#5b6b82]"><th className="p-3">Route</th><th className="p-3">Shift</th><th className="p-3">Staff</th><th className="p-3">Driver</th><th className="p-3">This month</th><th className="p-3">On time</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
    <tbody>{plans.map((p) => <tr key={p.id} className="cursor-pointer border-b border-[#eef1f5] hover:bg-[#f7f9fb]" onClick={() => onOpen(p.id)}>
      <td className="p-3"><b>{p.pickup} → {p.destination}</b><span className="block text-[12px] text-[#5b6b82]">{p.ref} · {p.category}</span></td>
      <td className="p-3">{p.legs.map((l) => l.time).join(' / ')}<span className="block text-[12px] text-[#5b6b82]">{days(p.days)}</span></td>
      <td className="p-3">{p.riderCount}</td>
      <td className="p-3">{p.driver?.name || <span className="text-[#b34a00]">Matching</span>}</td>
      <td className="p-3">{p.stats.tripsDriven}/{p.stats.tripsPlanned}<span className="block text-[12px] text-[#5b6b82]">{money(p.stats.spent)} so far</span></td>
      <td className="p-3">{p.stats.onTimeRate == null ? '—' : `${p.stats.onTimeRate}%`}</td>
      <td className="p-3"><StatusPill status={PLAN_STATUS[p.status] || p.status} /></td>
      <td className="p-3 text-right"><Icon name="arrow" size={16} /></td></tr>)}</tbody>
  </table></div>;
}

/* ---------------- One plan ---------------- */
function PlanDetail({ plan: p, kind, notify, onBack, onChange, onTrack }: { plan: PlanWithStats; kind: PlanKind; notify: Notify; onBack: () => void; onChange: () => void; onTrack: (id: string) => void }) {
  const [busy, setBusy] = useState('');
  const scholar = kind === 'scholar';
  const live = ['awaiting_payment', 'awaiting_driver', 'active'].includes(p.status);
  const run = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try { await fn(); if (done) notify(done); onChange(); } catch (e) { notify((e as Error).message); } finally { setBusy(''); }
  };
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }); }, [p.id]);
  const toggleDay = (d: string, skipped: boolean) => run('day', () => api(`/plans/${p.id}/skip`, { body: { date: d, undo: skipped } }), skipped ? `${shortDate(d)} restored.` : `${shortDate(d)} skipped and will be refunded.`);
  return <div ref={top} className="grid scroll-mt-4 gap-5">
    <button className="justify-self-start text-sm font-semibold underline" onClick={onBack}>← All {scholar ? 'plans' : 'routes'}</button>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[12px] font-semibold uppercase tracking-wide text-[#5b6b82]">{p.ref} · {p.kindLabel}</p>
        <h3 className="font-display text-2xl font-extrabold text-navy">{scholar ? p.school : `${p.pickup} → ${p.destination}`}</h3>
        <p className="text-sm text-[#536175]">{longDate(p.startDate)} – {longDate(p.endDate)} · {days(p.days)} · {p.category}</p></div>
      <StatusPill status={PLAN_STATUS[p.status] || p.status} />
    </header>
    <PlanMap planId={p.id} scholar={scholar} onTrack={onTrack} />
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="self-start rounded-2xl border border-[#d2dae4] bg-white p-5 lg:col-span-2">
        <h4 className="mb-3 font-semibold">{new Date(`${p.startDate}T12:00:00+02:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</h4>
        <Calendar plan={p} onToggle={live ? toggleDay : undefined} busy={busy === 'day'} onTrack={onTrack} />
      </section>
      <aside className="grid content-start gap-4">
        <section className="rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm">
          <h4 className="mb-3 font-semibold">Driver</h4>
          {p.driver ? <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-lg font-bold text-white">{p.driver.name.slice(0, 1)}</span><span><b className="block">{p.driver.name}</b>{p.driver.vehicle}{p.driver.rating ? ` · ★ ${p.driver.rating}` : ''}</span></div>
            : <p className="text-[#536175]">Matching a {scholar ? 'vetted scholar-transport ' : ''}driver. Until one accepts the month, each trip goes to the nearest suitable driver.</p>}
          {scholar && <p className="mt-3 flex gap-2 rounded-lg bg-[#e8f5ee] p-3 text-[13px] text-[#17744a]"><Icon name="shield" size={16} className="mt-0.5 shrink-0" />Police clearance, child-protection register checks and learner-transport licence verified by DROP compliance.</p>}
        </section>
        <section className="rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm">
          <h4 className="mb-3 font-semibold">Trips</h4>
          <ul className="grid gap-2">{p.legs.map((l) => <li key={l.key}><b>{l.time}</b> {l.label}<span className="block text-[#536175]">{l.from} → {l.to}</span></li>)}</ul>
          <h4 className="mb-2 mt-4 font-semibold">{scholar ? 'Learners' : 'Staff'}</h4>
          <ul className="grid gap-1">{(p.riders || []).map((r) => <li key={r.name}>{r.name}{r.grade ? ` · ${r.grade}` : ''}{r.notes ? <span className="block text-[12px] text-[#536175]">{r.notes}</span> : null}</li>)}</ul>
          {p.guardian?.handover && <p className="mt-3"><b>Drop-off:</b> {p.guardian.handover}<br /><b>Emergency contact:</b> {p.guardian.emergencyName} · {p.guardian.emergencyPhone}</p>}
        </section>
        <section className="rounded-2xl border border-[#d2dae4] bg-white p-5 text-sm">
          <h4 className="mb-3 font-semibold">Statement</h4>
          <dl className="grid grid-cols-2 gap-y-2">
            <dt className="text-[#536175]">{p.payment === 'Card' ? 'Paid in advance' : 'Invoiced monthly'}</dt><dd className="text-right font-semibold">{p.payment === 'Card' ? money(p.pricing.total) : '—'}</dd>
            <dt className="text-[#536175]">Trips driven</dt><dd className="text-right font-semibold">{p.stats.tripsDriven} · {money(p.stats.spent)}</dd>
            <dt className="text-[#536175]">Days skipped</dt><dd className="text-right font-semibold">{p.skipDates.length}</dd>
            <dt className="text-[#536175]">Refunded</dt><dd className="text-right font-semibold">{money(p.refundedAmount || 0)}</dd>
            <dt className="text-[#536175]">On-time pickups</dt><dd className="text-right font-semibold">{p.stats.onTimeRate == null ? '—' : `${p.stats.onTimeRate}%`}</dd>
          </dl>
          <button className={`${outline} mt-4 w-full`} onClick={() => void download(`/plans/${p.id}/statement.csv`, `${p.ref}-statement.csv`).catch((e) => notify((e as Error).message))}>Download statement (CSV)</button>
        </section>
      </aside>
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#eef2f7] p-4">
      {p.status === 'awaiting_payment' && <button className={button} disabled={!!busy} onClick={() => run('pay', () => payPlan(p.id))}>{busy === 'pay' && <Spinner />}Pay {money(p.pricing.total)}</button>}
      {p.status === 'active' && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={p.autoRenew} disabled={!!busy} onChange={(e) => run('renew', () => api(`/plans/${p.id}/auto-renew`, { body: { autoRenew: e.target.checked } }), e.target.checked ? 'Will renew next month.' : 'Renewal switched off.')} />Renew next month</label>}
      {p.cancelEffective && <p className="text-sm text-[#8a3a00]">Cancelled: no trips after {new Date(p.cancelEffective).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Unused trips are refunded when the period closes.</p>}
      {live && <button className={`${outline} ml-auto text-red-700`} disabled={!!busy} onClick={() => {
        if (!window.confirm(p.status === 'awaiting_payment' ? 'Cancel this plan?' : 'Cancel this plan? Trips stop 24 hours from now, and every trip that doesn’t run is refunded when the period closes.')) return;
        void run('cancel', () => api(`/plans/${p.id}/cancel`, { body: {} }), 'Plan cancelled.');
      }}>Cancel plan</button>}
    </div>
  </div>;
}

/** Month view: service days, trips driven, skipped days, public holidays. Future days can be skipped or restored. */
export function Calendar({ plan: p, onToggle, busy, onTrack }: { plan: Plan & { stats: PlanStats }; onToggle?: (date: string, skipped: boolean) => void; busy?: boolean; onTrack?: (id: string) => void }) {
  const [y, m] = p.startDate.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const now = Date.now();
  const today = sastNow().slice(0, 10);
  const cells = useMemo(() => [...Array(lead).fill(null), ...Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)], [lead, last, y, m]);
  const notice = (d: string) => Date.parse(`${d}T${p.legs[0].time}:00+02:00`) - now >= 12 * 3_600_000;
  return <div>
    <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-[#8a96a8]">{DAY.map((d) => <span key={d}>{d}</span>)}</div>
    <div className="mt-1 grid grid-cols-7 gap-1">{cells.map((d, i) => {
      if (!d) return <span key={`x${i}`} />;
      const service = p.pricing.dates.includes(d);
      const skipped = p.skipDates.includes(d);
      const holiday = p.stats.holidays.includes(d);
      const before = d < p.startDate;
      const trips = Object.values(p.stats.byDate[d] || {});
      const driven = trips.filter((t) => t.status === 'completed').length;
      const missed = trips.some((t) => t.status === 'cancelled');
      const live = trips.find((t) => ['accepted', 'arriving', 'in_progress', 'requested'].includes(t.status));
      const canToggle = onToggle && service && notice(d);
      const tone = holiday ? 'bg-[#fff1e6] text-[#b34a00]' : skipped ? 'bg-[repeating-linear-gradient(135deg,#eef1f5_0_6px,#e2e7ee_6px_12px)] text-[#8a96a8] line-through'
        : driven && driven === p.legs.length ? 'bg-[#e8f5ee] text-[#17744a]' : missed ? 'bg-[#fdecec] text-[#b42828]' : service && !before ? 'bg-white text-navy ring-1 ring-[#cfd7e1]' : 'text-[#c0c8d3]';
      const label = `${d}: ${holiday ? 'public holiday' : skipped ? 'skipped' : driven ? `${driven} trip(s) driven` : service ? 'service day' : 'no trips'}`;
      return <button key={d} type="button" disabled={!canToggle && !live} aria-label={label} title={canToggle ? (skipped ? 'Restore this day' : 'Skip this day') : label}
        onClick={() => { if (live && onTrack) onTrack(live.id); else if (canToggle && onToggle) onToggle(d, skipped); }}
        className={`relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-lg text-sm font-semibold ${tone} ${canToggle || live ? 'hover:ring-2 hover:ring-orange' : ''} ${d === today ? 'outline outline-2 outline-orange' : ''} ${busy ? 'opacity-60' : ''}`}>
        {Number(d.slice(8))}
        {service && !skipped && !holiday && <span className="mt-0.5 flex gap-0.5">{p.legs.map((l) => { const t = p.stats.byDate[d]?.[l.key]; return <span key={l.key} className={`h-1.5 w-1.5 rounded-full ${t?.status === 'completed' ? 'bg-[#17744a]' : t?.status === 'cancelled' ? 'bg-[#b42828]' : t ? 'bg-orange' : 'bg-[#cfd7e1]'}`} />; })}</span>}
      </button>;
    })}</div>
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-[#536175]">
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded ring-1 ring-[#cfd7e1]" />Service day</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#e8f5ee]" />Driven</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[repeating-linear-gradient(135deg,#eef1f5_0_3px,#e2e7ee_3px_6px)]" />Skipped (refunded)</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#fff1e6]" />Public holiday</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#fdecec]" />Cancelled trip</li>
      {onToggle && <li className="font-semibold text-navy">Tap a future day to skip or restore it (12 hours’ notice).</li>}
    </ul>
  </div>;
}

