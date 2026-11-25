import { useState } from 'react';
import { api, money, date } from '../lib/api';
import { useStepUp, downloadProtected, printProtected } from '../lib/stepUp';
import { button, outline, input, Field, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { useLoad, Loading, Empty, Table, type Notify } from '../dashboard/common';
import { FillBar, GROUP_STATUS, BOOKING_STATUS, prettyDate, type GroupView, type GroupBooking } from './GroupTravel';

/* Group travel console for staff: groups (with alerts and KPIs), the group file (bookings, money,
   confirm with partner, partner payments, tickets, manifest), partners, routes, reports and demand. */

interface Money { heldInEscrow: number; collected: number; partnerCost: number; profit: number; profitFinal: boolean; paidToPartner: number; fees: number }
interface StaffGroup extends GroupView { bulkRate: number; money: Money; history: { status: string; at: string; note?: string }[]; failurePolicy: string; cancellationPolicy: Record<string, number>; closedAt?: string }
interface Partner { id: string; name: string; type: string; contactName: string; contactEmail: string; contactPhone: string; defaultCapacity: number; notes: string; active: boolean; routes: number; owed: number }
interface Route { id: string; partnerId: string; partner: string; type: string; origin: string; destination: string; originName: string; destinationName: string; international: boolean; capacity: number; minimum: number; bulkRate: number; pricePerPerson: number; marginPerSeat: number; deadlineDays: number; depositPct: number; failurePolicy: string; active: boolean; cancellationPolicy: { beforeDeadlinePct: number; afterDeadlinePct: number; afterTicketedPct: number } }
type StaffBooking = GroupBooking & { customer: { name: string; email: string; phone: string } | null; contactEmail: string; contactPhone: string; guardian: { name: string; relationship: string } | null };

const Kpi = ({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) => <div className={`rounded-xl border border-[#e3e8ef] p-4 ${tone}`}><p className="text-[12px] text-[#505d71]">{label}</p><p className="whitespace-nowrap font-display text-xl font-extrabold">{value}</p></div>;
const SUB = ['Groups', 'Partners', 'Routes', 'Reports', 'Demand'] as const;


export function TravelAdmin({ notify, role }: { notify: Notify; role: string }) {
  const [sub, setSub] = useState<(typeof SUB)[number]>('Groups');
  const [groupId, setGroupId] = useState<string | null>(null);
  const canWrite = role === 'admin';
  const canOps = role === 'admin' || role === 'support';
  return <div className="grid gap-5">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Group travel sections">{SUB.map((s) => <button key={s} role="tab" aria-selected={sub === s} onClick={() => { setSub(s); setGroupId(null); }} className={`min-h-10 rounded-full border px-4 text-sm ${sub === s ? 'border-navy bg-navy font-semibold text-white' : 'border-[#cbd0d7]'}`}>{s}</button>)}</div>
    {sub === 'Groups' && (groupId ? <GroupFile id={groupId} notify={notify} canWrite={canWrite} canOps={canOps} onBack={() => setGroupId(null)} /> : <Groups onOpen={setGroupId} notify={notify} canWrite={canWrite} />)}
    {sub === 'Partners' && <Partners notify={notify} canWrite={canWrite} />}
    {sub === 'Routes' && <Routes notify={notify} canWrite={canWrite} />}
    {sub === 'Reports' && <Reports />}
    {sub === 'Demand' && <Demand />}
  </div>;
}

/* ---------- Groups ---------- */
function Groups({ onOpen, notify, canWrite }: { onOpen: (id: string) => void; notify: Notify; canWrite: boolean }) {
  const [f, setF] = useState({ status: '', type: '', q: '', from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, reload } = useLoad<{ kpis: Record<string, number>; alerts: (GroupView & { shortBy: number })[]; toConfirm: GroupView[]; groups: StaffGroup[] }>(`/admin/travel/groups${qs ? `?${qs}` : ''}`);
  const [creating, setCreating] = useState(false);
  if (!data) return <Loading />;
  const k = data.kpis;
  return <div className="grid gap-5">
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi label="Open groups" value={k.open} /><Kpi label="To confirm with partner" value={k.toConfirm} tone={k.toConfirm ? 'bg-[#fff1e6]' : ''} /><Kpi label="Confirmed / ticketed" value={k.confirmed} />
      <Kpi label="Travellers (paid)" value={k.travellers} /><Kpi label="Held in escrow" value={money(k.heldInEscrow)} />
      <Kpi label="Owed to partners" value={money(k.owedToPartners)} /><Kpi label="Margin earned" value={money(k.margin)} /><Kpi label="Cancellation fees" value={money(k.fees)} /><Kpi label="Interest requests" value={k.interest} />
    </div>
    {!!data.toConfirm.length && <div className="grid gap-2 rounded-xl border border-[#f3c79b] bg-[#fff8f1] p-4"><p className="font-semibold">Ready to confirm with the partner</p>{data.toConfirm.map((g) => <button key={g.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white p-3 text-left text-sm hover:ring-1 hover:ring-navy" onClick={() => onOpen(g.id)}><span><b>{g.ref}</b> · {g.originName} → {g.destinationName} · {prettyDate(g.departureDate)}</span><span>{g.paidSeats} travellers</span></button>)}</div>}
    {!!data.alerts.length && <div className="grid gap-2 rounded-xl border border-red-200 bg-[#fdf2f2] p-4"><p className="font-semibold text-[#b42828]">At risk: deadline within 7 days, below minimum</p>{data.alerts.map((g) => <button key={g.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white p-3 text-left text-sm hover:ring-1 hover:ring-navy" onClick={() => onOpen(g.id)}><span><b>{g.ref}</b> · {g.originName} → {g.destinationName} · {prettyDate(g.departureDate)}</span><span>{g.shortBy} short · {g.daysLeft} day(s) left</span></button>)}</div>}
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Search"><input className={input} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Ref, city or code" /></Field>
      <Field label="Status"><select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{Object.entries(GROUP_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Type"><select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All</option><option value="flight">Flight</option><option value="bus">Bus</option></select></Field>
      <Field label="Departs from"><input type="date" className={input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <Field label="to"><input type="date" className={input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      {canWrite && <button className={outline} onClick={() => setCreating(!creating)}><Icon name="plus" size={17} />New group</button>}
    </div>
    {creating && <NewGroup notify={notify} onDone={() => { setCreating(false); void reload(); }} />}
    {!data.groups.length ? <Empty>No groups match.</Empty> : <Table head={['Group', 'Trip', 'Fill', 'Money', 'Status', '']} rows={data.groups.map((g) => [
      <span key="r" className="whitespace-nowrap"><b>{g.ref}</b><span className="block text-[12px]">{g.typeLabel}{g.sequence > 1 && ` · overflow ${g.sequence}`}</span></span>,
      <span key="t">{g.originName} → {g.destinationName}<span className="block text-[12px]">{prettyDate(g.departureDate)}{g.returnDate && ` – ${prettyDate(g.returnDate)}`} · deadline {new Date(g.deadline).toLocaleDateString('en-ZA')}</span></span>,
      <span key="f" className="block min-w-40"><FillBar paid={g.paidSeats} capacity={g.capacity} minimum={g.minimum} /></span>,
      <span key="m" className="whitespace-nowrap text-[12px]">Escrow {money(g.money.heldInEscrow)}<span className="block">{g.money.profitFinal ? 'Profit' : 'Expected'} {money(g.money.profit)}</span></span>,
      <StatusPill key="s" status={GROUP_STATUS[g.status] || g.status} />,
      <button key="o" className={outline} onClick={() => onOpen(g.id)}>Open</button>,
    ])} />}
  </div>;
}

function NewGroup({ notify, onDone }: { notify: Notify; onDone: () => void }) {
  const { data } = useLoad<{ routes: Route[] }>('/admin/travel/routes');
  const [f, setF] = useState({ routeId: '', departureDate: '', returnDate: '' });
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    try { const r = await api<{ group: GroupView }>('/admin/travel/groups', { body: { ...f, returnDate: f.returnDate || undefined } }); notify(`Group ${r.group.ref} opened.`); onDone(); } catch (err) { setError((err as Error).message); }
  }
  return <form className="grid items-end gap-3 rounded-xl bg-[#f4f6f8] p-4 sm:grid-cols-4" onSubmit={submit}>
    <Field label="Route"><select className={input} required value={f.routeId} onChange={(e) => setF({ ...f, routeId: e.target.value })}><option value="">Choose…</option>{data?.routes.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.origin} → {r.destination} · {r.partner}</option>)}</select></Field>
    <Field label="Departure"><input type="date" className={input} required value={f.departureDate} onChange={(e) => setF({ ...f, departureDate: e.target.value })} /></Field>
    <Field label="Return (optional)"><input type="date" className={input} value={f.returnDate} onChange={(e) => setF({ ...f, returnDate: e.target.value })} /></Field>
    <button className={button}>Open group</button><div className="sm:col-span-4"><ErrorText>{error}</ErrorText></div>
  </form>;
}

/* ---------- Group file ---------- */
function GroupFile({ id, notify, canWrite, canOps, onBack }: { id: string; notify: Notify; canWrite: boolean; canOps: boolean; onBack: () => void }) {
  const { data, reload } = useLoad<{ group: StaffGroup; money: Money; partner: Partner; bookings: StaffBooking[]; payouts: { id: string; amountCents: number; kind: string; reference: string; createdAt: string }[]; partnerOwed: number }>(`/admin/travel/groups/${id}`);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [partnerRef, setPartnerRef] = useState('');
  const [payout, setPayout] = useState({ amount: '', kind: 'balance', reference: '' });
  const [tickets, setTickets] = useState<Record<string, { ticketNumber: string; seat: string }>>({});
  const [cancel, setCancel] = useState({ open: false, reason: '', policy: '' });
  const stepUp = useStepUp();
  if (!data) return <Loading />;
  const g = data.group; const m = data.money;
  const run = async (k: string, fn: () => Promise<unknown>, msg: string) => { setBusy(k); setError(''); try { await fn(); notify(msg); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  const active = data.bookings.filter((b) => ['deposit_paid', 'paid', 'ticketed', 'completed'].includes(b.status));
  const unpaidBalances = active.filter((b) => b.status === 'deposit_paid').length;
  const confirmable = ['MINIMUM_REACHED', 'FULL'].includes(g.status);
  const confirmed = ['CONFIRMED_WITH_PARTNER', 'TICKETED'].includes(g.status);
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-[#505d71]">{g.ref} · {g.typeLabel} · {data.partner?.name}</p><h4 className="font-display text-xl font-extrabold">{g.originName} ({g.origin}) → {g.destinationName} ({g.destination})</h4><p className="text-sm">{prettyDate(g.departureDate)}{g.returnDate && ` – ${prettyDate(g.returnDate)}`} · fill deadline {date(g.deadline)}</p></div>
      <div className="flex items-center gap-3"><StatusPill status={GROUP_STATUS[g.status] || g.status} /><button className={outline} onClick={onBack}>All groups</button></div></div>
    {stepUp.dialog}
    <FillBar paid={g.paidSeats} capacity={g.capacity} minimum={g.minimum} />
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"><Kpi label="Held in escrow" value={money(m.heldInEscrow)} /><Kpi label="Collected (net)" value={money(m.collected)} /><Kpi label="Partner cost" value={money(m.partnerCost)} /><Kpi label={m.profitFinal ? 'Profit' : 'Expected profit'} value={money(m.profit)} /><Kpi label="Paid to partner" value={money(m.paidToPartner)} /><Kpi label="Fees" value={money(m.fees)} /></div>
    <p className="text-sm text-[#505d71]">Price {money(g.pricePerPerson)} per person · bulk rate {money(g.bulkRate)} · deposit {g.depositPct}% · if it doesn’t fill: {g.failurePolicy === 'transfer' ? 'offer another date' : 'refund'}{g.partnerReference && <> · partner reference <b className="text-navy">{g.partnerReference}</b></>}</p>
    <ErrorText>{error}</ErrorText>

    {canWrite && confirmable && <section className="grid gap-3 rounded-xl border border-[#e3e8ef] p-4"><p className="font-semibold">Confirm with {data.partner?.name}</p>
      <p className="text-sm">Book {g.paidSeats} seats with the partner using the manifest, then enter their booking reference. This releases the group’s escrow: {money(g.bulkRate * g.paidSeats)} becomes payable to the partner and the rest is margin.{unpaidBalances > 0 && <b className="text-[#b42828]"> {unpaidBalances} booking(s) still owe a balance. Wait for the balance date or cancel them first.</b>}</p>
      <div className="flex flex-wrap gap-3"><input className={`${input} max-w-xs`} aria-label="Partner booking reference" placeholder="Partner booking reference / PNR" value={partnerRef} onChange={(e) => setPartnerRef(e.target.value)} />
        <button className={button} disabled={!!busy || !partnerRef.trim()} onClick={() => run('c', () => api(`/admin/travel/groups/${g.id}/confirm`, { body: { partnerReference: partnerRef } }), 'Group confirmed with the partner.')}>{busy === 'c' && <Spinner />}Confirm group</button></div></section>}

    {canOps && <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e3e8ef] p-4"><p className="mr-auto text-sm"><b>Passenger manifest</b><span className="block text-[12px] text-[#505d71]">Contains full passport numbers, so you’ll be asked for an authenticator code. Every download is logged. Share only with this partner.</span></p>
      <button className={outline} onClick={() => { setError(''); stepUp.guard(() => downloadProtected(`/admin/travel/groups/${g.id}/manifest.csv`, `${g.ref}-manifest.csv`)).then((now) => now && notify('Manifest downloaded.')).catch((e) => setError((e as Error).message)); }}><Icon name="file" size={17} />CSV</button>
      <button className={outline} onClick={() => { setError(''); stepUp.guard(() => printProtected(`/admin/travel/groups/${g.id}/manifest.html`)).then((now) => now && notify('Manifest opened for printing.')).catch((e) => setError((e as Error).message)); }}><Icon name="file" size={17} />Print / PDF</button></section>}

    {canWrite && <section className="grid gap-3 rounded-xl border border-[#e3e8ef] p-4"><p className="font-semibold">Payments to partner</p>
      <p className="text-sm">Owed to {data.partner?.name} across all groups: <b>{money(data.partnerOwed)}</b></p>
      {!!data.payouts.length && <ul className="grid gap-1 text-sm">{data.payouts.map((p) => <li key={p.id}>{date(p.createdAt)} · {p.kind} · {money(p.amountCents / 100)} · ref {p.reference}</li>)}</ul>}
      <div className="flex flex-wrap items-end gap-3"><Field label="Amount (R)"><input type="number" min={0} step="0.01" className={input} value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} /></Field>
        <Field label="Type"><select className={input} value={payout.kind} onChange={(e) => setPayout({ ...payout, kind: e.target.value })}><option value="balance">Balance (after confirmation)</option><option value="deposit">Deposit to hold seats</option></select></Field>
        <Field label="EFT reference"><input className={input} value={payout.reference} onChange={(e) => setPayout({ ...payout, reference: e.target.value })} /></Field>
        <button className={outline} disabled={!!busy} onClick={() => run('p', async () => { await api(`/admin/travel/groups/${g.id}/payout`, { body: { ...payout, amount: Number(payout.amount) } }); setPayout({ amount: '', kind: 'balance', reference: '' }); }, 'Partner payment recorded.')}>Record payment</button></div></section>}

    <section className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Bookings ({data.bookings.length})</p>
      {canOps && confirmed && <button className={button} disabled={!!busy || !Object.keys(tickets).length} onClick={() => run('tk', async () => { const r = await api<{ ticketed: boolean }>(`/admin/travel/groups/${g.id}/tickets`, { body: { tickets: Object.entries(tickets).filter(([, t]) => t.ticketNumber.trim()).map(([passengerId, t]) => ({ passengerId, ...t })) } }); setTickets({}); if (r.ticketed) notify('All travellers ticketed and notified.'); }, 'Tickets saved.')}>{busy === 'tk' && <Spinner />}Save tickets</button>}</div>
      {!data.bookings.length ? <Empty>No bookings yet.</Empty> : data.bookings.map((b) => <div key={b.id} className="grid gap-2 rounded-xl border border-[#e3e8ef] p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><span><b>{b.ref}</b> · {b.customer?.name} · <a className="underline" href={`mailto:${b.contactEmail}`}>{b.contactEmail}</a>{b.contactPhone && ` · ${b.contactPhone}`}<span className="block text-[12px] text-[#505d71]">{b.seats} seat(s) · total {money(b.total)} · paid {money(b.paid)}{b.refunded > 0 && ` · refunded ${money(b.refunded)}`}{b.feeCharged > 0 && ` · fee ${money(b.feeCharged)}`}{b.guardian && ` · guardian ${b.guardian.name} (${b.guardian.relationship})`}</span></span>
          <span className="flex items-center gap-2"><StatusPill status={BOOKING_STATUS[b.status] || b.status} />{canOps && ['deposit_paid', 'paid', 'ticketed', 'held'].includes(b.status) && <BookingCancel b={b} canWaive={canWrite} onDone={(msg) => { notify(msg); void reload(); }} />}</span></div>
        <ul className="grid gap-1">{b.passengers.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f6f8] px-3 py-2"><span>{p.fullName}{p.minor && ' · minor'} · {p.nationality}{p.passport && ` · passport ${p.passport}`}</span>
          {canOps && confirmed && ['paid', 'ticketed'].includes(b.status) ? <span className="flex gap-2"><input aria-label={`Ticket number for ${p.fullName}`} className="min-h-9 w-32 rounded-lg border border-[#d9dce1] px-2" placeholder="Ticket no." defaultValue={p.ticketNumber} onChange={(e) => setTickets((t) => ({ ...t, [p.id!]: { ticketNumber: e.target.value, seat: t[p.id!]?.seat ?? p.seat ?? '' } }))} /><input aria-label={`Seat for ${p.fullName}`} className="min-h-9 w-16 rounded-lg border border-[#d9dce1] px-2" placeholder="Seat" defaultValue={p.seat} onChange={(e) => setTickets((t) => ({ ...t, [p.id!]: { ticketNumber: t[p.id!]?.ticketNumber ?? p.ticketNumber ?? '', seat: e.target.value } }))} /></span>
            : p.ticketNumber && <span>Ticket {p.ticketNumber}{p.seat && ` · ${p.seat}`}</span>}</li>)}</ul>
      </div>)}
    </section>

    <details className="text-sm"><summary className="cursor-pointer font-semibold">Group history</summary><ul className="mt-2 grid gap-1">{g.history.map((h, i) => <li key={i}>{date(h.at)} · {GROUP_STATUS[h.status] || h.status}{h.note && ` · ${h.note}`}</li>)}</ul></details>

    {canWrite && !['TICKETED', 'COMPLETED', 'CANCELLED'].includes(g.status) && (cancel.open
      ? <section className="grid gap-3 rounded-xl border border-red-200 bg-[#fdf2f2] p-4 text-sm"><p className="font-semibold">Cancel this group</p><p>Every paying traveller is either refunded in full or offered another date. This can’t be undone.</p>
          <Field label="Reason (shown to travellers)"><input className={input} value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} /></Field>
          <Field label="What travellers get"><select className={input} value={cancel.policy || g.failurePolicy} onChange={(e) => setCancel({ ...cancel, policy: e.target.value })}><option value="refund">Full refund</option><option value="transfer">Offer another date (refund if declined)</option></select></Field>
          <div className="flex gap-3"><button className={button} disabled={!!busy || cancel.reason.trim().length < 3} onClick={() => run('x', () => api(`/admin/travel/groups/${g.id}/cancel`, { body: { reason: cancel.reason, policy: cancel.policy || g.failurePolicy } }), 'Group cancelled and travellers notified.')}>Cancel group</button><button className={outline} onClick={() => setCancel({ open: false, reason: '', policy: '' })}>Keep group</button></div></section>
      : <button className="justify-self-start text-sm text-red-800 underline" onClick={() => setCancel({ ...cancel, open: true })}>Cancel group…</button>)}
  </div>;
}

function BookingCancel({ b, canWaive, onDone }: { b: StaffBooking; canWaive: boolean; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [waive, setWaive] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <button className="text-[12px] text-red-800 underline" onClick={() => setOpen(true)}>Cancel</button>;
  return <span className="grid gap-2 rounded-lg border border-red-200 bg-white p-2"><input className="min-h-9 rounded-lg border border-[#d9dce1] px-2" aria-label="Cancellation reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    {canWaive && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />Waive the cancellation fee</label>}
    <span className="flex gap-2"><button className="rounded-lg bg-navy px-3 py-1 text-[12px] font-semibold text-white" onClick={async () => { try { await api(`/admin/travel/bookings/${b.id}/cancel`, { body: { reason, waiveFee: waive } }); onDone(`${b.ref} cancelled.`); } catch (e) { setError((e as Error).message); } }}>Confirm</button><button className="text-[12px] underline" onClick={() => setOpen(false)}>Back</button></span><ErrorText>{error}</ErrorText></span>;
}

/* ---------- Partners ---------- */
const emptyPartner = { name: '', type: 'flight', contactName: '', contactEmail: '', contactPhone: '', defaultCapacity: 180, notes: '', active: true };
function Partners({ notify, canWrite }: { notify: Notify; canWrite: boolean }) {
  const { data, reload } = useLoad<{ partners: Partner[] }>('/admin/travel/partners');
  const [edit, setEdit] = useState<(typeof emptyPartner & { id?: string }) | null>(null);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError('');
    try { if (edit!.id) await api(`/admin/travel/partners/${edit!.id}`, { method: 'PUT', body: edit }); else await api('/admin/travel/partners', { body: edit }); notify('Partner saved.'); setEdit(null); void reload(); } catch (err) { setError((err as Error).message); }
  }
  if (!data) return <Loading />;
  return <div className="grid gap-4">
    {canWrite && !edit && <button className={`${outline} justify-self-start`} onClick={() => setEdit({ ...emptyPartner })}><Icon name="plus" size={17} />Add partner</button>}
    {edit && <form className="grid items-end gap-3 rounded-xl bg-[#f4f6f8] p-4 sm:grid-cols-3" onSubmit={save}>
      <Field label="Airline or coach operator"><input className={input} required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
      <Field label="Type"><select className={input} value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}><option value="flight">Airline</option><option value="bus">Bus / coach</option></select></Field>
      <Field label="Default capacity"><input type="number" min={1} className={input} value={edit.defaultCapacity} onChange={(e) => setEdit({ ...edit, defaultCapacity: Number(e.target.value) })} /></Field>
      <Field label="Groups desk contact"><input className={input} value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
      <Field label="Email"><input type="email" className={input} value={edit.contactEmail} onChange={(e) => setEdit({ ...edit, contactEmail: e.target.value })} /></Field>
      <Field label="Phone"><input className={input} value={edit.contactPhone} onChange={(e) => setEdit({ ...edit, contactPhone: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="Notes (contract terms, payment schedule)"><input className={input} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
      <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active</label>
      <div className="flex gap-3 sm:col-span-3"><button className={button}>Save partner</button><button type="button" className={outline} onClick={() => setEdit(null)}>Cancel</button></div><div className="sm:col-span-3"><ErrorText>{error}</ErrorText></div>
    </form>}
    {!data.partners.length ? <Empty>No partners yet. Add the airlines and coach operators you have group agreements with.</Empty> : <Table head={['Partner', 'Contact', 'Routes', 'Owed', 'Status', '']} rows={data.partners.map((p) => [
      <span key="n"><b>{p.name}</b><span className="block text-[12px]">{p.type === 'flight' ? 'Airline' : 'Coach'} · capacity {p.defaultCapacity}</span></span>,
      <span key="c">{p.contactName || '—'}<span className="block text-[12px]">{p.contactEmail}{p.contactPhone && ` · ${p.contactPhone}`}</span></span>,
      p.routes, money(p.owed), <StatusPill key="s" status={p.active ? 'active' : 'inactive'} />,
      canWrite ? <button key="e" className={outline} onClick={() => setEdit({ ...emptyPartner, ...p })}>Edit</button> : '',
    ])} />}
  </div>;
}

/* ---------- Routes ---------- */
const emptyRoute = { partnerId: '', origin: '', originName: '', destination: '', destinationName: '', international: false, capacity: 0, minimum: 0, bulkRate: 0, pricePerPerson: 0, deadlineDays: 0, depositPct: 30, failurePolicy: 'refund', active: true, cancellationPolicy: { beforeDeadlinePct: 0, afterDeadlinePct: 50, afterTicketedPct: 100 } };
function Routes({ notify, canWrite }: { notify: Notify; canWrite: boolean }) {
  const { data, reload } = useLoad<{ routes: Route[] }>('/admin/travel/routes');
  const partners = useLoad<{ partners: Partner[] }>('/admin/travel/partners').data?.partners || [];
  const [edit, setEdit] = useState<(typeof emptyRoute & { id?: string }) | null>(null);
  const [error, setError] = useState('');
  const num = (v: number) => (v ? v : undefined);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const body = { ...edit, capacity: num(edit!.capacity), minimum: num(edit!.minimum), deadlineDays: num(edit!.deadlineDays) };
    try { if (edit!.id) await api(`/admin/travel/routes/${edit!.id}`, { method: 'PUT', body }); else await api('/admin/travel/routes', { body }); notify('Route saved. New groups use these terms; open groups keep theirs.'); setEdit(null); void reload(); } catch (err) { setError((err as Error).message); }
  }
  if (!data) return <Loading />;
  const set = (k: string, v: unknown) => setEdit((x) => x && { ...x, [k]: v });
  const pol = (k: string, v: number) => setEdit((x) => x && { ...x, cancellationPolicy: { ...x.cancellationPolicy, [k]: v } });
  return <div className="grid gap-4">
    {canWrite && !edit && <button className={`${outline} justify-self-start`} disabled={!partners.length} onClick={() => setEdit({ ...emptyRoute })}><Icon name="plus" size={17} />Add route</button>}
    {edit && <form className="grid items-end gap-3 rounded-xl bg-[#f4f6f8] p-4 sm:grid-cols-4" onSubmit={save}>
      <Field label="Partner"><select className={input} required value={edit.partnerId} onChange={(e) => set('partnerId', e.target.value)}><option value="">Choose…</option>{partners.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="From code"><input className={input} required value={edit.origin} onChange={(e) => set('origin', e.target.value.toUpperCase())} placeholder="JNB" /></Field>
      <Field label="From name"><input className={input} required value={edit.originName} onChange={(e) => set('originName', e.target.value)} placeholder="Johannesburg (O.R. Tambo)" /></Field>
      <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={edit.international} onChange={(e) => set('international', e.target.checked)} />International (passport required)</label>
      <Field label="To code"><input className={input} required value={edit.destination} onChange={(e) => set('destination', e.target.value.toUpperCase())} placeholder="DXB" /></Field>
      <Field label="To name"><input className={input} required value={edit.destinationName} onChange={(e) => set('destinationName', e.target.value)} placeholder="Dubai" /></Field>
      <Field label="Seats per group" hint="Blank = partner default"><input type="number" min={0} className={input} value={edit.capacity || ''} onChange={(e) => set('capacity', Number(e.target.value))} /></Field>
      <Field label="Minimum to confirm" hint="Blank = 70% of seats"><input type="number" min={0} className={input} value={edit.minimum || ''} onChange={(e) => set('minimum', Number(e.target.value))} /></Field>
      <Field label="Partner bulk rate per seat (R)"><input type="number" min={0} step="0.01" className={input} required value={edit.bulkRate || ''} onChange={(e) => set('bulkRate', Number(e.target.value))} /></Field>
      <Field label="Price per person (R)" hint={edit.pricePerPerson && edit.bulkRate ? `Margin ${money(edit.pricePerPerson - edit.bulkRate)} per seat` : undefined}><input type="number" min={0} step="0.01" className={input} required value={edit.pricePerPerson || ''} onChange={(e) => set('pricePerPerson', Number(e.target.value))} /></Field>
      <Field label="Fill deadline (days before)" hint="Blank = 21 (flight) / 3 (bus)"><input type="number" min={0} className={input} value={edit.deadlineDays || ''} onChange={(e) => set('deadlineDays', Number(e.target.value))} /></Field>
      <Field label="Deposit %"><input type="number" min={0} max={100} className={input} value={edit.depositPct} onChange={(e) => set('depositPct', Number(e.target.value))} /></Field>
      <Field label="If the group doesn’t fill"><select className={input} value={edit.failurePolicy} onChange={(e) => set('failurePolicy', e.target.value)}><option value="refund">Refund everyone</option><option value="transfer">Offer another date</option></select></Field>
      <Field label="Cancel fee before deadline %"><input type="number" min={0} max={100} className={input} value={edit.cancellationPolicy.beforeDeadlinePct} onChange={(e) => pol('beforeDeadlinePct', Number(e.target.value))} /></Field>
      <Field label="Cancel fee after deadline %"><input type="number" min={0} max={100} className={input} value={edit.cancellationPolicy.afterDeadlinePct} onChange={(e) => pol('afterDeadlinePct', Number(e.target.value))} /></Field>
      <Field label="Cancel fee once ticketed %"><input type="number" min={0} max={100} className={input} value={edit.cancellationPolicy.afterTicketedPct} onChange={(e) => pol('afterTicketedPct', Number(e.target.value))} /></Field>
      <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => set('active', e.target.checked)} />Active (bookable)</label>
      <div className="flex gap-3 sm:col-span-4"><button className={button}>Save route</button><button type="button" className={outline} onClick={() => setEdit(null)}>Cancel</button></div><div className="sm:col-span-4"><ErrorText>{error}</ErrorText></div>
    </form>}
    {!data.routes.length ? <Empty>No routes yet. Add a partner first, then the routes they’ve agreed group rates for.</Empty> : <Table head={['Route', 'Partner', 'Group', 'Price / bulk', 'Terms', 'Status', '']} rows={data.routes.map((r) => [
      <span key="r"><b>{r.origin} → {r.destination}</b><span className="block text-[12px]">{r.originName} → {r.destinationName}{r.international && ' · intl'}</span></span>,
      r.partner, `${r.minimum}–${r.capacity} seats`,
      <span key="p">{money(r.pricePerPerson)}<span className="block text-[12px]">bulk {money(r.bulkRate)} · margin {money(r.marginPerSeat)}</span></span>,
      <span key="t" className="text-[12px]">Deadline {r.deadlineDays} days · deposit {r.depositPct}%<span className="block">Fees {r.cancellationPolicy.beforeDeadlinePct}/{r.cancellationPolicy.afterDeadlinePct}/{r.cancellationPolicy.afterTicketedPct}% · {r.failurePolicy}</span></span>,
      <StatusPill key="s" status={r.active ? 'active' : 'inactive'} />,
      canWrite ? <button key="e" className={outline} onClick={() => setEdit({ ...emptyRoute, ...r })}>Edit</button> : '',
    ])} />}
  </div>;
}

/* ---------- Reports and demand ---------- */
function Reports() {
  const [by, setBy] = useState('month');
  const { data } = useLoad<{ rows: { key: string; groups: number; travellers: number; revenue: number; partnerCost: number; profit: number; fees: number; cancelled: number }[] }>(`/admin/travel/reports?by=${by}`);
  const tot = data?.rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, profit: a.profit + r.profit, fees: a.fees + r.fees, travellers: a.travellers + r.travellers }), { revenue: 0, profit: 0, fees: 0, travellers: 0 });
  return <div className="grid gap-4">
    <div className="flex flex-wrap gap-2">{[['month', 'By month'], ['route', 'By route'], ['partner', 'By partner']].map(([v, l]) => <button key={v} aria-pressed={by === v} className={`min-h-10 rounded-full border px-4 text-sm ${by === v ? 'border-navy bg-navy text-white' : 'border-[#cbd0d7]'}`} onClick={() => setBy(v)}>{l}</button>)}</div>
    {!data ? <Loading /> : !data.rows.length ? <Empty>No groups have closed yet.</Empty> : <>
      <div className="grid gap-3 sm:grid-cols-4"><Kpi label="Travellers" value={tot!.travellers} /><Kpi label="Revenue" value={money(tot!.revenue)} /><Kpi label="Profit (margin)" value={money(tot!.profit)} /><Kpi label="Cancellation fees" value={money(tot!.fees)} /></div>
      <Table head={[by === 'month' ? 'Month (departure)' : by === 'route' ? 'Route' : 'Partner', 'Groups', 'Cancelled', 'Travellers', 'Revenue', 'Partner cost', 'Profit', 'Fees']} rows={data.rows.map((r) => [r.key, r.groups, r.cancelled, r.travellers, money(r.revenue), money(r.partnerCost), money(r.profit), money(r.fees)])} />
    </>}
  </div>;
}

function Demand() {
  const { data } = useLoad<{ demand: { type: string; origin: string; destination: string; requests: number; travellers: number; months: string[] }[] }>('/admin/travel/interest');
  if (!data) return <Loading />;
  return !data.demand.length ? <Empty>No interest requests yet. When customers search a route you don’t run, their requests appear here.</Empty>
    : <Table head={['Route', 'Type', 'Requests', 'Travellers', 'Months wanted']} rows={data.demand.map((d) => [`${d.origin} → ${d.destination}`, d.type, d.requests, d.travellers, d.months.join(', ')])} />;
}
