import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPANY, LEGAL } from '../lib/company';
import { DOCUMENTS, findDoc, type LegalDoc } from './documents';
import { Logo, Icon, type IconName } from '../components/ui';
import { S, P, L, O, A, Box } from './kit';

/**
 * The legal centre: /legal, /legal/:slug (also /terms and /privacy, which the app stores link to)
 * and /delete-account. DRAFT wording: have it reviewed by a South African attorney and fill in the
 * Information Officer before launch.
 */
const UPDATED = LEGAL.version;

const GROUPS: { title: string; blurb: string; icon: IconName; slugs: string[] }[] = [
  { title: 'Using DROP', blurb: 'Your agreement with us when you ride, send a delivery, travel in a group or book a monthly plan.', icon: 'car', slugs: ['terms', 'cancellations-refunds', 'fees', 'scholar-transport', 'staff-transport'] },
  { title: 'Privacy and your information', blurb: 'What we collect, why, who sees it, and how to use your POPIA and PAIA rights.', icon: 'shield', slugs: ['privacy', 'cookies', 'paia'] },
  { title: 'Drivers and delivery partners', blurb: 'The agreement between DROP and the independent drivers on the platform.', icon: 'people', slugs: ['driver-agreement'] },
  { title: 'Everyone', blurb: 'Rules for the website and apps, and how we expect everyone to treat each other.', icon: 'file', slugs: ['terms-of-use', 'community-guidelines'] },
];
const iconFor = (slug: string): IconName => GROUPS.find((g) => g.slugs.includes(slug))?.icon || 'file';

function useTitle(title: string) { useEffect(() => { document.title = `${title} · ${COMPANY.brand}`; }, [title]); }

/** Sections of the open document, for "On this page", with the one being read highlighted. */
function useSections(ref: React.RefObject<HTMLElement | null>, key: string) {
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const [active, setActive] = useState('');
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('section.legal-section[id]'));
    setSections(els.map((e) => ({ id: e.id, title: e.dataset.title || e.id })));
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen[0]) setActive(seen[0].target.id);
    }, { rootMargin: '-90px 0px -65% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [ref, key]);
  return { sections, active };
}

function Header() {
  return <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/95 backdrop-blur print:hidden">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
      <a href="/" aria-label={`${COMPANY.brand} home`}><Logo light /></a>
      <nav aria-label="Site" className="flex items-center gap-1 text-sm font-semibold text-white">
        <a className="hidden rounded-lg px-3 py-2 hover:bg-white/10 sm:block" href="/legal">Legal centre</a>
        <a className="hidden rounded-lg px-3 py-2 hover:bg-white/10 sm:block" href={`mailto:${LEGAL.legalEmail}`}>Contact legal</a>
        <a className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/10 px-4 hover:bg-white/20" href="/">Back to {COMPANY.brand}<Icon name="arrow" size={16} /></a>
      </nav>
    </div>
  </header>;
}

function Footer() {
  return <footer className="border-t border-[#e3e8ef] bg-white print:hidden">
    <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm text-[#4D5B71] md:grid-cols-[1.4fr_1fr_1fr]">
      <div className="grid content-start gap-3"><Logo /><p>{COMPANY.brand} ({COMPANY.name}) is a division of {COMPANY.parent}, registration number {COMPANY.registration}, a company registered in the Republic of South Africa.</p></div>
      <div className="grid content-start gap-2"><p className="font-semibold text-navy">Contact</p>
        <a className="hover:text-navy" href={`mailto:${LEGAL.supportEmail}`}>Support: {LEGAL.supportEmail}</a>
        <a className="hover:text-navy" href={`mailto:${LEGAL.privacyEmail}`}>Privacy: {LEGAL.privacyEmail}</a>
        <a className="hover:text-navy" href={`mailto:${LEGAL.legalEmail}`}>Legal: {LEGAL.legalEmail}</a></div>
      <div className="grid content-start gap-2"><p className="font-semibold text-navy">Popular</p>
        <a className="hover:text-navy" href="/legal/terms">Terms of Service</a><a className="hover:text-navy" href="/legal/privacy">Privacy Policy</a>
        <a className="hover:text-navy" href="/legal/cancellations-refunds">Cancellations &amp; refunds</a><a className="hover:text-navy" href="/delete-account">Delete your account</a></div>
    </div>
    <p className="border-t border-[#eef1f5] px-5 py-4 text-center text-[12px] text-[#6b778a]">© {new Date().getFullYear()} {COMPANY.parent}. All rights reserved.</p>
  </footer>;
}

function DraftNotice() {
  return <div className="flex items-start gap-3 rounded-2xl border border-[#f3d7bd] bg-[#fffaf5] p-4 text-[13px] leading-6 text-[#5b3a1c] print:hidden">
    <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange text-[11px] font-bold text-white">i</span>
    <p><b>Draft for legal review.</b> Written in plain language under South African law, to be confirmed by a South African attorney before launch. Items in [square brackets] are still to be completed.</p>
  </div>;
}

/** Shared page frame: header, navy title band, content, footer. */
function Frame({ crumb, title, kicker, meta, actions, children }: { crumb?: string; title: string; kicker?: string; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-[#f5f7fa] text-[#1d2b42]">
    <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
    <Header />
    <section className="relative overflow-hidden bg-navy text-white print:bg-white print:text-navy">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-orange/20 blur-3xl print:hidden" />
      <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-8 sm:pt-10">
        <nav aria-label="Breadcrumb" className="text-[13px] text-white/70 print:hidden"><a className="hover:text-white" href="/">{COMPANY.brand}</a><span className="mx-2">/</span>{crumb ? <><a className="hover:text-white" href="/legal">Legal centre</a><span className="mx-2">/</span><span className="text-white">{crumb}</span></> : <span className="text-white">Legal centre</span>}</nav>
        {kicker && <p className="mt-6 text-[12px] font-bold uppercase tracking-[0.2em] text-orange">{kicker}</p>}
        <h1 className={`${kicker ? 'mt-2' : 'mt-6'} max-w-3xl font-display text-[34px] font-extrabold leading-[1.1] sm:text-5xl`}>{title}</h1>
        {meta && <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/75 print:text-[#4D5B71]">{meta}</div>}
        {actions && <div className="mt-6 flex flex-wrap gap-3 print:hidden">{actions}</div>}
      </div>
    </section>
    <div id="content" className="flex-1">{children}</div>
    <Footer />
  </div>;
}

const ghost = 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-semibold text-white hover:bg-white/10';

/** /legal: every document, grouped by who it is for, with a filter. */
export function LegalIndex({ missing }: { missing?: string } = {}) {
  useTitle(missing ? 'Document not found' : 'Legal centre');
  const [q, setQ] = useState('');
  const match = (d: LegalDoc) => !q.trim() || `${d.title} ${d.summary} ${d.audience}`.toLowerCase().includes(q.trim().toLowerCase());
  const anyMatch = DOCUMENTS.some(match);
  return <Frame title="Legal centre" kicker={`${COMPANY.brand} · South Africa`} meta={<><span>Last updated {UPDATED}</span><span>{DOCUMENTS.length} documents</span><span>Plain language</span></>}>
    <div className="mx-auto grid max-w-7xl gap-10 px-5 py-10">
      {missing && <p role="alert" className="rounded-2xl border border-[#f6c9a4] bg-[#fff6ee] p-4 text-sm">We couldn’t find the document “{missing}”. It may have moved. Here is everything we publish.</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid gap-4">
          <p className="max-w-3xl text-[16px] leading-7 text-[#3b4a62]">These documents explain how {COMPANY.brand} works and the rights you have under South African law, including the Consumer Protection Act, the Electronic Communications and Transactions Act, the Protection of Personal Information Act (POPIA) and the National Land Transport Act.</p>
          <label className="relative block max-w-xl"><span className="sr-only">Search legal documents</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. refunds, privacy, drivers" className="min-h-12 w-full rounded-xl border border-[#d5dde7] bg-white px-4 text-sm shadow-sm outline-none focus:border-navy" /></label>
        </div>
        <aside className="grid gap-3 rounded-2xl border border-[#e3e8ef] bg-white p-5 text-sm shadow-[0_10px_30px_#071b3a0d]">
          <p className="font-display text-lg font-extrabold text-navy">Quick help</p>
          <a className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3 font-semibold hover:bg-[#eef2f7]" href="/delete-account">Delete your account<Icon name="arrow" size={16} /></a>
          <a className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3 font-semibold hover:bg-[#eef2f7]" href="/legal/paia">Request your records (PAIA)<Icon name="arrow" size={16} /></a>
          <a className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3 font-semibold hover:bg-[#eef2f7]" href={`mailto:${LEGAL.privacyEmail}`}>Email our privacy team<Icon name="mail" size={16} /></a>
        </aside>
      </div>
      {!anyMatch && <p className="rounded-2xl border border-dashed border-[#cbd2dc] p-8 text-center text-sm text-[#4D5B71]">No documents match “{q}”.</p>}
      {GROUPS.map((g) => {
        const docs = g.slugs.map((s) => findDoc(s)).filter((d): d is LegalDoc => !!d && match(d));
        if (!docs.length) return null;
        return <section key={g.title} aria-labelledby={`g-${g.icon}`} className="grid gap-4">
          <div className="flex items-start gap-3"><span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy text-white"><Icon name={g.icon} size={19} /></span>
            <div><h2 id={`g-${g.icon}`} className="font-display text-xl font-extrabold text-navy">{g.title}</h2><p className="text-sm text-[#4D5B71]">{g.blurb}</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{docs.map((d) => <a key={d.slug} href={`/legal/${d.slug}`} className="group grid content-between gap-4 rounded-2xl border border-[#e3e8ef] bg-white p-5 shadow-[0_6px_20px_#071b3a0a] transition hover:-translate-y-0.5 hover:border-navy hover:shadow-[0_14px_34px_#071b3a1a]">
            <div><p className="font-display text-lg font-extrabold text-navy">{d.title}</p><p className="mt-2 text-sm leading-6 text-[#4D5B71]">{d.summary}</p></div>
            <div className="flex items-center justify-between gap-3 border-t border-[#eef1f5] pt-3 text-[12px]"><span className="font-semibold uppercase tracking-wide text-[#7b879a]">{d.audience}</span><span className="inline-flex items-center gap-1 font-semibold text-navy">Read<Icon name="arrow" size={14} className="transition group-hover:translate-x-0.5" /></span></div>
          </a>)}</div>
        </section>;
      })}
    </div>
  </Frame>;
}

/** /legal/:slug */
export function LegalDocPage({ slug }: { slug: string }) {
  const doc = findDoc(slug);
  if (!doc) return <LegalIndex missing={slug} />;
  return <DocView doc={doc} />;
}

function DocView({ doc }: { doc: LegalDoc }) {
  useTitle(doc.title);
  const article = useRef<HTMLElement>(null);
  const { sections, active } = useSections(article, doc.slug);
  const [minutes, setMinutes] = useState(0);
  const [copied, setCopied] = useState(false);
  const [top, setTop] = useState(false);
  useEffect(() => {
    setMinutes(Math.max(1, Math.round((article.current?.innerText.split(/\s+/).length || 0) / 220)));
    const h = window.location.hash.slice(1); if (h) setTimeout(() => document.getElementById(h)?.scrollIntoView(), 50);
    const onScroll = () => setTop(window.scrollY > 900);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [doc.slug]);
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.href.split('#')[0]); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  const others = useMemo(() => {
    const group = GROUPS.find((g) => g.slugs.includes(doc.slug))?.slugs || [];
    return [...DOCUMENTS.filter((d) => d.slug !== doc.slug && group.includes(d.slug)), ...DOCUMENTS.filter((d) => d.slug !== doc.slug && !group.includes(d.slug))];
  }, [doc.slug]);
  return <Frame crumb={doc.title} title={doc.title} kicker="Legal centre"
    meta={<><span className="inline-flex items-center gap-2"><Icon name="people" size={15} />For {doc.audience.toLowerCase()}</span><span className="inline-flex items-center gap-2"><Icon name="clock" size={15} />Last updated {UPDATED}</span>{minutes > 0 && <span>{minutes} min read</span>}</>}
    actions={<><button className={ghost} onClick={() => window.print()}><Icon name="file" size={16} />Print or save as PDF</button><button className={ghost} onClick={copy}><Icon name="check" size={16} />{copied ? 'Link copied' : 'Copy link'}</button></>}>
    <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_230px] lg:py-10">
      {/* Phones and tablets: switch document, and jump within this one */}
      <div className="grid gap-3 lg:hidden print:hidden">
        <label className="grid gap-1 text-[13px] font-semibold text-[#4D5B71]">Document
          <select className="min-h-12 rounded-xl border border-[#d5dde7] bg-white px-3 text-sm font-semibold text-navy" value={doc.slug} onChange={(e) => { window.location.href = `/legal/${e.target.value}`; }}>
            {DOCUMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.title}</option>)}</select></label>
        {sections.length > 1 && <details className="rounded-xl border border-[#d5dde7] bg-white"><summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold text-navy">On this page ({sections.length} sections)</summary>
          <ol className="grid gap-1 border-t border-[#eef1f5] p-2 text-sm">{sections.map((s, i) => <li key={s.id}><a className="block rounded-lg px-3 py-2 hover:bg-[#f5f7fa]" href={`#${s.id}`}><span className="mr-2 text-[#8a96a8]">{i + 1}</span>{s.title}</a></li>)}</ol></details>}
      </div>
      {/* Desktop: all documents */}
      <nav aria-label="Legal documents" className="hidden lg:block print:hidden"><div className="sticky top-24 grid gap-1 text-sm">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a96a8]">Documents</p>
        {DOCUMENTS.map((d) => <a key={d.slug} aria-current={d.slug === doc.slug ? 'page' : undefined} href={`/legal/${d.slug}`} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${d.slug === doc.slug ? 'bg-white font-semibold text-navy shadow-[0_4px_14px_#071b3a12]' : 'text-[#4D5B71] hover:bg-white/70 hover:text-navy'}`}><Icon name={iconFor(d.slug)} size={15} className={d.slug === doc.slug ? 'text-orange' : 'text-[#9aa5b5]'} />{d.title}</a>)}
        <a href="/delete-account" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[#4D5B71] hover:bg-white/70 hover:text-navy"><Icon name="trash" size={15} className="text-[#9aa5b5]" />Delete your account</a>
      </div></nav>
      <main className="min-w-0">
        <div className="grid gap-5">
          <DraftNotice />
          <article ref={article} className="legal rounded-3xl border border-[#e3e8ef] bg-white px-5 py-8 text-[16px] leading-[1.75] text-[#26354d] shadow-[0_14px_40px_#071b3a0d] sm:px-10 sm:py-10 print:border-0 print:p-0 print:shadow-none">
            <div className="grid gap-8">{doc.body()}</div>
          </article>
          <div className="grid gap-4 rounded-3xl border border-[#e3e8ef] bg-white p-6 print:hidden sm:grid-cols-[1fr_auto] sm:items-center">
            <div><p className="font-display text-lg font-extrabold text-navy">Questions about this document?</p><p className="text-sm text-[#4D5B71]">Email <a className="font-semibold text-navy underline" href={`mailto:${LEGAL.legalEmail}`}>{LEGAL.legalEmail}</a>. For privacy requests, email <a className="font-semibold text-navy underline" href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.</p></div>
            <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy px-5 text-sm font-semibold text-white hover:bg-navy-2" href="/legal">All documents<Icon name="arrow" size={16} /></a>
          </div>
          <nav aria-label="Related documents" className="grid gap-3 print:hidden"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a96a8]">Related</p>
            <div className="grid gap-3 sm:grid-cols-3">{others.slice(0, 3).map((d) => <a key={d.slug} href={`/legal/${d.slug}`} className="rounded-2xl border border-[#e3e8ef] bg-white p-4 text-sm hover:border-navy"><b className="text-navy">{d.title}</b><span className="mt-1 block text-[#4D5B71]">{d.summary}</span></a>)}</div></nav>
        </div>
      </main>
      {/* Wide screens: sections of this document */}
      {sections.length > 1 && <aside aria-label="On this page" className="hidden xl:block print:hidden"><div className="sticky top-24 grid gap-1 text-[13px]">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a96a8]">On this page</p>
        {sections.map((s) => <a key={s.id} href={`#${s.id}`} aria-current={active === s.id ? 'location' : undefined} className={`border-l-2 px-3 py-1.5 leading-5 ${active === s.id ? 'border-orange font-semibold text-navy' : 'border-[#e3e8ef] text-[#5b6b82] hover:border-[#9aa5b5] hover:text-navy'}`}>{s.title}</a>)}
      </div></aside>}
    </div>
    {top && <button aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="fixed bottom-5 right-5 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-navy text-white shadow-lg print:hidden"><Icon name="up" size={18} /></button>}
  </Frame>;
}

export const PrivacyPage = () => <LegalDocPage slug="privacy" />;
export const TermsPage = () => <LegalDocPage slug="terms" />;

/** /delete-account (required by Google Play and the App Store). */
export function DeleteAccountPage() {
  useTitle('Delete your account');
  return <Frame crumb="Delete your account" title={`Delete your ${COMPANY.brand} account`} kicker="Your data, your choice" meta={<><span>Takes effect immediately</span><span>Last updated {UPDATED}</span></>}>
    <div className="mx-auto grid max-w-5xl gap-6 px-5 py-10">
      <div className="grid gap-4 sm:grid-cols-3">{[
        ['car', 'In the app', 'Account → Delete account → enter your password and type DELETE.'],
        ['user', 'On the website', <><a className="font-semibold text-navy underline" href="/">Sign in</a> → My DROP → Profile → Sign-in security → Delete my account.</>],
        ['mail', 'Can’t sign in?', <>Email <a className="font-semibold text-navy underline" href={`mailto:${COMPANY.email}?subject=Delete%20my%20account`}>{COMPANY.email}</a> from your account’s address with the subject “Delete my account”. We confirm it’s you and delete it within 30 days.</>],
      ].map(([icon, t, d]) => <div key={t as string} className="grid content-start gap-3 rounded-2xl border border-[#e3e8ef] bg-white p-5 shadow-[0_6px_20px_#071b3a0a]">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-white"><Icon name={icon as IconName} size={18} /></span><p className="font-display text-lg font-extrabold text-navy">{t}</p><p className="text-sm leading-6 text-[#3b4a62]">{d}</p></div>)}</div>
      <article className="legal grid gap-8 rounded-3xl border border-[#e3e8ef] bg-white px-5 py-8 text-[16px] leading-[1.75] text-[#26354d] sm:px-10">
        <S id="deleted" n="1" title="What is deleted, and what is kept">
          <L items={[
            <><b>Deleted straight away:</b> your name, email and phone number, saved places, bank account, two-step sign-in, devices and push tokens, and live location. You are signed out everywhere.</>,
            <><b>Kept, unlinked from your contact details:</b> trip and payment records for 5 years (tax law), and identity-verification records for 5 years after closure (financial-intelligence law). Then they are deleted.</>,
          ]} />
        </S>
        <S id="before" n="2" title="Before you delete">
          <O items={['Drivers: withdraw your wallet balance, or settle any service fees owed.', 'Cancel any monthly plan or group trip you no longer want; refunds follow the Cancellation and Refund Policy.', 'Download any receipts you want to keep from My DROP.']} />
        </S>
        <S id="rights" n="3" title="Your other rights">
          <P>You can also ask for a copy of your information, correct it, or object to how we use it. See the <A href="/legal/privacy">Privacy Policy</A> and <A href="/legal/paia">PAIA Manual</A>, or email <A href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</A>.</P>
          <Box><P>If you are unhappy with how we handled your request, you may complain to the Information Regulator (South Africa): <A href="https://inforegulator.org.za">inforegulator.org.za</A>.</P></Box>
        </S>
      </article>
    </div>
  </Frame>;
}

/** Any address the site doesn't serve. */
export function NotFoundPage() {
  useTitle('Page not found');
  return <div className="flex min-h-screen flex-col bg-navy text-white">
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5"><a href="/" aria-label={`${COMPANY.brand} home`}><Logo light /></a></div>
    <main className="mx-auto grid w-full max-w-3xl flex-1 content-center gap-6 px-5 pb-24 text-center">
      <p className="font-display text-[96px] font-extrabold leading-none text-orange sm:text-[140px]">404</p>
      <h1 className="font-display text-3xl font-extrabold sm:text-4xl">This road doesn’t go anywhere.</h1>
      <p className="text-white/75">The page you were looking for has moved or never existed. Let’s get you back on route.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <a className="motion-button gold-button inline-flex min-h-12 items-center gap-2 rounded-xl px-6 text-sm font-bold text-navy" href="/">Go to the home page<Icon name="arrow" size={16} /></a>
        <a className="inline-flex min-h-12 items-center rounded-xl border border-white/25 px-6 text-sm font-semibold hover:bg-white/10" href="/group-travel">Group travel</a>
        <a className="inline-flex min-h-12 items-center rounded-xl border border-white/25 px-6 text-sm font-semibold hover:bg-white/10" href="/legal">Legal centre</a>
      </div>
    </main>
  </div>;
}
