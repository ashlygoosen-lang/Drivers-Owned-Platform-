import { COMPANY } from '../lib/company';
import { Logo } from '../components/ui';

/**
 * Public legal pages linked from both apps and required by the App Store and Google Play:
 * /privacy, /terms and /delete-account. DRAFT wording: have it reviewed by a South African attorney
 * and fill in the Information Officer before launch.
 */
const UPDATED = '25 November 2026';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#F5F7FA] text-[#14223A]">
    <header className="bg-navy px-5 py-5"><a href="/" aria-label="DROP home"><Logo light /></a></header>
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="font-display text-3xl font-extrabold text-navy">{title}</h1>
      <p className="mt-2 text-sm text-[#4D5B71]">Last updated {UPDATED} · {COMPANY.brand} is a division of {COMPANY.parent} (registration {COMPANY.registration})</p>
      <div className="legal mt-8 grid gap-5 text-[15px] leading-7 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-navy [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </main>
  </div>;
}

export function PrivacyPage() {
  return <Shell title="Privacy notice">
    <p>This notice explains how DROP collects and uses personal information on the DROP website, the DROP passenger app and the DROP Driver app, in line with the Protection of Personal Information Act, 2013 (POPIA).</p>
    <h2>Who is responsible</h2>
    <p>{COMPANY.parent}, trading as {COMPANY.brand}. Information Officer: [name, registered with the Information Regulator] · {COMPANY.email}.</p>
    <h2>What we collect</h2>
    <ul>
      <li><b>Account:</b> name, email, mobile number, password (stored only as a one-way hash), optional two-step sign-in settings.</li>
      <li><b>Identity verification:</b> ID or passport number (encrypted), date of birth, nationality, residential address, proof of address and identity documents. Drivers also provide licence, PrDP, vehicle registration, insurance, a selfie and an emergency contact.</li>
      <li><b>Trips:</b> pickup and destination, times, fares, ratings and feedback, chat messages with your driver or passenger, and records of in-app calls (time and length, not the conversation).</li>
      <li><b>Location:</b> drivers’ precise location while they are online or on a trip, <b>including in the background when the app is closed</b>; a sampled route of each trip. Passengers’ location only if they choose to share it with their driver, and only until pickup.</li>
      <li><b>Payments:</b> payment references and amounts. Card numbers are entered on Paystack’s secure page and are never stored by DROP. Drivers’ bank account numbers are encrypted.</li>
      <li><b>Device and security:</b> push-notification tokens, app version, an app-integrity verdict from Google Play or Apple (to block fake apps), sign-in times, and hashed IP addresses in security logs.</li>
    </ul>
    <h2>Why we use it</h2>
    <ul>
      <li>To arrange and complete trips and deliveries, show passengers where their driver is, and calculate fares and arrival times.</li>
      <li>To verify identities, prevent fraud and keep passengers and drivers safe, including reviewing chats or routes when someone reports a problem.</li>
      <li>To pay drivers, issue DROP Driver Cards and keep financial records.</li>
      <li>To send trip updates, messages and incoming-call alerts.</li>
      <li>To meet legal obligations (tax, financial-intelligence and transport laws).</li>
    </ul>
    <p>We do not sell personal information, and we do not use it for third-party advertising or tracking.</p>
    <h2>Who we share it with</h2>
    <ul>
      <li>The other person on your trip: first name, vehicle, live location (driver), chat messages. Phone numbers are hidden when masked calling is enabled.</li>
      <li>Service providers who process information for us under contract: Paystack (payments), Paymentology (driver cards), Google Maps Platform (maps and routes), Twilio (masked phone calls), Expo, Google Firebase and Apple (push notifications and app-integrity checks), Cloudflare (security), Resend (email), and Railway (hosting).</li>
      <li>Authorities where the law requires it, or to protect someone’s safety.</li>
    </ul>
    <p>Some of these providers process information outside South Africa. We only use providers bound by agreements that protect personal information to a standard comparable to POPIA (section 72).</p>
    <h2>How long we keep it</h2>
    <ul>
      <li>Trip and payment records: 5 years (tax law).</li>
      <li>Identity verification records: 5 years after your account closes, then deleted.</li>
      <li>Chat messages and call records: kept with the trip record for safety and dispute handling.</li>
      <li>Security logs: up to 12 months.</li>
    </ul>
    <h2>Security</h2>
    <p>Information is encrypted in transit (HTTPS) and sensitive fields are encrypted at rest. Staff access is limited by role, requires two-step sign-in, and is recorded in a tamper-evident audit log.</p>
    <h2>Your rights</h2>
    <p>You may ask to access, correct or delete your personal information, object to processing, or withdraw consent, by emailing {COMPANY.email}. You can delete your account yourself (see <a className="underline" href="/delete-account">Delete your account</a>). You may also complain to the Information Regulator (inforegulator.org.za).</p>
    <h2>Children</h2>
    <p>DROP accounts are for people aged 18 and over. Drivers must be 21 or older.</p>
    <h2>Changes</h2>
    <p>We will tell you in the apps or by email before material changes take effect.</p>
  </Shell>;
}

export function TermsPage() {
  return <Shell title="Terms of use">
    <p className="rounded-xl bg-orange/10 p-4 text-sm">Draft for legal review. These summarise how DROP works. The full passenger terms, driver agreement and fee schedule apply.</p>
    <h2>The service</h2>
    <p>DROP is a platform that connects passengers and businesses with independent, verified drivers who own the platform. DROP shows an upfront fare before you book. Passengers pay no platform commission; drivers pay a disclosed service fee.</p>
    <h2>Your account</h2>
    <p>You must be 18 or older (21 for drivers), give accurate information, verify your identity and keep your sign-in details private. You are responsible for activity on your account. Tell us at once if you think it has been misused.</p>
    <h2>Trips and payments</h2>
    <p>Card payments are taken by Paystack before a driver is assigned and released to the driver when the trip is completed. Cancelled card trips are refunded. Cash fares are paid to the driver.</p>
    <h2>Safety and conduct</h2>
    <p>Treat everyone with respect. Don’t ask to move a trip off the platform. Chats, call records and routes may be reviewed by DROP when someone reports a problem. In an emergency call SAPS on 10111 (112 from a mobile phone).</p>
    <h2>Drivers</h2>
    <p>Drivers must hold the required licences, PrDP, operating permit, insurance and a roadworthy vehicle, and keep documents current. Earnings are paid to the driver’s wallet and can be withdrawn to a bank account in the driver’s name.</p>
    <h2>Liability</h2>
    <p>Nothing in these terms limits rights you have under the Consumer Protection Act. [Liability clauses to be completed by legal counsel.]</p>
    <h2>Contact</h2>
    <p>{COMPANY.parent} · {COMPANY.email}</p>
  </Shell>;
}

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
