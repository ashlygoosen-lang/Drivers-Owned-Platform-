import { useEffect, useState } from 'react';
import { api, money, STATUS_LABEL, type ApiError, type Booking, type Quote, type Service } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthForm } from './AuthForm';
import { TripComms } from '../components/TripComms';
import { button, outline, input, Field, ErrorText, Icon, MapView, Spinner } from '../components/ui';

export interface TripDraft { service: Service; pickup: string; destination: string; when: string; passengers: number }
type Step = 'details' | 'options' | 'auth' | 'tracking' | 'rate';

export const WHEN_OPTIONS = ['Now', 'In 30 minutes', 'In 1 hour', 'Tomorrow, 09:00', 'Choose a time'];
function scheduledFrom(when: string, custom: string): string | null {
  const d = new Date();
  if (when === 'In 30 minutes') return new Date(+d + 30 * 60_000).toISOString();
  if (when === 'In 1 hour') return new Date(+d + 60 * 60_000).toISOString();
  if (when === 'Tomorrow, 09:00') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); }
  if (when === 'Choose a time' && custom) return new Date(custom).toISOString();
  return null;
}

export function bookingTitle(service: Service, step: Step, booking?: Booking | null) {
  if (step === 'tracking' && booking) return booking.status === 'completed' ? 'Thanks for moving with DROP.' : booking.status === 'cancelled' ? 'Booking cancelled.' : 'Your journey is booked.';
  if (step === 'rate') return 'How was your journey?';
  if (step === 'auth') return 'Sign in to confirm your booking';
  return `${service} · ${step === 'options' ? 'Choose your journey' : 'Let’s get you moving'}`;
}

export function BookingFlow({ draft, existing, onTitle, onNotice, onClose, onVerify }: {
  draft: TripDraft; existing?: Booking | null; onTitle: (t: string) => void; onNotice: (m: string) => void; onClose: () => void; onVerify: () => void;
}) {
  const { user } = useAuth();
  const [service, setService] = useState<Service>(draft.service);
  const [pickup, setPickup] = useState(draft.pickup);
  const [destination, setDestination] = useState(draft.destination);
  const [when, setWhen] = useState(draft.when);
  const [custom, setCustom] = useState('');
  const [passengers, setPassengers] = useState(draft.passengers);
  const [parcel, setParcel] = useState('');
  const [passengerName, setPassengerName] = useState('');
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [category, setCategory] = useState('');
  const [payment, setPayment] = useState(user?.paymentPreference || 'Card');
  const [booking, setBooking] = useState<Booking | null>(existing || null);
  const [step, setStep] = useState<Step>(existing ? 'tracking' : draft.pickup && draft.destination ? 'options' : 'details');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [cardOn, setCardOn] = useState(false);
  useEffect(() => { api<{ card: boolean }>('/payments/config').then((r) => { setCardOn(r.card); if (!r.card) setPayment((x) => (x === 'Card' ? 'Cash' : x)); }).catch(() => setPayment((x) => (x === 'Card' ? 'Cash' : x))); }, []);

  useEffect(() => { onTitle(bookingTitle(service, step, booking)); }, [service, step, booking, onTitle]);

  // Arriving with addresses already filled (from the homepage form): fetch the quote straight away.
  useEffect(() => { if (step === 'options' && !quote) void estimate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Live status while a trip is active.
  useEffect(() => {
    if (step !== 'tracking' || !booking || ['completed', 'cancelled'].includes(booking.status)) return;
    const timer = setInterval(async () => {
      try { setBooking((await api<{ booking: Booking }>(`/bookings/${booking.id}`)).booking); } catch { /* keep last state */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [step, booking]);

  async function estimate() {
    setError('');
    if (!pickup.trim() || !destination.trim()) { setError('Please enter both pickup and destination addresses.'); setStep('details'); return; }
    setBusy(true);
    try {
      const q = await api<Quote>('/fares/estimate', { body: { service, pickup, destination } });
      setQuote(q);
      setCategory((c) => q.options.some((o) => o.category === c) ? c : q.options[0].category);
      setStep('options');
    } catch (err) { setError((err as Error).message); setStep('details'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!user) { setStep('auth'); return; }
    if (!['passenger', 'business'].includes(user.role)) { setError('Please book from a passenger or business account.'); return; }
    setError('');
    setNeedsVerify(false);
    setBusy(true);
    try {
      const res = await api<{ booking: Booking }>('/bookings', {
        body: { service, category, pickup, destination, passengers, parcel, passengerName, notes, payment, scheduledFor: scheduledFrom(when, custom) },
      });
      if (res.booking.status === 'awaiting_payment') { await pay(res.booking); return; }
      setBooking(res.booking);
      setStep('tracking');
    } catch (err) {
      setError((err as Error).message);
      setNeedsVerify((err as ApiError).code === 'verification_required');
    }
    finally { setBusy(false); }
  }

  async function pay(b: Booking) {
    try {
      const r = await api<{ authorizationUrl: string }>(`/payments/bookings/${b.id}/checkout`, { body: {} });
      window.location.assign(r.authorizationUrl); // Paystack secure checkout; returns to /?payment_ref=…
    } catch (err) { setBooking(b); setStep('tracking'); setError((err as Error).message); }
  }

  async function cancel() {
    if (!booking) return;
    setBusy(true);
    try {
      const res = await api<{ booking: Booking }>(`/bookings/${booking.id}/cancel`, { body: {} });
      setBooking(res.booking);
      onNotice(`Booking ${res.booking.ref} was cancelled. No fee was charged.`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function rate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(`/bookings/${booking!.id}/rate`, { body: { rating: Number(f.get('rating')), feedback: f.get('feedback') } });
      onNotice('Thank you. Your rating helps DROP drivers grow.');
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const selected = quote?.options.find((o) => o.category === category);
  const active = booking && ['accepted', 'arriving', 'in_progress'].includes(booking.status);

  return <div className="grid gap-6 md:grid-cols-2">
    <div className="step-panel" key={step}>
      {step === 'details' && <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void estimate(); }}>
        <div className="flex gap-1 rounded-lg bg-[#eef1f4] p-1">{(['Ride', 'Delivery', 'Premium Drive'] as Service[]).map((s) => <button type="button" key={s} aria-pressed={service === s} onClick={() => { setService(s); setQuote(null); }} className={`min-h-10 flex-1 rounded-md px-2 text-sm font-semibold ${service === s ? 'bg-forest text-white shadow-sm' : 'text-[#5a6575]'}`}>{s}</button>)}</div>
        <p className="text-sm leading-6 text-[#596576]">{service === 'Premium Drive' ? 'Executive sedans and luxury SUVs with professional drivers, for airport, corporate and special-occasion travel.' : service === 'Delivery' ? 'Reliable collection and delivery across the city, with an upfront price.' : 'Set your pickup and destination to see your upfront fare.'}</p>
        <Field label="Pickup location"><input required className={input} value={pickup} onChange={(e) => setPickup(e.target.value)} list="drop-places" placeholder={service === 'Delivery' ? 'Collection address' : 'Where from?'} autoComplete="street-address" /></Field>
        <Field label="Destination"><input required className={input} value={destination} onChange={(e) => setDestination(e.target.value)} list="drop-places" placeholder={service === 'Delivery' ? 'Drop-off address' : 'Where to?'} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="When"><select className={input} value={when} onChange={(e) => setWhen(e.target.value)}>{WHEN_OPTIONS.map((w) => <option key={w}>{w}</option>)}</select></Field>
          {service === 'Delivery'
            ? <Field label="Parcel type"><select className={input} onChange={(e) => setCategory(e.target.value)}><option>Documents</option><option>Small parcel</option><option>Food & retail</option></select></Field>
            : <Field label="Passengers"><select className={input} value={passengers} onChange={(e) => setPassengers(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>}
        </div>
        {when === 'Choose a time' && <Field label="Date and time"><input required type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} className={input} /></Field>}
        {service === 'Delivery' && <Field label="What are we delivering?"><input required className={input} value={parcel} onChange={(e) => setParcel(e.target.value)} placeholder="e.g. Signed contract, one envelope" /></Field>}
        <ErrorText>{error}</ErrorText>
        <button className={button} disabled={busy}>{busy && <Spinner />}Get fare estimate <Icon name="arrow" size={17} /></button>
      </form>}

      {step === 'options' && <div className="grid gap-4">
        {busy && !quote ? <p className="flex items-center gap-3 text-sm"><Spinner /> Calculating your fare…</p> : quote && <>
          <div className="rounded-xl bg-[#e6ecf3] p-4 text-sm leading-7"><p>○ &nbsp; {pickup}</p><p>● &nbsp; {destination}</p><p className="mt-1 text-[12px] text-[#505d71]">{quote.distanceKm} km · about {quote.durationMin} min{quote.approximate && ' · approximate distance, confirmed by your driver'}</p></div>
          <div className="grid gap-3" role="radiogroup" aria-label="Choose a category">{quote.options.map((o) => <button key={o.category} role="radio" aria-checked={category === o.category} onClick={() => setCategory(o.category)} className={`option-card flex items-center gap-4 rounded-xl border p-4 text-left ${category === o.category ? 'border-forest bg-[#dfe6f0]' : 'border-[#d2dae4] hover:border-[#ff8229]'}`}><Icon name={service === 'Delivery' ? 'box' : 'car'} size={30} /><span className="flex-1 text-sm font-semibold">{o.category}<span className="mt-1 block text-[12px] font-normal text-[#505d71]">{o.description}{o.seats ? ` · up to ${o.seats} seats` : ''}</span></span><b>{money(o.fare)}</b></button>)}</div>
          {user?.role === 'business' && <Field label="Traveller name (optional)"><input className={input} value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder="Employee or guest name" /></Field>}
          <Field label="Note for your driver (optional)"><input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, landmark, luggage…" maxLength={300} /></Field>
          <Field label="Payment method" hint={payment === 'Card' ? 'You’ll pay securely with Paystack before we find your driver.' : undefined}><select className={input} value={payment} onChange={(e) => setPayment(e.target.value)}>{cardOn && <option value="Card">Card (pay now, secure checkout)</option>}<option value="Cash">Cash, paid to your driver</option>{user?.role === 'business' && <option value="Business account">Business account (monthly invoice)</option>}</select></Field>
          {selected && <div className="grid gap-2 rounded-xl border border-[#d2dae4] p-4 text-sm">
            <div className="flex justify-between"><span>Fare</span><b>{money(selected.fare)}</b></div>
            <div className="flex justify-between text-forest"><span>Passenger platform commission</span><b>R 0</b></div>
            <div className="flex justify-between text-[12px] text-[#505d71]"><span>Your driver keeps</span><span>{money(selected.driverEarnings)} after the disclosed {Math.round(quote.serviceFeeRate * 100)}% DROP service fee</span></div>
          </div>}
          {needsVerify ? <div className="grid gap-3 rounded-xl bg-navy p-4 text-sm text-white"><p className="flex items-start gap-3"><Icon name="shield" size={22} className="shrink-0 text-orange" /><span>{error}<br /><span className="text-[#c9d3e3]">You’ll need your ID and a proof of address dated within 3 months.</span></span></p><button className="motion-button gold-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 font-bold text-navy" onClick={onVerify}>Verify my identity <Icon name="arrow" size={16} /></button></div> : <ErrorText>{error}</ErrorText>}
          <button className={button} disabled={busy || !selected} onClick={confirm}>{busy && <Spinner />}Confirm {service === 'Delivery' ? 'delivery' : 'booking'}{selected && ` · ${money(selected.fare)}`}<Icon name="arrow" size={17} /></button>
          <button className="min-h-11 text-sm underline" onClick={() => setStep('details')}>Edit journey</button>
        </>}
      </div>}

      {step === 'auth' && <AuthForm initialMode="register" note="Your fare is held while you sign in. You'll come straight back to confirm." onDone={() => setStep('options')} />}

      {step === 'tracking' && booking && <div className="grid gap-4">
        <div className="rounded-xl bg-[#dfe6f0] p-5">
          <span className="text-[12px] font-semibold tracking-wider text-forest">{booking.ref} · {STATUS_LABEL[booking.status].toUpperCase()}</span>
          <h3 className="mb-2 mt-3 text-xl font-semibold">{booking.driver ? `${booking.driver.name} is your driver.` : booking.status === 'cancelled' ? 'This booking was cancelled.' : 'We’re matching you with a DROP driver.'}</h3>
          <p className="text-sm leading-6 text-[#4d5b71]">{booking.driver ? <>{booking.driver.vehicle || booking.category}{booking.driver.rating ? ` · ★ ${booking.driver.rating}` : ''}</> : booking.status === 'requested' ? <>Your request is with drivers near you. This page updates automatically.{booking.scheduledFor && <><br />Scheduled for {new Date(booking.scheduledFor).toLocaleString('en-ZA')}</>}</> : null}</p>
          {booking.status !== 'cancelled' && <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="Trip progress">{(['requested', 'accepted', 'in_progress', 'completed'] as const).map((s, i) => { const order = ['requested', 'accepted', 'arriving', 'in_progress', 'completed']; const done = order.indexOf(booking.status) >= order.indexOf(s); return <li key={s} className="grid gap-1 text-[11px]"><span className={`h-1 rounded-full ${done ? 'progress-on bg-forest' : 'bg-[#c4ccd8]'}`} />{['Requested', 'Driver', 'On trip', 'Done'][i]}</li>; })}</ol>}
        </div>
        {booking.driver && booking.comms && <TripComms bookingId={booking.id} compact />}
        <p className="text-sm leading-7">○ {booking.pickup}<br />● {booking.destination}<br /><span className="text-[#505d71]">{booking.category} · {money(booking.fare)} · {booking.payment}</span></p>
        {booking.status === 'awaiting_payment' && <button className={button} onClick={() => pay(booking)}>Complete card payment · {money(booking.fare)} <Icon name="arrow" size={17} /></button>}
        {booking.paymentStatus === 'paid' && <p className="flex items-center gap-2 text-sm text-[#17744a]"><Icon name="check" size={16} />Paid by card. The fare is held safely until your trip is complete.</p>}
        {booking.paymentStatus === 'refunded' && <p className="text-sm text-[#5b6b82]">Your card payment has been refunded. It can take 5–7 working days to reach your account.</p>}
        {booking.status === 'completed' && !booking.rating && <button className={button} onClick={() => setStep('rate')}>Rate your journey <Icon name="star" size={17} /></button>}
        {booking.status !== 'cancelled' && booking.status !== 'completed' && <div className="grid grid-cols-2 gap-3">
          <button className={outline} onClick={async () => { const text = `I'm on a DROP trip (${booking.ref}) from ${booking.pickup} to ${booking.destination}${booking.driver ? ` with ${booking.driver.name}` : ''}.`; try { if (navigator.share) await navigator.share({ title: 'My DROP trip', text }); else { await navigator.clipboard.writeText(text); onNotice('Trip details copied. Paste them to share with someone you trust.'); } } catch { /* share dismissed */ } }}>Share trip</button>
          <a className={outline} href="tel:10111">SOS · 10111</a>
        </div>}
        {booking.status !== 'cancelled' && booking.status !== 'completed' && <p className="text-[12px] text-[#505d71]">In an emergency call SAPS on 10111 or 112 from a mobile phone.</p>}
        {['awaiting_payment', 'requested', 'accepted', 'arriving'].includes(booking.status) && <button className="min-h-11 text-sm text-red-800 underline" disabled={busy} onClick={cancel}>Cancel booking</button>}
        <ErrorText>{error}</ErrorText>
      </div>}

      {step === 'rate' && booking && <form className="grid gap-5" onSubmit={rate}>
        <div className="rounded-xl bg-[#dfe6f0] p-6"><Icon name="check" size={32} /><p className="mt-4 text-xl font-semibold">Trip complete · {money(booking.fare)}</p><p className="mt-2 text-sm">{booking.driver?.name} kept {money(booking.driverEarnings)} of your fare.</p></div>
        <Field label="Rate your journey"><select name="rating" className={input} defaultValue="5"><option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Okay</option><option value="2">2 — Could be better</option><option value="1">1 — Poor</option></select></Field>
        <Field label="Your feedback"><textarea name="feedback" maxLength={600} className={`${input} py-3`} placeholder="Tell us about your experience" /></Field>
        <ErrorText>{error}</ErrorText>
        <button className={button} disabled={busy}>Submit rating</button>
      </form>}
    </div>
    <div className="min-h-96"><MapView active={!!active} /><p className="mt-2 text-[12px] text-[#586578]">Distances and times are estimates. Your driver confirms the route.</p></div>
  </div>;
}
