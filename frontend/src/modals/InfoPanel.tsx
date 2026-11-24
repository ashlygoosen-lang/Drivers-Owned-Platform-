import { useEffect, useState } from 'react';
import { api, money } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, input, Field, ErrorText, Icon, Spinner } from '../components/ui';
import { COMPANY } from '../lib/company';

const TOPICS = ['General enquiry', 'Business solutions', 'Driver ownership', 'Partnerships', 'Media', 'Report an issue'] as const;

export function ContactForm({ topic = 'General enquiry', onSent }: { topic?: string; onSent: (ref: string) => void }) {
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ ref: string }>('/enquiries', { body: Object.fromEntries(new FormData(e.currentTarget)) });
      onSent(res.ref);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-4" onSubmit={submit}>
    <Field label="Topic"><select name="topic" defaultValue={TOPICS.includes(topic as never) ? topic : 'General enquiry'} className={input}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Your name"><input name="name" required minLength={2} defaultValue={user?.name} autoComplete="name" className={input} /></Field>
      <Field label="Email"><input name="email" type="email" required defaultValue={user?.email} autoComplete="email" className={input} placeholder="you@example.com" /></Field>
      <Field label="Phone (optional)"><input name="phone" type="tel" defaultValue={user?.phone} autoComplete="tel" className={input} /></Field>
      <Field label="Company (optional)"><input name="company" defaultValue={user?.company} autoComplete="organization" className={input} /></Field>
    </div>
    <Field label="Message"><textarea name="message" required minLength={10} maxLength={2000} rows={4} className={`${input} py-3`} placeholder="How can we help?" /></Field>
    <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy}>{busy && <Spinner />}Send message <Icon name="arrow" size={16} /></button>
    <p className="text-[12px] text-[#64735c]">For emergencies, contact SAPS on 10111 or 112 from a mobile phone.</p>
  </form>;
}

type Tariffs = Record<string, Record<string, { base: number; perKm: number; perMin: number; minimum: number; description: string }>>;
function FeeTable() {
  const [data, setData] = useState<Tariffs | null>(null);
  useEffect(() => { api<{ services: Tariffs }>('/services').then((r) => setData(r.services)).catch(() => setData({})); }, []);
  if (!data) return <p className="flex items-center gap-2"><Spinner /> Loading tariffs…</p>;
  return <div className="grid gap-4">{Object.entries(data).map(([service, cats]) => <div key={service} className="overflow-x-auto rounded-xl border border-[#dce3d3]">
    <table className="w-full min-w-[420px] text-left text-[13px]"><caption className="bg-[#eef2e7] px-4 py-2 text-left font-semibold text-forest">{service}</caption>
      <thead><tr className="border-b border-[#e3e9db]"><th className="p-3 font-medium">Category</th><th className="p-3 font-medium">Base</th><th className="p-3 font-medium">Per km</th><th className="p-3 font-medium">Per min</th><th className="p-3 font-medium">Minimum</th></tr></thead>
      <tbody>{Object.entries(cats).map(([name, t]) => <tr key={name} className="border-b border-[#eef2e8] last:border-0"><td className="p-3">{name}</td><td className="p-3">{money(t.base)}</td><td className="p-3">{money(t.perKm)}</td><td className="p-3">{money(t.perMin)}</td><td className="p-3">{money(t.minimum)}</td></tr>)}</tbody>
    </table></div>)}</div>;
}

export function InfoPanel({ topic, onBook, onDriver, onApps, onNotice, onClose, onOpen }: {
  topic: string; onBook: () => void; onDriver: () => void; onApps: () => void; onNotice: (m: string) => void; onClose: () => void; onOpen: (t: string) => void;
}) {
  const sent = (ref: string) => { onNotice(`Thank you. Your message (${ref}) has reached the DROP team and we'll be in touch.`); onClose(); };
  const t = topic.toLowerCase();
  const p = 'text-sm leading-7 text-[#54664e]';

  if (/ownership/.test(t)) return <div className={`grid gap-5 ${p}`}>
    <p>DROP is built on a simple idea: the people who do the driving should share in the platform they build. Passengers pay the fare with no added passenger platform commission, and drivers keep the fare less one clearly disclosed service fee.</p>
    <div className="rounded-xl bg-[#ecf2e3] p-5"><h3 className="mb-2 font-semibold text-forest">Three distinct things</h3>
      <p><b>Participation:</b> a voice in the driver community, programme updates and feedback forums.</p>
      <p><b>Membership:</b> eligibility-based admission to the driver-owner programme, under its own terms.</p>
      <p><b>Equity ownership:</b> any shareholding requires formal legal agreements. It is never automatic or guaranteed.</p></div>
    <p>Driver earnings equal ride fares less the disclosed DROP service fee and your own operating costs. Final programme structure, eligibility and any equity terms are set out in formal programme documents before you sign anything.</p>
    <div className="flex flex-wrap gap-3"><button className={button} onClick={onDriver}>Apply to drive <Icon name="arrow" size={16} /></button><button className={outline} onClick={() => onOpen('Contact us')}>Ask a question</button></div>
  </div>;

  if (/coming soon/.test(t)) return <div className={`grid gap-5 ${p}`}><p>The DROP passenger, driver and delivery apps are in development. Until they launch, everything works right here on the website: book rides and deliveries, apply to drive, and manage trips from your dashboard on any phone.</p><div className="flex flex-wrap gap-3"><button className={button} onClick={onBook}>Book on the web <Icon name="arrow" size={16} /></button><button className={outline} onClick={() => { onClose(); onApps(); }}>See the app previews</button></div></div>;

  if (/contact|help|support|careers|issue/.test(t)) return <div className={`grid gap-5 ${p}`}>
    <p>{/careers/.test(t) ? 'We’re building a team that believes mobility should work for the people who power it. Tell us about yourself and the role you’re interested in.' : /issue/.test(t) ? 'Tell us what happened. If it relates to a trip, include your booking reference (it starts with DRP-). Signed-in users can also raise tickets from their dashboard.' : `Questions about rides, deliveries, driving with DROP or business accounts? Send us a message or email ${COMPANY.email}.`}</p>
    <ContactForm topic={/issue/.test(t) ? 'Report an issue' : /careers/.test(t) ? 'General enquiry' : 'General enquiry'} onSent={sent} />
  </div>;

  if (/corporate|business/.test(t)) return <div className={`grid gap-5 ${p}`}><p>DROP for Business gives your company one account for staff travel, airport transfers and deliveries: monthly invoicing, a team list, and a clear record of every trip, all with no passenger platform commission.</p><ContactForm topic="Business solutions" onSent={sent} /></div>;

  if (/safety|verified|trip sharing|emergency|human support/.test(t)) return <div className={`grid gap-5 ${p}`}>
    <p>Safety is designed into every DROP journey:</p>
    <ul className="grid gap-2">{[
      ['Verified people & vehicles', 'Every driver submits identity, licence and vehicle documents, which our onboarding team checks before activation, followed by a vehicle inspection.'],
      ['Trip sharing & monitoring', 'Share your trip details with someone you trust from the trip screen. Every status change is time-stamped on your booking.'],
      ['Emergency SOS access', 'The trip screen puts SAPS (10111) one tap away. In any emergency, contact emergency services first.'],
      ['Human support & reporting', 'Raise a ticket from your dashboard. Safety concerns are flagged as urgent and reviewed first.'],
    ].map(([h, d]) => <li key={h} className="flex gap-3"><Icon name="check" size={18} className="mt-1 shrink-0 text-forest" /><span><b className="text-forest">{h}.</b> {d}</span></li>)}</ul>
    <button className={button} onClick={() => onOpen('Report an issue')}>Report a safety concern</button>
  </div>;

  if (/fee structure/.test(t)) return <div className={`grid gap-5 ${p}`}><p>Passengers pay the fare shown before booking, with <b>no passenger platform commission</b>. Drivers keep the fare less a single disclosed DROP service fee, shown on every trip. Current tariffs:</p><FeeTable /><p className="text-[12px]">Fares are calculated as base + distance + time, never below the category minimum, rounded to the nearest R5. Tolls and parking, if any, are agreed with your driver.</p></div>;

  if (/privacy/.test(t)) return <div className={`grid gap-4 ${p}`}><p>DROP processes personal information in line with South Africa’s Protection of Personal Information Act (POPIA).</p><p><b>What we collect:</b> your name, contact details, trip addresses and booking history; for drivers, identity, licence and vehicle documents.</p><p><b>Why:</b> to arrange trips and deliveries, verify drivers, keep people safe, handle support and meet legal obligations.</p><p><b>Who sees it:</b> your driver sees your name, phone number and trip details for an active trip. Driver documents are seen only by the DROP onboarding team. We do not sell personal information.</p><p><b>Your rights:</b> you may request access to, correction or deletion of your information by contacting {COMPANY.email}.</p></div>;

  if (/terms|agreement/.test(t)) return <div className={`grid gap-4 ${p}`}><p>A summary of how DROP works. The full {topic.toLowerCase()} is provided on request and before any driver signs up to the driver-owner programme.</p><p><b>Bookings:</b> fares are shown before you confirm. You may cancel free of charge until your trip starts.</p><p><b>Payments:</b> passengers pay the driver by card or cash, or through a business account on monthly invoice. DROP charges no passenger platform commission.</p><p><b>Drivers:</b> independent driver-partners who keep the fare less the disclosed DROP service fee. Activation requires document verification and a vehicle inspection.</p><p><b>Conduct:</b> respect, safety and honesty are expected of everyone. Accounts may be suspended for misconduct.</p><p><b>Ownership:</b> programme participation does not automatically confer shares or equity; any equity requires separate formal agreements.</p><button className={outline} onClick={() => onOpen('Contact us')}>Request the full document</button></div>;

  if (/vision/.test(t)) return <div className={`grid gap-4 ${p}`}><p>Ride-hailing changed how cities move, but most of its value flows away from the people behind the wheel. DROP’s vision is a South African mobility platform where drivers are partners and participants, passengers pay fair and transparent fares, and the economics are open for everyone to see.</p><p>We start in Cape Town with rides, deliveries and premium travel, and grow city by city with our driver community.</p><button className={button} onClick={onDriver}>Join the movement <Icon name="arrow" size={16} /></button></div>;

  return <div className={`grid gap-4 ${p}`}>
    <p><b className="text-forest">DROP — Drivers Owned Platform</b> is a South African e-hailing and delivery platform built around the people who drive it. It is a division of {COMPANY.parent}, registration number {COMPANY.registration}, headquartered in Cape Town.</p>
    <p>DROP connects everyday rides, deliveries, premium travel and business transport with transparent driver service fees and no passenger platform commission.</p>
    <div className="flex flex-wrap gap-3"><a className={outline} href={COMPANY.parentUrl} target="_blank" rel="noopener">Visit VINK Group ↗</a><button className={button} onClick={() => onOpen('Contact us')}>Get in touch <Icon name="arrow" size={16} /></button></div>
  </div>;
}
