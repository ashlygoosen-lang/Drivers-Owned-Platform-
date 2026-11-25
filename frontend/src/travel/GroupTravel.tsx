import { useEffect, useMemo, useState } from 'react';
import { api, money, date, token } from '../lib/api';
export const GROUP_TRAVEL_PENDING = 'drop.groupTravel.pending';
import { button, outline, input, Field, ErrorText, Icon, Spinner, StatusPill, Logo } from '../components/ui';
import { useLoad, Loading, Empty, type Notify } from '../dashboard/common';

/* Group travel (flights and buses): customers join a group on a route and date; when it reaches its
   minimum the trip goes ahead at the group rate. Shared by the public /group-travel page and My DROP. */

export interface GroupView {
  id: string; ref: string; type: 'flight' | 'bus'; typeLabel: string; origin: string; destination: string; originName: string; destinationName: string;
  international: boolean; departureDate: string; returnDate: string | null; capacity: number; minimum: number; seatsTaken: number; paidSeats: number; seatsLeft: number;
  pricePerPerson: number; pricePerPersonUsd: number | null; depositPct: number; deadline: string; daysLeft: number; status: string; joinable: boolean;
  fillPct: number; minimumPct: number; sequence: number; partner?: { id: string; name: string } | null; partnerReference?: string | null;
}
interface NewGroup { capacity: number; minimum: number; pricePerPerson: number; pricePerPersonUsd: number | null; depositPct: number; deadline: string; daysLeft: number }
interface Result { route: { id: string; type: string; typeLabel: string; origin: string; destination: string; originName: string; destinationName: string; international: boolean; partner: string }; group: GroupView | null; newGroup: NewGroup | null; tooLate: boolean; alternatives: GroupView[]; fits: boolean }
interface Passenger { id?: string; fullName: string; dateOfBirth: string; nationality: string; passport?: string; passportNumber?: string; passportExpiry?: string; minor?: boolean; ticketNumber?: string; seat?: string }
export interface GroupBooking {
  id: string; ref: string; status: string; seats: number; total: number; pricePerPerson: number; option: string; paid: number; refunded: number; balance: number;
  balanceDueAt: string | null; depositDue: number; holdExpiresAt: string; cancelReason: string | null; feeCharged: number; transferOfferExpiresAt: string | null;
  refundPending: number; createdAt: string; totalUsd: number | null; group: GroupView | null; passengers: Passenger[]; history: { status: string; at: string; note?: string }[];
}
export const BOOKING_STATUS: Record<string, string> = {
  held: 'Awaiting payment', deposit_paid: 'Deposit paid', paid: 'Paid in full', ticketed: 'Ticketed', completed: 'Completed', cancelled: 'Cancelled',
  expired: 'Hold expired', refunded: 'Refunded', transfer_offered: 'Choose another date',
};
export const GROUP_STATUS: Record<string, string> = {
  OPEN: 'Open', MINIMUM_REACHED: 'Minimum reached', FULL: 'Full', CONFIRMED_WITH_PARTNER: 'Confirmed', TICKETED: 'Ticketed', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const PENDING_KEY = GROUP_TRAVEL_PENDING;
const today = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
export const prettyDate = (d: string) => new Date(`${d}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const usd = (n: number | null) => (n == null ? '' : ` (≈ US$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);

/** Seats paid against capacity, with a marker at the minimum needed to confirm. */
export function FillBar({ paid, capacity, minimum }: { paid: number; capacity: number; minimum: number }) {
  const pct = Math.min(100, Math.round((paid / capacity) * 100));
  const min = Math.round((minimum / capacity) * 100);
  const reached = paid >= minimum;
  return <div className="grid gap-1">
    <div className="relative h-3 overflow-hidden rounded-full bg-[#e3e8ef]" role="progressbar" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={paid} aria-label={`${paid} of ${capacity} seats taken, ${minimum} needed`}>
      <div className={`h-full rounded-full ${reached ? 'bg-[#17744a]' : 'bg-orange'}`} style={{ width: `${pct}%` }} />
      <span className="absolute inset-y-0 w-0.5 bg-navy" style={{ left: `${min}%` }} aria-hidden />
    </div>
    <p className="text-[12px] text-[#505d71]">{paid} of {capacity} seats · {reached ? 'minimum reached, trip goes ahead' : `${minimum - paid} more needed to confirm`}</p>
  </div>;
}

/* ============ Search ============ */
export function TravelSearch({ onJoin }: { onJoin: (sel: { routeId: string; departureDate: string; returnDate: string; travellers: number; summary: string; international: boolean; price: number; depositPct: number }) => void }) {
  const [places, setPlaces] = useState<{ code: string; name: string }[]>([]);
  const [q, setQ] = useState({ type: '', origin: '', destination: '', departureDate: '', returnDate: '', travellers: 1, oneWay: false });
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState<'idle' | 'form' | 'sent'>('idle');
  const [email, setEmail] = useState('');
  useEffect(() => { api<{ places: { code: string; name: string }[] }>('/travel/places').then((r) => setPlaces(r.places)).catch(() => undefined); }, []);
  const set = (k: keyof typeof q, v: unknown) => setQ((x) => ({ ...x, [k]: v }));
  async function search(e?: React.FormEvent, dep = q.departureDate) {
    e?.preventDefault();
    setError(''); setBusy(true); setInterest('idle');
    try {
      const p = new URLSearchParams({ origin: q.origin, destination: q.destination, departureDate: dep, travellers: String(q.travellers) });
      if (q.type) p.set('type', q.type);
      if (!q.oneWay && q.returnDate) p.set('returnDate', q.returnDate);
      setResults((await api<{ results: Result[] }>(`/travel/search?${p}`)).results);
    } catch (err) { setError((err as Error).message); setResults(null); } finally { setBusy(false); }
  }
  async function registerInterest() {
    setError('');
    try {
      await api('/travel/interest', { body: { type: q.type || 'flight', origin: q.origin, destination: q.destination, departureDate: q.departureDate, returnDate: q.oneWay ? undefined : q.returnDate || undefined, travellers: q.travellers, email } });
      setInterest('sent');
    } catch (err) { setError((err as Error).message); }
  }
  const signedIn = !!token.get();
  return <div className="grid gap-6">
    <form className="grid items-end gap-4 rounded-2xl border border-[#e3e8ef] bg-white p-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={search}>
      <datalist id="travel-places">{places.map((p) => <option key={p.code} value={p.name}>{p.code}</option>)}</datalist>
      <Field label="Travel by"><select className={input} value={q.type} onChange={(e) => set('type', e.target.value)}><option value="">Flight or bus</option><option value="flight">Flight</option><option value="bus">Bus / coach</option></select></Field>
      <Field label="From"><input className={input} required list="travel-places" value={q.origin} onChange={(e) => set('origin', e.target.value)} placeholder="City or airport" /></Field>
      <Field label="To"><input className={input} required list="travel-places" value={q.destination} onChange={(e) => set('destination', e.target.value)} placeholder="City or airport" /></Field>
      <Field label="Travellers"><input type="number" min={1} max={20} className={input} value={q.travellers} onChange={(e) => set('travellers', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></Field>
      <Field label="Departure"><input type="date" className={input} required min={today()} value={q.departureDate} onChange={(e) => set('departureDate', e.target.value)} /></Field>
      <Field label="Return"><input type="date" className={input} disabled={q.oneWay} min={q.departureDate || today()} value={q.oneWay ? '' : q.returnDate} onChange={(e) => set('returnDate', e.target.value)} /></Field>
      <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={q.oneWay} onChange={(e) => set('oneWay', e.target.checked)} />One way</label>
      <button className={button} disabled={busy}>{busy ? <Spinner /> : <Icon name="arrow" size={18} />}Find groups</button>
    </form>
    <ErrorText>{error}</ErrorText>
    {results && !results.length && <div className="grid gap-3 rounded-2xl border border-dashed border-[#cbd2dc] p-6 text-sm">
      <p>We don’t run group trips on this route yet. Tell us you’re interested and we’ll email you when a group opens. Demand helps us negotiate group rates with airlines and coach operators.</p>
      {interest === 'sent' ? <p className="font-semibold text-[#17744a]">Thanks, we’ve noted your interest.</p>
        : interest === 'form' || !signedIn ? <div className="flex flex-wrap items-end gap-3">{!signedIn && <Field label="Your email"><input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}<button type="button" className={outline} onClick={registerInterest}>Notify me</button></div>
        : <button type="button" className={outline} onClick={registerInterest}>Notify me when a group opens</button>}
    </div>}
    {results?.map((r) => {
      const g = r.group; const n = r.newGroup;
      const price = g?.pricePerPerson ?? n?.pricePerPerson ?? 0;
      const priceUsd = g?.pricePerPersonUsd ?? n?.pricePerPersonUsd ?? null;
      const canJoin = (g ? g.joinable && g.seatsLeft >= q.travellers : !!n) && r.fits;
      const summary = `${r.route.typeLabel} · ${r.route.originName} → ${r.route.destinationName} · ${prettyDate(q.departureDate)}${!q.oneWay && q.returnDate ? ` – ${prettyDate(q.returnDate)}` : ''}`;
      return <article key={r.route.id} className="grid gap-4 rounded-2xl border border-[#e3e8ef] bg-white p-5 shadow-[0_8px_24px_#071b3a0d]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-[#505d71]"><Icon name={r.route.type === 'flight' ? 'up' : 'car'} size={15} />{r.route.typeLabel} · {r.route.partner}{r.route.international && ' · International'}</p>
            <h4 className="mt-1 font-display text-xl font-extrabold">{r.route.originName} ({r.route.origin}) → {r.route.destinationName} ({r.route.destination})</h4>
            <p className="text-sm text-[#505d71]">{prettyDate(q.departureDate)}{!q.oneWay && q.returnDate && ` · return ${prettyDate(q.returnDate)}`}</p></div>
          <div className="text-right"><p className="font-display text-2xl font-extrabold">{money(price)}</p><p className="text-[12px] text-[#505d71]">per person{usd(priceUsd)}</p></div>
        </div>
        {g ? <FillBar paid={g.paidSeats} capacity={g.capacity} minimum={g.minimum} />
          : n && <p className="rounded-xl bg-[#ebeff4] p-3 text-sm">No group on this date yet. Be the first: a group of {n.capacity} opens when you join, and goes ahead once {n.minimum} travellers have paid.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-[#505d71]">{r.tooLate ? 'Too close to departure to fill a group.' : `Fills by ${new Date((g?.deadline || n?.deadline) as string).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} (${g?.daysLeft ?? n?.daysLeft} days left) · ${g?.depositPct ?? n?.depositPct}% deposit option`}{!r.fits && ' · not enough seats for your party'}</p>
          <button className={button} disabled={!canJoin} onClick={() => onJoin({ routeId: r.route.id, departureDate: q.departureDate, returnDate: q.oneWay ? '' : q.returnDate, travellers: q.travellers, summary, international: r.route.international, price, depositPct: g?.depositPct ?? n?.depositPct ?? 0 })}>Join this group</button>
        </div>
        {!!r.alternatives.length && <div className="grid gap-2 border-t border-[#e3e8ef] pt-3"><p className="text-sm font-semibold">Other groups on this route</p>
          <div className="flex flex-wrap gap-2">{r.alternatives.map((a) => <button key={a.id} className="rounded-xl border border-[#cbd0d7] px-3 py-2 text-left text-[13px] hover:bg-grey" onClick={() => { set('departureDate', a.departureDate); set('returnDate', a.returnDate || ''); set('oneWay', !a.returnDate); void search(undefined, a.departureDate); }}>
            <b>{prettyDate(a.departureDate)}</b><span className="block">{a.paidSeats}/{a.capacity} seats · {money(a.pricePerPerson)}</span></button>)}</div></div>}
      </article>;
    })}
  </div>;
}

/* ============ Join ============ */
type Sel = Parameters<Parameters<typeof TravelSearch>[0]['onJoin']>[0];
const blank = (): Passenger => ({ fullName: '', dateOfBirth: '', nationality: 'South African', passportNumber: '', passportExpiry: '' });
const ageOn = (dob: string, on: string) => { if (!dob) return 99; const a = new Date(dob), b = new Date(on); let y = b.getFullYear() - a.getFullYear(); if (b < new Date(b.getFullYear(), a.getMonth(), a.getDate())) y--; return y; };

export async function payGroupBooking(id: string) {
  const r = await api<{ authorizationUrl: string }>(`/payments/travel/${id}/checkout`, { body: {} });
  window.location.href = r.authorizationUrl;
}

export function JoinForm({ sel, notify, onDone }: { sel: Sel; notify: Notify; onDone: () => void }) {
  const [pax, setPax] = useState<Passenger[]>(() => Array.from({ length: sel.travellers }, blank));
  const [option, setOption] = useState<'full' | 'deposit'>('full');
  const [guardian, setGuardian] = useState({ name: '', relationship: 'Parent', consent: false });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const minors = pax.some((p) => p.dateOfBirth && ageOn(p.dateOfBirth, sel.departureDate) < 18);
  const total = sel.price * pax.length;
  const dueNow = option === 'deposit' ? Math.round(total * sel.depositPct) / 100 : total;
  const setP = (i: number, k: keyof Passenger, v: string) => setPax((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api<{ booking: GroupBooking }>('/travel/join', { body: {
        routeId: sel.routeId, departureDate: sel.departureDate, returnDate: sel.returnDate || undefined, paymentOption: option,
        passengers: pax.map((p) => ({ ...p, fullName: p.fullName.trim(), passportNumber: p.passportNumber || undefined, passportExpiry: p.passportNumber ? p.passportExpiry : undefined })),
        ...(minors && { guardian }),
      } });
      notify(`Seats held for 30 minutes (${r.booking.ref}). Taking you to secure card payment…`);
      await payGroupBooking(r.booking.id);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <form className="grid gap-6" onSubmit={submit}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-lg font-semibold">Join the group</h4><p className="text-sm text-[#505d71]">{sel.summary}</p></div><button type="button" className={outline} onClick={onDone}>Back</button></div>
    {pax.map((p, i) => <fieldset key={i} className="grid items-start gap-4 rounded-2xl border border-[#e3e8ef] p-4 sm:grid-cols-2">
      <legend className="px-1 font-semibold">Traveller {i + 1}{p.dateOfBirth && ageOn(p.dateOfBirth, sel.departureDate) < 18 && <span className="ml-2 rounded-full bg-[#fff1e6] px-2 text-[12px] text-[#b34a00]">Under 18</span>}</legend>
      <Field label="Full name, exactly as on passport or ID"><input className={input} required autoComplete={i ? 'off' : 'name'} value={p.fullName} onChange={(e) => setP(i, 'fullName', e.target.value)} /></Field>
      <Field label="Date of birth"><input type="date" className={input} required max={today()} value={p.dateOfBirth} onChange={(e) => setP(i, 'dateOfBirth', e.target.value)} /></Field>
      <Field label="Nationality"><input className={input} required value={p.nationality} onChange={(e) => setP(i, 'nationality', e.target.value)} /></Field>
      <Field label={sel.international ? 'Passport number' : 'Passport number (optional)'} hint="Encrypted, and shared only with the airline or coach operator for this trip."><input className={input} required={sel.international} autoComplete="off" value={p.passportNumber} onChange={(e) => setP(i, 'passportNumber', e.target.value.toUpperCase())} /></Field>
      {(sel.international || p.passportNumber) && <Field label="Passport expiry date" hint="Must be valid after you return. Many countries need 6 months’ validity."><input type="date" className={input} required min={sel.returnDate || sel.departureDate} value={p.passportExpiry} onChange={(e) => setP(i, 'passportExpiry', e.target.value)} /></Field>}
      {pax.length > 1 && <button type="button" className="justify-self-start text-sm text-red-800 underline sm:col-span-2" onClick={() => setPax((xs) => xs.filter((_, j) => j !== i))}>Remove traveller</button>}
    </fieldset>)}
    {pax.length < 20 && <button type="button" className={`${outline} justify-self-start`} onClick={() => setPax((xs) => [...xs, blank()])}><Icon name="plus" size={17} />Add traveller</button>}
    {minors && <fieldset className="grid gap-4 rounded-2xl border border-[#f3c79b] bg-[#fff8f1] p-4 sm:grid-cols-2"><legend className="px-1 font-semibold">Parent or guardian consent</legend>
      <Field label="Parent or guardian full name"><input className={input} required value={guardian.name} onChange={(e) => setGuardian({ ...guardian, name: e.target.value })} /></Field>
      <Field label="Relationship"><select className={input} value={guardian.relationship} onChange={(e) => setGuardian({ ...guardian, relationship: e.target.value })}><option>Parent</option><option>Legal guardian</option><option>Family member with parental responsibility</option></select></Field>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" required checked={guardian.consent} onChange={(e) => setGuardian({ ...guardian, consent: e.target.checked })} /><span>I am the parent or legal guardian of the travellers under 18. I consent to DROP processing their personal information to book this trip (POPIA section 35), and I understand that travel documents and any required consent affidavits for minors are my responsibility.</span></label>
    </fieldset>}
    <fieldset className="grid gap-3"><legend className="mb-2 font-semibold">Payment</legend>
      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${option === 'full' ? 'border-navy bg-[#f3f6fa]' : 'border-[#cbd0d7]'}`}><input type="radio" name="opt" className="mt-1" checked={option === 'full'} onChange={() => setOption('full')} /><span><b>Pay in full: {money(total)}</b><span className="block text-sm text-[#505d71]">Nothing more to pay.</span></span></label>
      {sel.depositPct > 0 && sel.depositPct < 100 && <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${option === 'deposit' ? 'border-navy bg-[#f3f6fa]' : 'border-[#cbd0d7]'}`}><input type="radio" name="opt" className="mt-1" checked={option === 'deposit'} onChange={() => setOption('deposit')} /><span><b>Pay a {sel.depositPct}% deposit: {money(Math.round(total * sel.depositPct) / 100)}</b><span className="block text-sm text-[#505d71]">Pay the balance of {money(total - Math.round(total * sel.depositPct) / 100)} by the group’s fill deadline. We remind you by email.</span></span></label>}
    </fieldset>
    <div className="grid gap-2 rounded-xl bg-[#ebeff4] p-4 text-sm">
      <p>Your money is held in a separate account for this group and only paid to the airline or coach operator once the group is confirmed. If the group doesn’t reach its minimum, you get a full refund (or the option to move to another date).</p>
      <p>Cancelling is free until the fill deadline. After it, the fee is 50%, and 100% once tickets are issued. See <a className="underline" href="/legal/cancellations-refunds" target="_blank" rel="noreferrer">Cancellations &amp; refunds</a>.</p>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" required checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to the <a className="underline" href="/legal/terms" target="_blank" rel="noreferrer">Terms of Service</a> and the group travel cancellation policy, and confirm the traveller details match their passports or IDs.</span></label>
    </div>
    <ErrorText>{error}</ErrorText>
    <button className={`${button} justify-self-start`} disabled={busy}>{busy && <Spinner />}Hold seats and pay {money(dueNow)}</button>
  </form>;
}

/* ============ My group trips ============ */
function Countdown({ until }: { until: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const ms = Date.parse(until) - Date.now();
  if (ms <= 0) return <span>expired</span>;
  return <span>{Math.floor(ms / 60000)}:{String(Math.floor(ms / 1000) % 60).padStart(2, '0')}</span>;
}

function BookingDetail({ id, notify, onBack }: { id: string; notify: Notify; onBack: () => void }) {
  const { data, reload } = useLoad<{ booking: GroupBooking; cancellation: { feePct: number }; alternatives: GroupView[] }>(`/travel/my/${id}`);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!data) return <Loading />;
  const b = data.booking; const g = b.group!;
  const run = async (k: string, fn: () => Promise<unknown>, msg: string) => { setBusy(k); setError(''); try { await fn(); notify(msg); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  const left = b.paid - b.refunded;
  const fee = Math.round(left * data.cancellation.feePct) / 100;
  const canCancel = ['held', 'deposit_paid', 'paid', 'ticketed'].includes(b.status);
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-[#505d71]">{b.ref} · group {g.ref}</p><h4 className="font-display text-xl font-extrabold">{g.originName} → {g.destinationName}</h4><p className="text-sm">{g.typeLabel} · {prettyDate(g.departureDate)}{g.returnDate && ` – ${prettyDate(g.returnDate)}`}</p></div>
      <div className="flex items-center gap-3"><StatusPill status={BOOKING_STATUS[b.status] || b.status} /><button className={outline} onClick={onBack}>All trips</button></div></div>
    {b.status === 'held' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#fff1e6] p-4 text-sm"><p>Your seats are held for <b><Countdown until={b.holdExpiresAt} /></b>. Pay to keep them.</p><button className={button} disabled={!!busy} onClick={() => run('pay', () => payGroupBooking(b.id), 'Taking you to payment…')}>Pay {money(b.depositDue)}</button></div>}
    {b.status === 'deposit_paid' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#fff1e6] p-4 text-sm"><p>Balance of <b>{money(b.balance)}</b> due by <b>{b.balanceDueAt ? new Date(b.balanceDueAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' }) : 'the deadline'}</b>.</p><button className={button} disabled={!!busy} onClick={() => run('pay', () => payGroupBooking(b.id), 'Taking you to payment…')}>Pay balance</button></div>}
    {b.status === 'transfer_offered' && <div className="grid gap-3 rounded-xl border border-[#f3c79b] bg-[#fff8f1] p-4 text-sm">
      <p>This group didn’t reach its minimum. Move to another group on the same route at no extra cost, or take a full refund of {money(left)}.{b.transferOfferExpiresAt && ` If you don’t choose by ${new Date(b.transferOfferExpiresAt).toLocaleDateString('en-ZA')}, we refund you automatically.`}</p>
      {data.alternatives.length ? <div className="flex flex-wrap gap-2">{data.alternatives.map((a) => <button key={a.id} className={outline} disabled={!!busy} onClick={() => run('t', () => api(`/travel/my/${b.id}/transfer`, { body: { groupId: a.id } }), `Moved to ${prettyDate(a.departureDate)}.`)}>{prettyDate(a.departureDate)} · {a.paidSeats}/{a.capacity} seats</button>)}</div> : <p>No other groups with space right now.</p>}
      <button className={`${outline} justify-self-start`} disabled={!!busy} onClick={() => run('r', () => api(`/travel/my/${b.id}/decline-transfer`, { body: {} }), 'Refund started. Allow 5–10 business days.')}>Refund me instead</button>
    </div>}
    <FillBar paid={g.paidSeats} capacity={g.capacity} minimum={g.minimum} />
    <div className="grid gap-3 sm:grid-cols-4">{[['Total', money(b.total)], ['Paid', money(b.paid)], ['Balance', money(b.balance)], ['Refunded', money(b.refunded)]].map(([k, v]) => <div key={k} className="rounded-xl bg-[#f4f6f8] p-3"><p className="text-[12px] text-[#505d71]">{k}</p><p className="font-semibold">{v}</p></div>)}</div>
    {g.partnerReference && <p className="text-sm">Airline / operator booking reference: <b>{g.partnerReference}</b></p>}
    <div className="grid gap-2"><p className="font-semibold">Travellers</p>{b.passengers.map((p, i) => <div key={i} className="flex flex-wrap justify-between gap-2 rounded-xl border border-[#e3e8ef] p-3 text-sm"><span><b>{p.fullName}</b>{p.minor && ' · under 18'}<span className="block text-[12px] text-[#505d71]">{p.nationality}{p.passport && ` · passport ${p.passport}`}</span></span>{p.ticketNumber ? <span className="text-right">Ticket <b>{p.ticketNumber}</b>{p.seat && <span className="block text-[12px]">Seat {p.seat}</span>}</span> : <span className="text-[12px] text-[#505d71]">Ticket to follow</span>}</div>)}</div>
    {b.refundPending > 0 && <p className="rounded-xl bg-[#fff1e6] p-3 text-sm">A refund of {money(b.refundPending)} is being processed.</p>}
    <details className="text-sm"><summary className="cursor-pointer font-semibold">History</summary><ul className="mt-2 grid gap-1">{b.history.map((h, i) => <li key={i}>{date(h.at)} · {BOOKING_STATUS[h.status] || h.status}{h.note && ` · ${h.note}`}</li>)}</ul></details>
    <ErrorText>{error}</ErrorText>
    {canCancel && (confirmCancel
      ? <div className="grid gap-3 rounded-xl border border-red-200 bg-[#fdf2f2] p-4 text-sm"><p>{b.status === 'held' ? 'Release these seats?' : `Cancelling now costs ${data.cancellation.feePct}% (${money(fee)}). You get ${money(left - fee)} back.`}</p>
          <div className="flex gap-3"><button className={button} disabled={!!busy} onClick={() => run('c', () => api(`/travel/my/${b.id}/cancel`, { body: {} }), 'Booking cancelled.')}>{busy === 'c' && <Spinner />}Yes, cancel</button><button className={outline} onClick={() => setConfirmCancel(false)}>Keep booking</button></div></div>
      : <button className="justify-self-start text-sm text-red-800 underline" onClick={() => setConfirmCancel(true)}>Cancel booking</button>)}
  </div>;
}

/** The "Group travel" tab in My DROP: find and join a group, and manage your group trips. */
export function MyGroupTravel({ notify }: { notify: Notify }) {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'search' } | { kind: 'join'; sel: Sel } | { kind: 'detail'; id: string }>(() => {
    try { const p = sessionStorage.getItem(PENDING_KEY); if (p) { sessionStorage.removeItem(PENDING_KEY); return { kind: 'join', sel: JSON.parse(p) as Sel }; } } catch { /* storage unavailable */ }
    return { kind: 'list' };
  });
  const { data, reload } = useLoad<{ bookings: GroupBooking[] }>(view.kind === 'list' ? '/travel/my' : null);
  useEffect(() => { if (view.kind === 'list') void reload(); }, [view.kind, reload]);
  const upcoming = useMemo(() => data?.bookings.filter((b) => !['cancelled', 'expired', 'refunded', 'completed'].includes(b.status)) || [], [data]);
  const past = useMemo(() => data?.bookings.filter((b) => !upcoming.includes(b)) || [], [data, upcoming]);
  if (view.kind === 'search') return <div className="grid gap-4"><div className="flex justify-end"><button className={outline} onClick={() => setView({ kind: 'list' })}>My group trips</button></div><TravelSearch onJoin={(sel) => setView({ kind: 'join', sel })} /></div>;
  if (view.kind === 'join') return <JoinForm sel={view.sel} notify={notify} onDone={() => setView({ kind: 'search' })} />;
  if (view.kind === 'detail') return <BookingDetail id={view.id} notify={notify} onBack={() => setView({ kind: 'list' })} />;
  const row = (b: GroupBooking) => <button key={b.id} onClick={() => setView({ kind: 'detail', id: b.id })} className="grid gap-3 rounded-2xl border border-[#e3e8ef] p-4 text-left hover:border-navy sm:grid-cols-[1fr_auto]">
    <span><span className="text-[12px] text-[#505d71]">{b.ref} · {b.group?.typeLabel}</span><span className="block font-semibold">{b.group?.originName} → {b.group?.destinationName}</span><span className="block text-sm">{b.group && prettyDate(b.group.departureDate)} · {b.seats} traveller{b.seats > 1 ? 's' : ''} · <span className="whitespace-nowrap">{money(b.total)}</span></span>
      {b.group && !['cancelled', 'expired', 'refunded'].includes(b.status) && <span className="mt-2 block max-w-md"><FillBar paid={b.group.paidSeats} capacity={b.group.capacity} minimum={b.group.minimum} /></span>}</span>
    <span className="sm:text-right"><StatusPill status={BOOKING_STATUS[b.status] || b.status} />{b.status === 'deposit_paid' && <span className="mt-1 block text-[12px]">Balance {money(b.balance)}</span>}</span>
  </button>;
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-navy p-5 text-white"><div><p className="font-display text-lg font-extrabold">Travel together, pay less</p><p className="text-sm text-white/80">Join a group flight or coach trip. When the group fills, everyone gets the group rate.</p></div><button className="motion-button gold-button inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold text-navy" onClick={() => setView({ kind: 'search' })}><Icon name="plus" size={17} />Find a group</button></div>
    {!data ? <Loading /> : !data.bookings.length ? <Empty>No group trips yet. Find a group to join above.</Empty> : <>
      {!!upcoming.length && <div className="grid gap-3"><p className="font-semibold">Upcoming</p>{upcoming.map(row)}</div>}
      {!!past.length && <details className="grid gap-3"><summary className="cursor-pointer font-semibold">Past and cancelled ({past.length})</summary><div className="mt-3 grid gap-3">{past.map(row)}</div></details>}
    </>}
  </div>;
}

/* ============ Public page ============ */
export function GroupTravelPage() {
  const [sel, setSel] = useState<Sel | null>(null);
  useEffect(() => { document.title = 'Group travel: flights and coaches at group rates · DROP'; }, []);
  const join = (s: Sel) => {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
    setSel(s);
    window.location.href = '/?open=group-travel';
  };
  return <main className="min-h-screen bg-[#f4f6f8] text-navy">
    <header className="bg-navy px-5 py-5"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><a href="/" aria-label="DROP home"><Logo light /></a><a className="text-sm font-semibold text-white underline" href="/?open=group-travel">My group trips</a></div></header>
    <section className="bg-navy px-5 pb-14 pt-6 text-white"><div className="mx-auto max-w-6xl"><p className="text-[12px] font-bold uppercase tracking-[0.2em] text-orange">Group travel</p>
      <h1 className="mt-2 max-w-3xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">Fly or take the coach together. Pay the group rate.</h1>
      <p className="mt-4 max-w-2xl text-white/80">Join a group on your route and date. Once enough travellers have joined, we book the whole group with the airline or coach operator at a bulk rate and send everyone their tickets. If it doesn’t fill, you get your money back.</p></div></section>
    <div className="mx-auto -mt-8 grid max-w-6xl gap-8 px-5 pb-16">
      {sel ? <p className="flex items-center gap-3 rounded-2xl bg-white p-5"><Spinner />Opening your booking…</p> : <TravelSearch onJoin={join} />}
      <section className="grid gap-4 sm:grid-cols-3">{[
        ['1. Join a group', 'Pick a route and date, add your travellers and pay in full or a deposit. Your seats are held for 30 minutes while you pay.'],
        ['2. The group fills', 'Watch it fill in My DROP. Your money sits in a separate account for this group, not in our operating account.'],
        ['3. We book and ticket', 'At the deadline we confirm the group with the airline or operator, then email your ticket numbers. Too few people? Full refund.'],
      ].map(([t, d]) => <div key={t} className="rounded-2xl bg-white p-5"><p className="font-display text-lg font-extrabold">{t}</p><p className="mt-2 text-sm text-[#505d71]">{d}</p></div>)}</section>
      <p className="text-sm text-[#505d71]">Prices are charged in South African rand; dollar amounts are estimates. Passport details are encrypted and shared only with the airline or operator for your trip (POPIA). <a className="underline" href="/legal/privacy">Privacy Policy</a> · <a className="underline" href="/legal/cancellations-refunds">Cancellations &amp; refunds</a></p>
    </div>
  </main>;
}
