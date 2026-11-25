import { useEffect } from 'react';
import { COMPANY, LEGAL } from '../lib/company';
import { DOCUMENTS, findDoc } from './documents';
import { Logo } from '../components/ui';

/**
 * Public legal pages linked from both apps and required by the App Store and Google Play:
 * /privacy, /terms and /delete-account. DRAFT wording: have it reviewed by a South African attorney
 * and fill in the Information Officer before launch.
 */
const UPDATED = LEGAL.version;

function Shell({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return <div className="min-h-screen bg-[#F5F7FA] text-[#14223A]">
    <header className="bg-navy px-5 py-5 print:hidden"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><a href="/" aria-label="DROP home"><Logo light /></a><a className="text-sm font-semibold text-white underline" href="/legal">All legal documents</a></div></header>
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="Legal documents" className="hidden text-sm lg:block print:hidden"><ul className="sticky top-6 grid gap-1">{DOCUMENTS.map((d) => <li key={d.slug}><a className={`block rounded-lg px-3 py-2 hover:bg-white ${title === d.title ? 'bg-white font-semibold text-navy' : 'text-[#4D5B71]'}`} href={`/legal/${d.slug}`}>{d.title}</a></li>)}
        <li><a className="block rounded-lg px-3 py-2 text-[#4D5B71] hover:bg-white" href="/delete-account">Delete your account</a></li></ul></nav>
      <main className="min-w-0 max-w-3xl">
        <h1 className="font-display text-3xl font-extrabold text-navy">{title}</h1>
        <p className="mt-2 text-sm text-[#4D5B71]">Last updated {UPDATED} · {COMPANY.brand} is a division of {COMPANY.parent} (registration {COMPANY.registration})</p>
        {aside}
        <div className="legal mt-8 grid gap-4 text-[15px] leading-7">{children}</div>
      </main>
    </div>
  </div>;
}

const Draft = () => <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-orange/10 p-4 text-sm print:hidden"><span><b>Draft for legal review.</b> Prepared in plain language under South African law; to be confirmed by a South African attorney before launch. Items in [square brackets] are still to be completed.</span><button className="rounded-lg border border-[#cbd0d7] bg-white px-3 py-1 font-semibold" onClick={() => window.print()}>Print or save as PDF</button></div>;

/** /legal: every document, with who it is for. */
export function LegalIndex() {
  return <Shell title="Legal">
    <p>These documents explain how DROP works and the rights you have under South African law, including the Consumer Protection Act, the Electronic Communications and Transactions Act, the Protection of Personal Information Act and the National Land Transport Act.</p>
    <div className="grid gap-3 sm:grid-cols-2">{DOCUMENTS.map((d) => <a key={d.slug} href={`/legal/${d.slug}`} className="rounded-xl border border-[#d2dae4] bg-white p-5 hover:border-navy">
      <p className="font-display text-lg font-bold text-navy">{d.title}</p><p className="mt-1 text-[11px] font-semibold uppercase leading-4 tracking-wide text-[#8a96a8]">{d.audience}</p><p className="mt-2 text-sm text-[#4D5B71]">{d.summary}</p></a>)}</div>
  </Shell>;
}

/** /legal/:slug — also served at /terms and /privacy, which the app stores link to. */
export function LegalDocPage({ slug }: { slug: string }) {
  const doc = findDoc(slug);
  useEffect(() => { document.title = doc ? `${doc.title} · DROP` : 'Legal · DROP'; const h = window.location.hash.slice(1); if (h) document.getElementById(h)?.scrollIntoView(); }, [doc]);
  if (!doc) return <LegalIndex />;
  return <Shell title={doc.title} aside={<><p className="mt-1 text-sm text-[#4D5B71]">For: {doc.audience}</p><Draft /></>}>{doc.body()}</Shell>;
}

export const PrivacyPage = () => <LegalDocPage slug="privacy" />;
export const TermsPage = () => <LegalDocPage slug="terms" />;

export function DeleteAccountPage() {
  return <Shell title="Delete your DROP account">
    <p>You can delete your account at any time, from the app or the website. It takes effect immediately.</p>
    <h2>In the DROP or DROP Driver app</h2>
    <p>Account → Delete account → enter your password and type DELETE.</p>
    <h2>On the website</h2>
    <p><a className="underline" href="/">Sign in</a> → My DROP → Profile → Sign-in security → Delete my account.</p>
    <h2>If you can’t sign in</h2>
    <p>Email {COMPANY.email} from the address on your account with the subject “Delete my account”. We’ll confirm it’s you and delete it within 30 days.</p>
    <h2>What is deleted, and what is kept</h2>
    <ul>
      <li><b>Deleted straight away:</b> your name, email and phone number, saved places, bank account, two-step sign-in, devices and push tokens, live location. You are signed out everywhere.</li>
      <li><b>Kept, unlinked from your contact details:</b> trip and payment records for 5 years (tax law); identity verification records for 5 years after closure (financial-intelligence law), then deleted.</li>
    </ul>
    <p>Drivers must withdraw their wallet balance, or settle any service fees owed, before deleting their account.</p>
  </Shell>;
}
