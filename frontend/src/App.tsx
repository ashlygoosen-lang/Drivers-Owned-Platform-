import { useCallback, useEffect, useState } from 'react';
import { api, type Booking, type Service } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { COMPANY } from './lib/company';
import { Icon, type IconName, button, outline, limeButton, darkOutline, input, BrandImage, Logo, Label, MapView } from './components/ui';
import { Modal } from './components/Modal';
import { BookingFlow, WHEN_OPTIONS, type TripDraft } from './modals/BookingFlow';
import { AuthForm } from './modals/AuthForm';
import { DriverApply } from './modals/DriverApply';
import { InfoPanel } from './modals/InfoPanel';
import { Dashboard } from './dashboard/Dashboard';
import { Counter } from './motion/Counter';
import { Intro } from './motion/Intro';
import { useDropMotion, useScrollProgress, useScrollSpy } from './motion/useDropMotion';

const services = [
  { name: 'Ride' as Service, tag: 'EVERYDAY, ELEVATED', description: 'Your everyday journey. A better way to get there.', icon: 'car' as IconName, image: '/images/drop-hero.webp', alt: 'Professional driver beside a premium SUV in Cape Town', features: ['Instant & scheduled rides', 'Upfront fare estimates', 'Card or cash, paid to your driver'] },
  { name: 'Delivery' as Service, tag: 'FROM HERE TO THERE', description: 'Big on reliability. Whatever the size of your parcel.', icon: 'box' as IconName, image: '/images/drop-delivery.webp', alt: 'Courier carefully carrying parcels beside a delivery vehicle', features: ['Documents, parcels & retail', 'Live delivery status', 'Time-stamped delivery confirmation'] },
  { name: 'Premium Drive' as Service, tag: 'ARRIVE EXCEPTIONALLY', description: 'Exceptional vehicles. A higher standard of travel.', icon: 'star' as IconName, image: '/images/drop-executive.webp', alt: 'Executive sedan outside a luxury hotel', features: ['Executive sedans & luxury SUVs', 'Airport & corporate transfers', 'Professional chauffeur experience'] },
];

const NAV = [['Services', 'services'], ['Driver Ownership', 'ownership'], ['How it works', 'how-it-works'], ['Safety', 'safety'], ['Business', 'business']] as const;

type ModalState =
  | { kind: 'booking'; draft: TripDraft; existing?: Booking | null }
  | { kind: 'auth' } | { kind: 'driver' } | { kind: 'dashboard' } | { kind: 'info'; topic: string } | null;

const howSteps: Record<string, [string, string][]> = {
  Passengers: [['Create your account', 'Set up your passenger profile in under a minute.'], ['Choose your ride', 'Enter your destination and see your upfront fare, with no passenger commission.'], ['Sit back. You’re on your way.', 'Follow your trip status, share it with someone you trust and enjoy the ride.']],
  Drivers: [['Apply & upload your documents', 'ID, licence and vehicle papers, uploaded securely in minutes.'], ['Verification & inspection', 'Our onboarding team checks your documents and books your vehicle inspection.'], ['Go online & accept requests', 'Keep your fare less one disclosed service fee, and grow with the platform.']],
  'Delivery partners': [['Register & verify your account', 'Apply as a delivery partner with your documents.'], ['Find your delivery opportunity', 'Go online to see nearby parcels with the earnings shown upfront.'], ['Collect, deliver & confirm', 'Each step is time-stamped so senders always know where things stand.']],
};

function Page() {
  const { user } = useAuth();
  const [modal, setModal] = useState<ModalState>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [service, setService] = useState<Service>('Ride');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [when, setWhen] = useState('Now');
  const [passengers, setPassengers] = useState(1);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [how, setHow] = useState('Passengers');
  const [notice, setNotice] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const active = useScrollSpy(NAV.map(([, id]) => id));
  const { progress, scrolled } = useScrollProgress();
  useDropMotion();

  useEffect(() => { api<{ places: string[] }>('/places').then((r) => setPlaces(r.places)).catch(() => setPlaces(['Cape Town City Centre', 'V&A Waterfront', 'Cape Town International Airport', 'Sea Point Promenade'])); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { document.body.style.overflow = menu ? 'hidden' : ''; }, [menu]);

  const close = useCallback(() => setModal(null), []);
  const book = (name: Service = service) => {
    setService(name);
    setModalTitle('');
    setModal({ kind: 'booking', draft: { service: name, pickup, destination, when, passengers } });
    setMenu(false);
  };
  const quickEstimate = () => {
    if (!pickup.trim() || !destination.trim()) { setError('Please enter both pickup and destination addresses.'); return; }
    if (pickup.trim().toLowerCase() === destination.trim().toLowerCase()) { setError('Choose a destination different from your pickup.'); return; }
    setError('');
    book(service);
  };
  const info = (topic: string) => { setModalTitle(topic); setModal({ kind: 'info', topic }); setMenu(false); };
  const driver = () => { setModal({ kind: 'driver' }); setMenu(false); };
  const account = () => { setModal(user ? { kind: 'dashboard' } : { kind: 'auth' }); setMenu(false); };
  const smooth = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' as ScrollBehavior : 'smooth';
  const go = (id: string) => { setMenu(false); document.getElementById(id)?.scrollIntoView({ behavior: smooth() }); };
  const goHome = () => window.scrollTo({ top: 0, behavior: smooth() });

  const footerAction = (l: string) => {
    if (services.some((s) => s.name === l)) return book(l as Service);
    if (l === 'Driver ownership') return info('Driver ownership');
    if (['Become a driver', 'Delivery partner', 'Fleet registration'].includes(l)) return driver();
    if (l === 'VINK Group') return window.open(COMPANY.parentUrl, '_blank', 'noopener');
    if (l === 'Corporate Mobility') return info('Business solutions');
    if (l === 'My account') return account();
    info(l);
  };

  const title = modal?.kind === 'booking' ? modalTitle || `${modal.draft.service} · Let’s get you moving`
    : modal?.kind === 'auth' ? 'Welcome to DROP.'
    : modal?.kind === 'driver' ? 'Your next chapter starts here.'
    : modal?.kind === 'dashboard' ? `${user?.role === 'admin' ? 'Super Admin' : user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : ''} dashboard`
    : modalTitle;

  return <div>
    <Intro />
    <a href="#main" className="sr-only z-[90] rounded bg-forest px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
    <datalist id="drop-places">{places.map((p) => <option key={p} value={p} />)}</datalist>

    <header className={`site-header sticky top-0 z-30 border-b bg-[#fcfaf6]/92 backdrop-blur-xl ${scrolled ? 'is-scrolled' : ''} border-[#d4a72c]/70`}>
      <div className="mx-auto flex h-[80px] max-w-[1440px] items-center justify-between gap-5 px-6 lg:px-12">
        <button onClick={goHome} aria-label="DROP home"><Logo compact /></button>
        <nav className="relative hidden items-center gap-8 text-[14px] font-medium text-[#3a2a28] xl:flex" aria-label="Main navigation">
          {NAV.map(([label, id]) => <button key={id} onClick={() => go(id)} aria-current={active === id ? 'true' : undefined} className={`nav-link min-h-11 ${active === id ? 'text-forest' : 'hover:text-[#6c5552]'}`}>{label}</button>)}
        </nav>
        <div className="flex items-center gap-4">
          <button onClick={account} className="hidden min-h-11 items-center gap-2 text-sm font-semibold sm:flex">{user ? <><span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#e3bd4f] to-[#9a7417] text-[12px] text-[#2a0709]">{user.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}</span>My DROP</> : 'Sign in ↗'}</button>
          <button className={`${button} max-sm:!hidden`} onClick={() => book()}>Book a ride <Icon name="arrow" size={16} /></button>
          <button className="menu-toggle p-3 xl:hidden" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} onClick={() => setMenu(!menu)}><span className="menu-icon" data-open={menu} aria-hidden="true"><span /><span /><span /></span></button>
        </div>
      </div>
      <span className="scroll-progress absolute inset-x-0 -bottom-px h-[2px] origin-left bg-[#856964]" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      {menu && <nav className="mobile-menu fixed inset-x-0 top-[80px] bottom-0 overflow-y-auto border-t border-gray-200 bg-[#fcfaf6] p-6 xl:hidden" aria-label="Mobile navigation">
        <div className="grid gap-1">
          {services.map((s) => <button className="mobile-item flex min-h-14 items-center gap-3 border-b border-[#eceff0] text-left font-display text-2xl font-semibold" key={s.name} onClick={() => book(s.name)}><Icon name={s.icon} />{s.name}</button>)}
          {NAV.map(([label, id]) => <button key={id} className="mobile-item min-h-12 text-left text-lg" onClick={() => go(id)}>{label}</button>)}
          <button className="mobile-item min-h-12 text-left text-lg" onClick={() => go('apps')}>Download the app</button>
          <button className={`${button} mobile-item mt-4`} onClick={account}>{user ? 'My DROP dashboard' : 'Sign in or create account'}</button>
          <button className={`${outline} mobile-item mt-2`} onClick={driver}>Become a driver-owner</button>
        </div>
      </nav>}
    </header>

    <main id="main">
      <section className="motion-hero relative overflow-hidden bg-wine text-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_45%,#7a0d17_0%,#3a080c_38%,#1a0506_75%)]" aria-hidden="true" />
        <div className="hero-visual absolute inset-y-0 right-0 hidden w-[58%] lg:block"><BrandImage src="/images/drop-hero.webp" alt="Professional DROP driver and premium SUV in the warm light of Cape Town" priority className="hero-image h-full w-full object-cover object-[64%_50%]" /><div className="absolute inset-0 bg-gradient-to-r from-[#1f0608] via-[#2a0709]/45 to-transparent" /><div className="absolute inset-0 bg-gradient-to-t from-[#1a0506] via-transparent to-[#1a0506]/40" /></div>
        <div className="hero-lines pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="hero-orbs pointer-events-none absolute inset-0" aria-hidden="true"><span /><span /></div>
        <div className="relative mx-auto max-w-[1440px] px-6 pb-16 pt-16 lg:px-12 lg:pb-[170px] lg:pt-24">
          <div className="hero-copy max-w-[640px]">
            <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium"><span className="flex items-center gap-3 text-[#e3bd4f]"><span className="h-px w-7 bg-current" />Driver-owned · Built for South Africa</span><span className="hidden h-4 w-px bg-white/25 sm:block" /><span className="text-white/75">A VINK Group division</span></div>
            <h1 className="font-display text-[48px] font-normal leading-[1.04] tracking-[-1.8px] sm:text-[66px] lg:text-[76px]"><span className="motion-line"><span>The future of mobility.</span></span><span className="motion-line"><span>Owned by the people</span></span><span className="motion-line"><span><em className="hero-accent italic">who drive it.</em></span></span></h1>
            <p className="mt-7 max-w-[500px] text-[17px] leading-[1.75] text-white/80">A new generation of e-hailing. Built around drivers, designed for passengers. Rides, deliveries and premium travel, with no passenger platform commission.</p>
            <div className="mt-9 flex flex-wrap gap-3"><button className={limeButton} onClick={() => book()}>Let’s get you moving <Icon name="arrow" size={17} /></button><button className={darkOutline} onClick={driver}>Become a driver-owner</button></div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[13px] font-medium text-white/70">{['Driver-led. People-first.', 'Transparent by design.', 'Upfront fares.'].map((t) => <span className="flex items-center gap-2" key={t}><Icon name="check" size={14} className="text-[#e3bd4f]" />{t}</span>)}</div>
          </div>
        </div>
        <BrandImage className="h-64 w-full object-cover object-[65%_50%] opacity-90 sm:h-80 lg:hidden" src="/images/drop-hero.webp" alt="DROP premium mobility with driver and vehicle" priority />
        <div className="hero-badge absolute bottom-[130px] right-12 hidden items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-white shadow-lg backdrop-blur-md lg:flex"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#e3bd4f] to-[#9a7417] text-[#2a0709]"><Icon name="shield" /></span><div className="text-sm font-semibold">A fairer journey for everyone.<p className="mt-1 text-[12px] font-normal text-white/70">Better for drivers. Better for you.</p></div></div>
      </section>

      <div className="relative z-10 mx-auto max-w-[1344px] px-6 lg:-mt-[88px] lg:px-0">
        <section className="quick-book rounded-3xl border border-[#e6e1d9] bg-white p-6 shadow-[0_12px_40px_#45101510] lg:p-7" aria-label="Quick ride booking">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="segmented relative grid w-full grid-cols-3 gap-1 rounded-full bg-[#f4f2ee] p-1 sm:flex sm:w-auto">{services.map((s) => <button key={s.name} onClick={() => setService(s.name)} aria-pressed={service === s.name} className={`relative z-[1] flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-2 text-[13px] font-semibold sm:px-4 sm:text-sm ${service === s.name ? 'bg-forest text-white shadow-sm' : 'text-[#70615f]'}`}><Icon name={s.icon} size={17} />{s.name}</button>)}</div><span className="flex items-center gap-2 text-[12px] text-[#645451]"><Icon name="shield" size={15} /> No passenger platform commission</span></div>
          <form onSubmit={(e) => { e.preventDefault(); quickEstimate(); }} className="grid items-end gap-3 md:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1fr_.65fr_auto]">
            <label className="grid gap-2 text-[12px] font-medium">Pickup location<div className="relative"><Icon name="pin" className="absolute left-3 top-3.5 text-forest" size={18} /><input className={`${input} pl-10`} placeholder="Where from?" value={pickup} onChange={(e) => setPickup(e.target.value)} list="drop-places" /></div></label>
            <label className="grid gap-2 text-[12px] font-medium">Destination<div className="relative"><Icon name="pin" className="absolute left-3 top-3.5 text-[#776a68]" size={18} /><input className={`${input} pl-10`} placeholder="Where to?" value={destination} onChange={(e) => setDestination(e.target.value)} list="drop-places" /></div></label>
            <label className="grid gap-2 text-[12px] font-medium">When<select className={input} value={when} onChange={(e) => setWhen(e.target.value)}>{WHEN_OPTIONS.map((w) => <option key={w}>{w}</option>)}</select></label>
            <label className="grid gap-2 text-[12px] font-medium">Passengers<select className={input} value={passengers} onChange={(e) => setPassengers(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} passenger{n > 1 ? 's' : ''}</option>)}</select></label>
            <button className={`${button} min-h-12`} type="submit">Get fare estimate <Icon name="arrow" size={17} /></button>
          </form>
          {error && !modal && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#726260]"><span>Upfront estimates. More transparency. A better way to move.</span><span>Rides, deliveries and premium travel · Cape Town, Johannesburg, Pretoria & Durban</span></div>
        </section>
      </div>

      <div className="marquee mt-16 overflow-hidden border-y border-[#e9e4db] py-5" aria-hidden="true"><div className="marquee-track flex w-max gap-12 whitespace-nowrap font-display text-2xl font-semibold text-[#c4a464]">{Array.from({ length: 2 }, (_, k) => <div key={k} className="flex gap-12">{['Driver-led', 'No passenger commission', 'Transparent fees', 'Ride', 'Delivery', 'Premium Drive', 'Owned by drivers'].map((t) => <span key={t} className="flex items-center gap-12">{t}<span className="text-[#c4a464]">✦</span></span>)}</div>)}</div></div>

      <section id="services" className="mx-auto max-w-[1440px] scroll-mt-28 px-6 py-20 lg:px-12">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4"><div data-reveal><Label>One platform. More possibilities.</Label><h2 className="font-display text-3xl font-normal tracking-[-1px] md:text-[38px]">Your life moves. We move with it.</h2></div><p data-reveal="right" className="max-w-80 text-sm leading-6 text-[#70615f]">From the everyday to the exceptional.<br />Thoughtfully designed around your journey.</p></div>
        <div className="grid gap-6 md:grid-cols-3" data-reveal-stagger>{services.map((s, i) => <article key={s.name} data-tilt className="service-card group overflow-hidden rounded-2xl border border-[#e5e0d8] bg-white">
          <div className="service-visual relative h-64 overflow-hidden bg-[#e7e4df]"><BrandImage src={s.image} alt={s.alt} className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-105 ${i === 0 ? 'object-[65%_60%]' : 'object-center'}`} /><div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" /><span className="service-icon absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/70 bg-white/90 shadow-sm backdrop-blur-md"><Icon name={s.icon} size={19} /></span><span className="absolute bottom-4 left-5 font-display text-sm font-semibold tracking-[2px] text-white">0{i + 1} <span className="mx-2 inline-block h-px w-6 bg-white/70 align-middle" /> {s.name.toUpperCase()}</span></div>
          <div className="p-6"><div className="mb-2 text-[10px] font-bold tracking-[1.7px] text-[#755e5a]">{s.tag}</div><h3 className="font-display text-[26px] font-normal tracking-[-.5px]">{s.name}</h3><p className="mb-5 mt-2 max-w-72 text-sm leading-6 text-[#70615f]">{s.description}</p><div className="mb-6 grid gap-2 text-[12px] text-[#63524f]">{s.features.map((f) => <span key={f} className="flex items-center gap-2"><Icon name="check" size={13} />{f}</span>)}</div><button onClick={() => book(s.name)} className="card-cta flex min-h-11 w-full items-center justify-between border-t border-[#ebe6dd] pt-4 text-sm font-semibold">Book {s.name} <Icon name="arrow" size={19} /></button></div>
        </article>)}</div>
      </section>

      <section id="ownership" data-spotlight className="spotlight dark-panel relative scroll-mt-20 overflow-hidden text-white">
        <div className="mx-auto grid max-w-[1440px] items-center gap-14 px-6 py-20 lg:grid-cols-[1fr_1fr] lg:px-12">
          <div data-reveal="left"><Label light>Built different. For a better tomorrow.</Label><h2 className="font-display text-4xl font-normal leading-[1.25] tracking-[-1.2px] md:text-[46px]">Not just a platform.<br />A platform drivers<br /><span className="text-lime">can own.</span></h2><p className="mb-7 mt-6 max-w-md text-[15px] leading-7 text-[#e1dacf]">The people behind the wheel deserve a place at the table. DROP is a driver-owned mobility ecosystem that puts participation, transparency and shared opportunity first.</p><button className={limeButton} onClick={() => info('Driver ownership')}>Discover driver ownership <Icon name="arrow" size={17} /></button><p className="mt-5 max-w-md text-[12px] leading-5 text-[#d5cec1]">Participation is subject to programme eligibility and terms. Membership does not automatically confer shares or equity ownership.</p></div>
          <div data-reveal="right" className="rounded-2xl border border-white/15 bg-[#4b1016]/90 p-5 md:p-7"><div className="mb-6 flex items-center justify-between"><h3 className="font-display text-lg font-semibold">A fairer model. A clearer picture.</h3><Icon name="people" size={24} /></div>
            <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#3c0a0f] p-4"><p className="mb-4 text-[11px] font-semibold tracking-wider text-[#d4cec4]">CONVENTIONAL PLATFORMS</p>{['Company-held ownership', 'Commission-led earnings', 'Limited ownership participation'].map((t) => <p className="mb-4 flex gap-2 text-[13px] leading-5 text-[#ddd8d0]" key={t}><span className="text-[#c4a464]">−</span>{t}</p>)}</div><div className="rounded-xl border border-[#c8a55f]/35 bg-[#60171e] p-4"><p className="mb-4 text-[11px] font-semibold tracking-wider text-lime">THE DROP DIFFERENCE</p>{['Driver ownership participation', 'Transparent service fees', 'Shared economic opportunity'].map((t) => <p className="mb-4 flex gap-2 text-[13px] leading-5" key={t}><Icon name="check" size={16} className="mt-0.5 shrink-0 text-lime" />{t}</p>)}</div></div>
            <div className="mt-5 rounded-xl bg-[#f6f1e9] p-5 text-forest"><div className="mb-4 flex items-center justify-between text-[11px] font-bold tracking-wider">WHERE YOUR FARE GOES <button className="font-normal tracking-normal underline" onClick={() => info('Fee structure')}>See tariffs</button></div><div className="grid grid-cols-3 gap-3">{[['Passenger pays', 'The upfront fare, R0 commission'], ['Driver receives', 'Fare less one disclosed fee'], ['DROP receives', 'Transparent service fee']].map(([a, b], i) => <div key={a} className={i ? 'border-l border-[#d9cebc] pl-4' : ''}><p className="mb-2 text-[12px] text-[#614c49]">{a}</p><p className="text-[13px] font-semibold leading-5">{b}</p></div>)}</div></div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-6 pt-20 lg:px-12" aria-label="DROP in numbers">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-[#e6e0d5] bg-[#e6e0d5] lg:grid-cols-4" data-reveal-stagger>
          {[[0, 'R', '', 'passenger platform commission'], [100, '', '%', 'of fares shown before you book'], [3, '', '', 'ways to move, one platform'], [1, '', '', 'clearly disclosed driver fee']].map(([v, pre, suf, label]) => <div key={label as string} className="bg-white p-6 lg:p-8"><p className="font-display text-5xl font-normal tracking-[-1.5px] text-forest md:text-6xl"><Counter value={v as number} prefix={pre as string} suffix={suf as string} /></p><p className="mt-2 text-sm text-[#6d5b58]">{label}</p></div>)}
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-6 py-20 lg:px-12">
        <div className="mb-12 text-center" data-reveal><div className="flex justify-center"><Label>The difference is in the journey</Label></div><h2 className="font-display text-3xl font-normal tracking-[-1px] md:text-[38px]">Good for you. Better for everyone.</h2></div>
        <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3" data-reveal-stagger>{[
          ['people', 'Driver ownership', 'More than driving. A pathway to participation in the platform you help build.'],
          ['wallet', 'Fair, transparent pricing', 'No passenger platform commission. One clear driver service fee.'],
          ['check', 'No hidden surprises', 'See your fare before you book and understand exactly what you pay.'],
          ['pin', 'Technology that connects', 'Simple booking, live trip status and a dashboard for every account.'],
          ['shield', 'Safety at every turn', 'Verified drivers, trip sharing and one-tap emergency access on every journey.'],
          ['star', 'Everyday to exceptional', 'From your morning commute to executive travel. One consistent standard of care.'],
        ].map(([icon, t, text]) => <div className="feature flex gap-4" key={t}><span className="feature-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e6decf] bg-[#f4eee5] text-forest"><Icon name={icon as IconName} size={22} /></span><div><h3 className="mb-2 text-base font-semibold">{t}</h3><p className="text-sm leading-6 text-[#70615f]">{text}</p></div></div>)}</div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 border-y border-[#e8e5df] bg-[#f4f2ed]">
        <div className="mx-auto max-w-[1440px] px-6 py-16 lg:px-12"><div className="flex flex-wrap items-center justify-between gap-6"><div data-reveal><Label>Less friction. More freedom.</Label><h2 className="font-display text-3xl font-normal tracking-[-1px] md:text-[38px]">Your journey starts here.</h2></div><div className="flex flex-wrap rounded-full border border-[#e1dbd2] bg-white p-1" role="tablist">{Object.keys(howSteps).map((t) => <button key={t} role="tab" onClick={() => setHow(t)} aria-selected={how === t} className={`min-h-11 rounded-full px-5 text-sm ${how === t ? 'bg-forest text-white' : 'text-[#62504d]'}`}>{t}</button>)}</div></div>
          <div className="how-steps mt-12 grid gap-8 md:grid-cols-3" key={how}>{howSteps[how].map(([s, d], i) => <div key={s} className="how-step relative border-t border-[#dad2c3] pt-7" style={{ animationDelay: `${i * 90}ms` }}><span className="font-display text-3xl font-medium text-[#886b66]">0{i + 1}</span><h3 className="mb-2 mt-4 text-lg font-semibold">{s}</h3><p className="text-sm leading-6 text-[#71615e]">{d}</p></div>)}</div>
          <button className="mt-8 flex min-h-11 items-center gap-3 text-sm font-semibold" onClick={() => how === 'Passengers' ? book() : driver()}>Let’s get started <Icon name="arrow" size={17} /></button></div>
      </section>

      <section className="mx-auto grid max-w-[1440px] items-center gap-14 px-6 py-20 lg:grid-cols-[.8fr_1.2fr] lg:px-12">
        <div data-reveal="left"><Label>Smarter technology. Human at heart.</Label><h2 className="font-display text-4xl font-normal leading-tight tracking-[-1px]">A little less waiting.<br />A lot more moving.</h2><p className="my-6 max-w-sm text-sm leading-7 text-[#71615e]">From the first tap to the final destination, stay connected to every part of your journey. Try it now: see a real fare for a trip across Cape Town.</p><div className="mb-7 grid gap-3">{['Upfront fares, before you go', 'Your driver. Your journey. In view.', 'Thoughtfully built around you'].map((t) => <span className="flex items-center gap-3 text-sm" key={t}><Icon name="check" size={17} />{t}</span>)}</div><button className={outline} onClick={() => { setPickup('Cape Town City Centre'); setDestination('V&A Waterfront'); setModalTitle(''); setModal({ kind: 'booking', draft: { service: 'Ride', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', when: 'Now', passengers: 1 } }); }}>See a sample fare <Icon name="arrow" size={17} /></button></div>
        <div data-reveal="scale" className="relative rounded-2xl border border-[#e0d9ce] bg-white p-3 shadow-[0_20px_60px_#45101510]"><div className="flex items-center justify-between px-3 pb-3 pt-1"><span className="text-sm font-semibold">Your next journey</span><span className="rounded-full bg-[#f3ede4] px-3 py-1 text-[12px] text-forest">City Centre → Waterfront</span></div><div className="h-[350px]"><MapView /></div><div className="float-card absolute bottom-8 left-7 right-20 flex items-center gap-3 rounded-xl border border-[#e6e0d6] bg-white p-4 shadow-lg"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f1ebe2]"><Icon name="car" /></span><div className="flex-1"><p className="text-sm font-semibold">Comfort is on its way.</p><p className="mt-1 text-[12px] text-[#725f5c]">Live status on every booking</p></div><span className="text-center text-lg font-semibold">4 <span className="block text-[12px] font-normal">min away</span></span></div></div>
      </section>

      <section id="safety" className="scroll-mt-24 bg-[#f1ebe0]">
        <div className="mx-auto grid max-w-[1440px] items-center gap-14 px-6 py-16 lg:grid-cols-2 lg:px-12"><div data-reveal="left"><Label>Confidence comes standard</Label><h2 className="font-display text-4xl font-normal leading-tight tracking-[-1px]">Your safety is part<br />of every journey.</h2><p className="my-5 max-w-md text-sm leading-7 text-[#6d5754]">Built-in safeguards and human support. Because getting there should feel as good as being there.</p><button onClick={() => info('Safety centre')} className="flex min-h-11 items-center gap-3 text-sm font-semibold">Explore our safety approach <Icon name="arrow" size={17} /></button></div><div className="grid grid-cols-2 gap-4" data-reveal-stagger="scale">{[['shield', 'Verified people & vehicles'], ['pin', 'Trip sharing & monitoring'], ['phone', 'Emergency SOS access'], ['people', 'Human support & reporting']].map(([ic, t]) => <button onClick={() => info(t)} key={t} className="safety-card rounded-xl border border-[#e1d9cb] bg-white/65 p-5 text-left hover:bg-white"><Icon name={ic as IconName} size={25} /><p className="mt-4 text-sm font-semibold">{t}</p><p className="mt-2 text-[12px] text-[#6e5a57]">Designed for peace of mind ↗</p></button>)}</div></div>
      </section>

      <section id="business" className="mx-auto grid max-w-[1440px] scroll-mt-24 gap-6 px-6 py-20 lg:grid-cols-2 lg:px-12" data-reveal-stagger>
        <div className="rounded-2xl border border-[#e3ddd2] bg-[#f3f1ed] p-8 md:p-10"><Label>DROP for business</Label><h2 className="font-display text-3xl font-normal tracking-[-1px]">Move your business forward.</h2><p className="mb-6 mt-4 max-w-md text-sm leading-7 text-[#71615e]">From airport arrivals to everyday teams. Scheduled travel, monthly invoicing and clear reporting for companies, hotels, government and events.</p><div className="flex flex-wrap gap-3"><button className={outline} onClick={() => info('Business solutions')}>Talk to our team <Icon name="arrow" size={17} /></button><button className="min-h-11 px-2 text-sm font-semibold underline" onClick={() => setModal({ kind: 'auth' })}>Open a business account</button></div></div>
        <div data-spotlight className="spotlight dark-panel relative overflow-hidden rounded-3xl p-8 text-white md:p-10"><Label light>A seat at the table. A road to more.</Label><h2 className="font-display text-3xl font-normal tracking-[-1px]">Drive. Earn. Participate. Own.</h2><p className="mb-6 mt-4 max-w-md text-sm leading-7 text-[#e0dacf]">More than a service provider. Join a new mobility movement built to create opportunity and greater participation in the future of transportation.</p><button onClick={driver} className={limeButton}>Become a driver-owner <Icon name="arrow" size={17} /></button></div>
      </section>

      <section id="apps" className="scroll-mt-24 overflow-hidden border-t border-[#e8e2d9] bg-[#f2eee8]">
        <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-6 pt-16 lg:grid-cols-2 lg:px-12"><div className="pb-16" data-reveal="left"><Label>Your city. In your pocket.</Label><h2 className="font-display text-[40px] font-normal leading-tight tracking-[-1px]">Wherever life takes you.<br />Take DROP.</h2><p className="mb-7 mt-5 text-sm leading-7 text-[#6e5754]">One connected ecosystem. Passenger, driver and delivery apps.<br />Designed for the way you move.</p><div className="flex flex-wrap gap-3">{['App Store', 'Google Play'].map((s) => <button onClick={() => info(`${s} — coming soon`)} key={s} className="motion-button flex min-h-14 items-center gap-3 rounded-lg bg-[#310c0f] px-5 text-left text-white"><Icon name="phone" size={25} /><span><span className="block text-[10px]">COMING SOON ON</span><span className="text-lg font-semibold">{s}</span></span></button>)}</div><p className="mt-4 text-[12px] text-[#6e5754]">Until the apps launch, book and manage everything on the web.</p></div>
          <div className="phones flex h-[370px] items-start justify-center gap-5 pt-7" data-reveal="up"><div className="phone-a w-[220px] -rotate-6 rounded-[32px] border-[7px] border-[#421015] bg-[#fcfaf6] p-3 shadow-2xl"><div className="mx-auto mb-5 h-4 w-20 rounded-full bg-[#421015]" /><Logo compact /><p className="mb-4 mt-5 text-xl font-semibold">Where to today?</p><div className="h-56 overflow-hidden rounded-xl"><MapView /></div></div><div className="phone-b mt-12 w-[200px] rotate-6 rounded-[30px] border-[7px] border-[#421015] bg-wine p-4 text-white shadow-2xl"><div className="mx-auto mb-7 h-3 w-16 rounded-full bg-black/50" /><span className="text-[12px] text-lime">DRIVER APP · PREVIEW</span><p className="mt-3 text-2xl">Your day.<br />Your possibilities.</p><div className="mt-8 rounded-xl bg-white/10 p-4"><p className="text-[12px]">Your earnings</p><p className="mt-2 text-lg leading-6">Every fare, less one disclosed fee</p></div><div className="mt-4 rounded-lg bg-gradient-to-r from-[#e3bd4f] to-[#b8891f] p-3 text-center text-sm font-semibold text-[#2a0709]">You’re in the driver’s seat</div></div></div></div>
      </section>
    </main>

    <footer className="footer-dark bg-[#2c090d] text-white"><div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-12">
      <div className="mb-12 flex flex-wrap items-center justify-between gap-6"><Logo light /><p className="max-w-sm text-sm leading-6 text-[#d1cabd]">The future of mobility belongs to<br />the people who drive it.</p><button onClick={() => go('apps')} className="flex min-h-11 items-center gap-3 text-sm font-semibold text-lime">Discover the DROP apps <Icon name="arrow" size={17} /></button></div>
      <div className="grid grid-cols-2 gap-8 md:grid-cols-5">{[
        ['Company', 'About DROP', 'VINK Group', 'Our vision', 'Careers'],
        ['Services', 'Ride', 'Delivery', 'Premium Drive', 'Corporate Mobility'],
        ['Driver community', 'Become a driver', 'Driver ownership', 'Delivery partner', 'Fleet registration'],
        ['Support', 'Help centre', 'Safety centre', 'Contact us', 'Report an issue', 'My account'],
        ['Legal', 'Terms and conditions', 'Privacy policy', 'Driver agreement', 'Passenger terms', 'Fee structure'],
      ].map(([heading, ...links]) => <div key={heading}><h3 className="mb-4 text-sm font-semibold">{heading}</h3>{links.map((l) => <button className="footer-link block min-h-9 text-left text-[13px] text-[#d1cabe] hover:text-white" key={l} onClick={() => footerAction(l)}>{l}{l === 'VINK Group' && ' ↗'}</button>)}</div>)}</div>
      <div className="mt-12 grid gap-3 border-t border-white/15 pt-6 text-[12px] leading-5 text-[#c4a464] md:flex md:items-center md:justify-between">
        <span>© {new Date().getFullYear()} DROP — Drivers Owned Platform. All rights reserved.</span>
        <span>DROP is a division of <a className="underline hover:text-white" href={COMPANY.parentUrl} target="_blank" rel="noopener">{COMPANY.parent}</a>, registration number {COMPANY.registration}.</span>
      </div>
    </div></footer>

    <button aria-label="Back to top" onClick={goHome} className={`to-top fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-forest text-white shadow-lg ${progress > .15 ? 'is-visible' : ''}`}><svg className="absolute inset-0 -rotate-90" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="none" stroke="#e3bd4f" strokeWidth="2" strokeDasharray={138.2} strokeDashoffset={138.2 * (1 - progress)} /></svg><Icon name="up" size={18} /></button>

    {modal && <Modal key={modal.kind} title={title} wide={modal.kind === 'booking' || modal.kind === 'dashboard'} onClose={close} eyebrow={modal.kind === 'dashboard' ? 'MY DROP' : undefined}>
      {modal.kind === 'booking' && <BookingFlow draft={modal.draft} existing={modal.existing} onTitle={setModalTitle} onNotice={setNotice} onClose={close} />}
      {modal.kind === 'auth' && <AuthForm onDone={() => setModal({ kind: 'dashboard' })} onDriver={driver} />}
      {modal.kind === 'driver' && <DriverApply onDashboard={() => setModal({ kind: 'dashboard' })} />}
      {modal.kind === 'dashboard' && (user ? <Dashboard onBook={() => book()} onTrack={(b) => { setModalTitle(''); setModal({ kind: 'booking', draft: { service: b.service, pickup: b.pickup, destination: b.destination, when: 'Now', passengers: b.passengers || 1 }, existing: b }); }} onOwnership={() => info('Driver ownership')} onNotice={setNotice} onSignedOut={close} /> : <AuthForm onDone={() => setModal({ kind: 'dashboard' })} onDriver={driver} />)}
      {modal.kind === 'info' && <InfoPanel topic={modal.topic} onBook={() => book()} onDriver={driver} onApps={() => go('apps')} onNotice={setNotice} onClose={close} onOpen={info} />}
    </Modal>}

    {notice && <div role="status" className="toast fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-32px)] max-w-xl -translate-x-1/2 items-center gap-4 rounded-xl border border-[#c4a464] bg-[#f4ede2] p-4 text-sm leading-6 text-forest shadow-xl"><p className="flex-1">{notice}</p><button onClick={() => setNotice('')} className="flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Dismiss notification"><Icon name="close" size={18} /></button></div>}
  </div>;
}

export default function App() {
  return <AuthProvider><Page /></AuthProvider>;
}
