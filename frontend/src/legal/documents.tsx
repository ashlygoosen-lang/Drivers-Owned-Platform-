import type { ReactNode } from 'react';
import { COMPANY, LEGAL } from '../lib/company';
import { S, P, L, O, Important, Box, Table, A } from './kit';

/**
 * DROP legal documents (South Africa). Plain-language drafts prepared for review by a South African
 * attorney before launch. Placeholders in [square brackets] come from LEGAL in lib/company.ts.
 */
export interface LegalDoc { slug: string; title: string; summary: string; audience: string; body: () => ReactNode }

const who = <>{COMPANY.parent} (registration number {COMPANY.registration}), trading as {COMPANY.brand} — {COMPANY.name}</>;
const contact = <>{LEGAL.supportEmail} · {LEGAL.phone}</>;

/* =========================================================================================== */
const terms: LegalDoc = {
  slug: 'terms', title: 'Terms of Service', audience: 'Passengers and business customers',
  summary: 'The agreement between you and DROP when you book rides, deliveries, premium drives, group travel and monthly plans.',
  body: () => <>
    <Box><P>These terms are written in plain language, as the Consumer Protection Act 68 of 2008 (CPA) requires. Clauses that limit our responsibility or place a risk on you are marked <b>Important</b>. Nothing in these terms takes away rights you have under the CPA, the Electronic Communications and Transactions Act 25 of 2002 (ECTA) or any other law.</P></Box>

    <S id="who" n="1." title="Who we are and how these terms apply">
      <P>DROP is operated by {who}. “DROP”, “we” and “us” mean that company. “You” means the person or business using DROP to travel, send a delivery or book a monthly plan.</P>
      <P>By creating an account or booking, you agree to these terms, the <A href="/legal/privacy">Privacy Policy</A>, the <A href="/legal/cancellations-refunds">Cancellation and Refund Policy</A>, the <A href="/legal/fees">Fees and Tariffs</A> and the <A href="/legal/community-guidelines">Community Guidelines</A>. Monthly plans are also governed by the <A href="/legal/scholar-transport">Scholar Transport Terms</A> or the <A href="/legal/staff-transport">Staff Transport Terms</A>. Group flights and coach trips also follow the group travel sections of the <A href="/legal/cancellations-refunds#group">Cancellation and Refund Policy</A> and <A href="/legal/fees#group">Fees and Tariffs</A>; the airline or coach operator provides the transport under its own conditions of carriage. Drivers sign the separate <A href="/legal/driver-agreement">Driver Partner Agreement</A>.</P>
    </S>

    <S id="service" n="2." title="What DROP does">
      <P>DROP is an e-hailing platform. Our website and apps connect you with independent, verified drivers (“driver-partners”) who own or operate their vehicles and provide the transport. We show you the fare before you book, match you with a driver, let you follow the trip live, handle card payments and keep a record of every trip.</P>
      <P>Under the National Land Transport Act 5 of 2009, as amended in 2023, e-hailing is a recognised public transport service. Driver-partners must hold their own operating licence, and DROP must be registered as an e-hailing platform provider with the National Public Transport Regulator (registration: {LEGAL.nptrRegistration}). We only let drivers whose documents we have checked accept trips.</P>
      <Important><P>Driver-partners are independent operators, not DROP employees. They are responsible for driving safely and lawfully. DROP is responsible for the platform, the checks we promise to do, payments we handle and the support we provide.</P></Important>
    </S>

    <S id="account" n="3." title="Your account">
      <L items={[
        'You must be 18 or older to hold a passenger account. Children may travel only with an adult, or on a scholar transport plan booked by their parent or guardian.',
        'Give us accurate details and keep them up to date. Before your first booking we verify your identity (and, for business accounts, your company). This protects drivers as well as passengers.',
        'Keep your password and two-step sign-in private. Tell us at once if you think someone else has used your account. You are responsible for bookings made through your account unless you told us it was compromised or it was not your fault.',
        'A business account may let its employees travel and charge trips to the business. The business is responsible for those trips and for telling its employees how DROP uses their information.',
      ]} />
    </S>

    <S id="booking" n="4." title="Booking a trip or delivery">
      <L items={[
        <>Before you confirm, we show the <b>fare in rand, including VAT where applicable</b>, and the driver service fee that DROP takes from the driver. Passengers pay <b>no platform commission</b>.</>,
        'If we cannot place an address precisely, the fare is an estimate based on a standard trip. We show this as “approximate” before you book.',
        'A booking is confirmed when a driver accepts it. You will see the driver’s first name, photo, vehicle, registration and live location.',
        'Card payments are taken by our payment provider, Paystack, before a driver is assigned and are held until the trip is completed. Cash fares are paid to the driver. Business-account trips are invoiced monthly.',
        'You receive an electronic receipt for every completed trip.',
        'Scheduled trips are offered to drivers ahead of the pickup time. We cannot guarantee that a driver will accept a scheduled trip; if none does, you are not charged.',
      ]} />
    </S>

    <S id="cancel" n="5." title="Cancelling">
      <P>You can cancel at no charge until your trip starts. Paid card trips that are cancelled are refunded to your card. Details, including monthly plans, are in the <A href="/legal/cancellations-refunds">Cancellation and Refund Policy</A>.</P>
      <P>Most of our services are for transport on a specific date and time, so the seven-day “cooling-off” right in section 44 of ECTA does not apply to them (ECTA s 42(2)). Our own cancellation policy still applies.</P>
    </S>

    <S id="safety" n="6." title="Safety and conduct">
      <L items={[
        'Wear a seat belt. Children must use the child restraint the law requires; parents provide it.',
        'Use the in-app panic button or call SAPS on 10111 (112 from a mobile phone) in an emergency. Vehicles used for e-hailing must also have a panic button, as the regulations require.',
        'Treat drivers with respect. Discrimination, harassment, threats, violence and damage to the vehicle are not allowed and may lead to your account being closed and the matter being reported to the police.',
        'Keep trips on the platform. Arranging to pay a DROP driver off the app removes the safety features, insurance and support that come with a DROP trip.',
        'Chats, call records (time and length, never the conversation), routes and panic-button events are kept and may be reviewed when someone reports a problem.',
        'Lost property: you can message or call your driver from the app for 2 hours after the trip; after that, contact support.',
      ]} />
      <P>See the <A href="/legal/community-guidelines">Community Guidelines</A> for the standards that apply to everyone.</P>
    </S>

    <S id="deliveries" n="7." title="Deliveries">
      <L items={[
        'You may not send anything illegal, stolen, dangerous or hazardous, firearms or ammunition, drugs, live animals, cash, bearer instruments, or items whose value you do not declare when we ask.',
        'Package items properly. The driver may refuse a parcel that is unsafe, too large for the chosen category, or appears to break this clause.',
        'Someone must be available to receive the parcel. If no one is, the driver will contact you and may return it to you at your cost.',
      ]} />
      <Important><P>Unless you have bought additional cover, DROP’s responsibility for loss of or damage to a parcel is limited to the lower of its proven value and {LEGAL.parcelLiabilityCap}, except where the loss was caused by our gross negligence or wilful misconduct, or where the CPA does not allow this limit.</P></Important>
    </S>

    <S id="plans" n="8." title="Monthly plans">
      <P>Scholar transport plans (for parents and guardians) and staff transport plans (for business accounts) are paid or invoiced per calendar month and are driven by one driver who accepts the plan. They are not fixed-term contracts: each month stands alone and renews only if you leave renewal switched on. You can cancel at any time on 24 hours’ notice, and every trip that does not run is refunded. See the <A href="/legal/scholar-transport">Scholar Transport Terms</A> and <A href="/legal/staff-transport">Staff Transport Terms</A>.</P>
    </S>

    <S id="prices" n="9." title="Prices and payment">
      <P>Current tariffs are set out in <A href="/legal/fees">Fees and Tariffs</A>. We may change tariffs for future bookings; the fare shown when you book is the fare you pay, unless you change the trip (for example, add a stop or change the destination) or the trip is cancelled. We do not apply hidden charges. If you are charged in error, we will refund the difference.</P>
      <P>VAT: {LEGAL.vatNumber}.</P>
    </S>

    <S id="liability" n="10." title="Our responsibility to you">
      <P>We will provide the platform with reasonable care and skill, carry out the driver and vehicle checks we describe, handle your money correctly and give you a way to reach us. If we do not, you may ask us to fix the problem, refund you for the affected service, or both.</P>
      <Important>
        <P>To the extent the law allows, DROP is not liable for: indirect or consequential loss (for example, a missed flight or lost income), loss caused by events beyond our reasonable control, or loss caused by a driver-partner’s conduct that we could not reasonably have prevented through the checks we promise.</P>
        <P>Nothing in these terms limits liability for death or personal injury caused by our negligence, for gross negligence or wilful misconduct, or any right that the CPA says cannot be excluded.</P>
      </Important>
      <P>Claims for bodily injury or death caused by a road accident are dealt with under the Road Accident Fund Act 56 of 1996. Driver-partners must also hold passenger liability insurance for e-hailing use.</P>
    </S>

    <S id="suspension" n="11." title="Suspending or closing accounts">
      <P>You can close your account at any time (see <A href="/delete-account">Delete your account</A>). We may suspend or close an account to protect people’s safety, to prevent fraud, to comply with the law, or if these terms are seriously or repeatedly broken. Except in an emergency or where the law prevents it, we will tell you why and give you a chance to respond.</P>
    </S>

    <S id="complaints" n="12." title="Complaints and disputes">
      <O items={[
        <>Contact us first: raise a ticket in My DROP or email {LEGAL.supportEmail}. Safety complaints are treated as urgent. We acknowledge complaints within 2 business days and aim to resolve them within 15 business days.</>,
        'If you are not satisfied, you may refer the matter to the Consumer Goods and Services Ombud (CGSO), the accredited industry ombud for consumer goods and services, or to the National Consumer Commission.',
        'Complaints about your personal information may also go to the Information Regulator (inforegulator.org.za).',
        'You may also approach a court. South African law applies to these terms. You agree that a magistrate’s court with jurisdiction may hear a claim even if its value exceeds that court’s usual limit, but you are not obliged to do so.',
      ]} />
    </S>

    <S id="ecta" n="13." title="Information we must give you (ECTA section 43)">
      <Table head={['Item', 'Details']} rows={[
        ['Full name and legal status', <>{COMPANY.parent}, a private company incorporated in South Africa, trading as {COMPANY.brand}</>],
        ['Registration number', COMPANY.registration],
        ['Directors', LEGAL.directors],
        ['Physical address', LEGAL.physicalAddress],
        ['Address for service of legal documents', LEGAL.serviceAddress],
        ['Telephone and email', contact],
        ['Website', LEGAL.website],
        ['Platform registration', LEGAL.nptrRegistration],
        ['Description of the service', 'E-hailing rides, deliveries, premium drives and monthly scholar and staff transport through independent driver-partners'],
        ['Prices', <A href="/legal/fees">Fees and Tariffs</A>],
        ['Cancellations and refunds', <A href="/legal/cancellations-refunds">Cancellation and Refund Policy</A>],
        ['Privacy and security', <><A href="/legal/privacy">Privacy Policy</A>. Card details are entered on Paystack’s PCI-DSS-compliant payment page and are never stored by DROP.</>],
        ['Record of your transaction', 'Every booking, receipt and payment is available in My DROP and the apps, and can be printed or saved.'],
        ['Dispute resolution', 'Section 12 above'],
        ['Access to information', <A href="/legal/paia">PAIA Manual</A>],
      ]} />
    </S>

    <S id="general" n="14." title="General">
      <L items={[
        'We may update these terms. We will tell you in the app or by email at least 14 days before a material change takes effect. If you do not agree, you may close your account before then.',
        'Notices to you are sent to the email address or app on your account; electronic notices have the same effect as written ones (ECTA). Legal notices to us go to the address for service in section 13.',
        'If any part of these terms is found invalid, the rest remains in force. If we do not enforce a right immediately, we have not given it up.',
      ]} />
    </S>
  </>,
};

/* =========================================================================================== */
const termsOfUse: LegalDoc = {
  slug: 'terms-of-use', title: 'Website and App Terms of Use', audience: 'Everyone who visits the website or uses the apps',
  summary: 'The rules for using drop.co.za and the DROP and DROP Driver apps.',
  body: () => <>
    <S id="scope" n="1." title="These terms">
      <P>These terms apply to anyone who visits the DROP website or uses the DROP passenger app or the DROP Driver app. If you book a trip or drive, the <A href="/legal/terms">Terms of Service</A> or the <A href="/legal/driver-agreement">Driver Partner Agreement</A> also apply.</P>
    </S>
    <S id="use" n="2." title="Using DROP lawfully">
      <P>You may use DROP only for lawful purposes and as intended. You may not:</P>
      <L items={[
        'access or try to access accounts, data or systems that are not yours, or test our security without our written permission;',
        'copy, scrape or harvest content or data from DROP by automated means, or use bots to create accounts or bookings;',
        'reverse engineer, modify, or tamper with the apps, or run modified versions of them;',
        'interfere with or overload the platform, including by spreading malware;',
        'impersonate anyone, or create an account using someone else’s identity or documents;',
        'use DROP to harass, defraud or harm anyone.',
      ]} />
      <P>Some of these acts are offences under the Cybercrimes Act 19 of 2020 and may be reported to the South African Police Service. Our apps check that they have not been tampered with, using Google Play Integrity and Apple App Attest.</P>
      <P>If you find a security weakness, please email {LEGAL.legalEmail} so we can fix it. We will not take action against people who report in good faith and do not access other people’s data.</P>
    </S>
    <S id="ip" n="3." title="Our content and brand">
      <P>The DROP name, logo, designs, software and content belong to {COMPANY.parent} or its licensors. You may use them only to use DROP as intended. You may share links to our pages. Please do not use our brand in a way that suggests we endorse you.</P>
    </S>
    <S id="your-content" n="4." title="What you send us">
      <P>You keep ownership of what you send through DROP (messages, ratings, feedback, documents). You allow us to use it to provide and improve the service, keep people safe and meet legal duties, as described in the <A href="/legal/privacy">Privacy Policy</A>. Ratings and feedback must be honest and must not include other people’s personal information.</P>
    </S>
    <S id="availability" n="5." title="Availability and changes">
      <P>We work to keep DROP available and secure, but we cannot promise it will always be uninterrupted or free of errors. We may change, add or remove features. We will give notice of changes that materially affect you where we reasonably can.</P>
      <Important><P>To the extent the law allows, we are not liable for loss caused by the website or apps being temporarily unavailable, or by your device, connection or app store, except where the CPA or another law says otherwise.</P></Important>
    </S>
    <S id="links" n="6." title="Other websites">
      <P>We link to services such as Paystack, Google Maps and the app stores. Their own terms and privacy policies apply when you use them, and we are not responsible for their content.</P>
    </S>
    <S id="electronic" n="7." title="Electronic communications">
      <P>You agree to receive information, notices and agreements from us electronically. Under ECTA, a data message has the same legal effect as a written document, and clicking to accept these terms is a valid signature for this purpose.</P>
    </S>
    <S id="law" n="8." title="Law and contact">
      <P>South African law applies. Questions about these terms: {LEGAL.legalEmail}. The information we are required to publish under section 43 of ECTA is in <A href="/legal/terms#ecta">section 13 of the Terms of Service</A>.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const privacy: LegalDoc = {
  slug: 'privacy', title: 'Privacy Policy', audience: 'Everyone whose personal information DROP processes',
  summary: 'How DROP collects, uses, shares and protects personal information under POPIA, including children’s information for scholar transport.',
  body: () => <>
    <Box><P>This policy explains how DROP processes personal information, as the Protection of Personal Information Act 4 of 2013 (POPIA) requires. It covers the DROP website, the DROP passenger app, the DROP Driver app and our monthly scholar and staff transport plans.</P></Box>

    <S id="responsible" n="1." title="Who is responsible">
      <P>The responsible party is {who}, {LEGAL.physicalAddress}.</P>
      <L items={[<>Information Officer: {LEGAL.informationOfficer}</>, <>Deputy Information Officer: {LEGAL.deputyInformationOfficer}</>, <>Privacy queries and requests: {LEGAL.privacyEmail}</>]} />
    </S>

    <S id="collect" n="2." title="What we collect">
      <Table head={['About', 'Information', 'Where it comes from']} rows={[
        ['Everyone with an account', 'Name, email, mobile number, password (stored only as a one-way hash), two-step sign-in settings, preferences, notifications', 'You'],
        ['Identity checks', 'ID or passport number (encrypted), date of birth, nationality, address, proof of address, identity documents', 'You'],
        ['Drivers (also)', 'Driving licence, Professional Driving Permit, operating licence, vehicle registration, roadworthy and insurance documents, a selfie with your ID (compared by our team; we do not create biometric templates), emergency contact, bank account (encrypted), earnings and payouts', 'You, and document issuers where we verify with them'],
        ['Drivers doing scholar transport (also)', 'Police clearance, and the results of checks against the National Child Protection Register and the National Register for Sex Offenders', 'You and the issuing authorities'],
        ['Trips', 'Pickup and destination, times, fares, ratings, feedback, in-app chat, call records (time and length, never the conversation), receipts', 'You, your driver or passenger, our systems'],
        ['Location', <>Drivers: precise location while online or on a trip, <b>including in the background when the app is closed</b>, and a sampled route of each trip. Passengers: location only if you choose to share it with your driver, and only until pickup.</>, 'Your device'],
        ['Payments', 'Payment references, amounts, last four card digits. Card numbers are entered on Paystack’s page and never reach DROP.', 'Paystack and you'],
        ['Devices and security', 'Push-notification tokens, app version, app-integrity results from Google or Apple, sign-in times, hashed IP addresses in security logs', 'Your device and our systems'],
        ['Learners on scholar plans', 'First name, grade, school, home and school addresses, pickup times, notes the parent gives (for example, “asthma pump in bag”), and the live location of their trip', 'The parent or guardian'],
        ['Employees on staff plans', 'Name, optional phone number, pickup point and shift times', 'The employer'],
        ['Group travellers', 'Full name as on passport or ID, date of birth, nationality, passport number and expiry (encrypted, and decrypted only to produce the passenger manifest for the airline or coach operator of that trip), contact details, ticket numbers, and parent or guardian consent for travellers under 18', 'The person booking'],
      ]} />
      <P>We ask only for what we need. Please do not give us more health information than a driver needs on the day.</P>
    </S>

    <S id="why" n="3." title="Why we use it, and on what basis">
      <Table head={['Purpose', 'Lawful basis (POPIA s 11)']} rows={[
        ['Arranging and completing trips, deliveries and plans; showing live location to the other person on the trip; calculating fares and arrival times', 'Performing our contract with you'],
        ['Verifying identities and driver documents; vetting scholar-transport drivers; preventing fraud; keeping people safe; reviewing chats or routes when a problem is reported', 'Legitimate interests in safety and fraud prevention; legal obligations under transport and child-protection law; your consent for special personal information'],
        ['Paying drivers, issuing DROP Driver Cards, keeping financial records', 'Contract and legal obligations (tax and company law)'],
        ['Sending trip updates, messages, calls and notifications', 'Contract'],
        ['Responding to authorities, courts and regulators', 'Legal obligations'],
        ['Improving and securing DROP (using aggregated or de-identified data where possible)', 'Legitimate interests'],
        ['Marketing DROP services', 'Your consent, or for existing customers, similar DROP services with an opt-out in every message (s 69)'],
      ]} />
      <P>We do not sell personal information. We do not use it for third-party advertising, and we do not track you across other websites.</P>
      <P>Matching passengers with drivers is automated (nearest available driver). We do not make decisions with legal or similarly significant effects about you by automated means alone: account suspensions and document decisions are made by people (s 71).</P>
    </S>

    <S id="special" n="4." title="Special personal information">
      <P>Some driver checks involve criminal-behaviour information (police clearances and register checks), which POPIA treats as special personal information. We process it only with the driver’s consent and because transport and child-protection laws require these checks (POPIA ss 26–27 and 33). It is seen only by our compliance team, encrypted at rest, and never shown to passengers.</P>
    </S>

    <S id="children" n="5." title="Children’s information (scholar transport)">
      <P>A child is anyone under 18. POPIA allows us to process a child’s personal information with the prior consent of a competent person, usually a parent or legal guardian (POPIA ss 34–35). When you book a scholar plan, you confirm that you are such a person and give that consent.</P>
      <L items={[
        'We collect only what is needed to transport the learner safely: first name, grade, school, addresses, times, and notes you choose to give.',
        'Learner details and the home address are shared only with the driver who accepts the plan, and only after acceptance. Drivers browsing plans see the times, the school and the distance, not names or addresses.',
        'The learner’s trip location is visible to you while the trip is in progress, and is kept with the trip record like any other trip.',
        'You can review the learner’s information in My DROP, ask us to correct it, or withdraw consent by cancelling the plan. Withdrawal stops future processing; we keep trip records for the periods in section 8.',
        'We never use a learner’s information for marketing.',
      ]} />
    </S>

    <S id="share" n="6." title="Who we share it with">
      <L items={[
        'The other person on your trip: first name, photo, vehicle and live location (driver), pickup point, chat messages. With masked calling, neither side sees the other’s number.',
        'Operators who process information for us under written agreements (POPIA s 21): Paystack (payments), Paymentology (driver cards), Google Maps Platform (maps and routes), Twilio (masked calling), Expo, Google Firebase and Apple (push notifications and app integrity), Cloudflare (security), Resend (email), Railway (hosting).',
        'The National Public Transport Regulator, provincial regulatory entities and other authorities where transport law requires it; the police or emergency services where someone’s safety is at risk; courts and regulators when legally required.',
        'A business customer receives trip records for trips charged to its account.',
      ]} />
      <P><b>Transfers outside South Africa.</b> Some operators store or process information outside South Africa. We use only providers bound by agreements or laws that give protection substantially similar to POPIA (s 72).</P>
    </S>

    <S id="security" n="7." title="How we protect it">
      <P>Information is encrypted in transit (HTTPS) and sensitive fields (ID numbers, bank numbers, two-step sign-in secrets, documents) are encrypted at rest. Staff access is limited by role, needs two-step sign-in and is recorded in a tamper-evident audit log. Backups are encrypted. If we discover a security compromise that affects your information, we will notify you and the Information Regulator as soon as reasonably possible (POPIA s 22).</P>
    </S>

    <S id="retention" n="8." title="How long we keep it">
      <Table head={['Record', 'How long']} rows={[
        ['Trip, payment and invoice records', '5 years (tax law)'],
        ['Identity and driver verification records', '5 years after the account closes, then deleted'],
        ['Chat messages and call records', 'With the trip record, for safety and dispute handling'],
        ['Live location', 'The latest position is overwritten continuously; a sampled route is kept with the trip'],
        ['Security logs', 'Up to 12 months'],
        ['Learner details on scholar plans', 'With the plan and its trip records'],
      ]} />
      <P>When you delete your account, your contact details are removed straight away. Records the law requires us to keep are retained but unlinked from your contact details. See <A href="/delete-account">Delete your account</A>.</P>
    </S>

    <S id="rights" n="9." title="Your rights">
      <L items={[
        'Ask whether we hold your information and get a copy (POPIA s 23; see our PAIA Manual for formal requests).',
        'Ask us to correct or delete information that is inaccurate, out of date, excessive or unlawfully obtained (s 24).',
        'Object to processing based on legitimate interests, and to direct marketing at any time (s 11(3)).',
        'Withdraw consent where we rely on it, without affecting processing that happened before.',
        <>Complain to the Information Regulator: inforegulator.org.za.</>,
      ]} />
      <P>Email {LEGAL.privacyEmail}. We may need to confirm your identity first. We respond within 30 days.</P>
    </S>

    <S id="cookies" n="10." title="Cookies">
      <P>We use only essential cookies and similar storage. See the <A href="/legal/cookies">Cookie Notice</A>.</P>
    </S>
    <S id="changes" n="11." title="Changes">
      <P>We will tell you in the apps or by email before a material change to this policy takes effect.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const cookies: LegalDoc = {
  slug: 'cookies', title: 'Cookie Notice', audience: 'Website visitors',
  summary: 'The small number of essential cookies DROP uses, and why there are no advertising or tracking cookies.',
  body: () => <>
    <S id="what" n="1." title="What we use">
      <Table head={['Name', 'Provider', 'Purpose', 'How long']} rows={[
        ['drop_rt', 'DROP', 'Keeps you signed in securely. It is HttpOnly (page scripts cannot read it) and is sent only to our sign-in endpoint.', 'Until you sign out or the session expires'],
        ['cf_clearance, __cf_bm', 'Cloudflare', 'Protects the site from bots and attacks, and remembers that you passed a bot check.', 'Up to 30 minutes, or up to a year for cf_clearance'],
        ['Turnstile', 'Cloudflare', 'A privacy-preserving bot check on sign-up, sign-in and bookings, instead of a puzzle.', 'Session'],
      ]} />
    </S>
    <S id="none" n="2." title="What we don’t use">
      <P>We use no advertising, cross-site tracking or third-party analytics cookies, so there is nothing to opt in to or out of. If that changes, we will ask for your consent first and update this notice.</P>
    </S>
    <S id="control" n="3." title="Your choices">
      <P>You can block or delete cookies in your browser settings. If you block essential cookies, you will not be able to stay signed in.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const driverAgreement: LegalDoc = {
  slug: 'driver-agreement', title: 'Driver Partner Agreement', audience: 'Drivers and delivery partners',
  summary: 'The agreement between DROP and the independent drivers who use the DROP Driver app.',
  body: () => <>
    <S id="parties" n="1." title="The parties and the relationship">
      <P>This agreement is between {who} and you, the driver-partner. You use DROP to find and complete trips, deliveries and monthly plans in return for the fare, less the DROP service fee.</P>
      <P>You are an independent operator. You decide when and whether to go online, and which trips to accept. You are not required to work a minimum number of hours, and you may use other platforms, as the e-hailing regulations allow. Neither of us intends this agreement to create employment. Nothing in it limits any right you may have under labour law if the law treats the relationship differently.</P>
    </S>
    <S id="requirements" n="2." title="What you must have and keep valid">
      <L items={[
        'A valid South African driving licence, and a Professional Driving Permit (category P) to carry passengers for reward.',
        'An e-hailing operating licence for your vehicle, issued by the relevant provincial or municipal regulatory entity under the National Land Transport Act, as the law requires.',
        'A roadworthy vehicle, licensed and registered, with the e-hailing markings and panic button that the regulations require.',
        'Insurance that covers passenger liability for e-hailing use.',
        'A SIM card registered in your name (RICA) on the phone you drive with.',
        'For scholar transport only: a police clearance certificate, a clearance from the National Child Protection Register and the National Register for Sex Offenders, and an operating licence for learner transport.',
      ]} />
      <P>You upload these documents in the app. Our compliance team checks them before you can go online, and the app reminds you before they expire. You must tell us at once if any of them is suspended, withdrawn or expires, or if you are charged with an offence that could affect passengers’ safety.</P>
      <Important><P>It is a criminal offence to transport passengers for reward without the required operating licence. You are responsible for holding your own licence; DROP will not let you accept trips without the documents above, and may remove access if they lapse.</P></Important>
    </S>
    <S id="trips" n="3." title="Doing trips">
      <L items={[
        'Drive safely and lawfully: obey speed limits and road rules, never drive under the influence of alcohol or drugs, and use your phone only hands-free.',
        'Pick up only the passenger who booked, and follow the route the app suggests unless the passenger asks otherwise or safety requires a change.',
        'Do not ask passengers to pay off the app, or to cancel so you can take the trip privately.',
        'Accept assistance animals and passengers with disabilities. Do not refuse or treat anyone differently on a prohibited ground of discrimination.',
        'Follow the Community Guidelines and, for scholar transport, the handover instructions on each plan.',
      ]} />
    </S>
    <S id="money" n="4." title="Fares, the service fee and payouts">
      <L items={[
        'You earn the fare for each completed trip less the DROP service fee. The fee is currently 10% of the fare and is shown on every trip before you accept it. We give at least 30 days’ notice of any increase.',
        'Card and business-account fares are credited to your DROP wallet when the trip is completed. Monthly-plan trips are credited the same way, trip by trip.',
        'For cash trips you keep the cash; the service fee is charged to your wallet. If the service fees you owe reach R300, you need to settle them before taking more cash trips.',
        'You can withdraw your wallet balance (minimum R50, currently no withdrawal fee) to a bank account in your own name. You may also be issued a DROP Driver Card through our card partner, under its own terms.',
        'You are responsible for your own income tax, and for VAT if you are registered. We provide statements of your earnings and fees.',
      ]} />
    </S>
    <S id="ratings" n="5." title="Ratings, quality and deactivation">
      <P>Passengers rate trips, and you rate passengers. We may contact you about low ratings, complaints or safety concerns. We may suspend access immediately where there is a credible safety risk, a document lapses, or fraud is suspected. Otherwise, before deactivating you, we will tell you the reason and give you at least 5 business days to respond. A person, not an automated system, makes every deactivation decision, and you can ask for it to be reviewed.</P>
    </S>
    <S id="data" n="6." title="Your information">
      <P>We process your information as described in the <A href="/legal/privacy">Privacy Policy</A>, including your location while you are online or on a trip. You may use passengers’ information only to complete their trip, and must not keep, share or contact them after the trip, except to return lost property through the app.</P>
    </S>
    <S id="ownership" n="7." title="The driver-owner programme">
      <P>DROP intends to give drivers a stake in the platform. Participation (a voice in the driver community), membership (eligibility-based admission to the programme) and equity (any shareholding) are separate. Any membership or equity is governed only by formal programme documents that you sign; this agreement does not grant shares or a right to shares.</P>
    </S>
    <S id="liability" n="8." title="Responsibility and insurance">
      <Important><P>You are responsible for loss or injury caused by your driving or conduct, and for your vehicle, fuel, maintenance, fines and licences. You agree to keep the required insurance and to repay DROP for any claim a third party makes against DROP because of your breach of this agreement or the law.</P></Important>
    </S>
    <S id="ending" n="9." title="Ending this agreement">
      <P>You can stop using DROP at any time and delete your account after withdrawing or settling your wallet balance. We may end this agreement on 14 days’ notice, or immediately for a serious breach as described in section 5. Sections on money owed, information and responsibility continue after it ends.</P>
    </S>
    <S id="disputes" n="10." title="Disputes">
      <P>Raise any dispute with driver support first. If it is not resolved within 20 business days, either of us may refer it to mediation, and then to the courts of South Africa. South African law applies.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const scholar: LegalDoc = {
  slug: 'scholar-transport', title: 'Scholar Transport Terms', audience: 'Parents and guardians booking school transport',
  summary: 'How monthly scholar transport plans work: vetted drivers, consent, handover, absences, payment, cancellation and safety.',
  body: () => <>
    <Box><P>These terms apply to scholar transport plans, in addition to the <A href="/legal/terms">Terms of Service</A>. If anything here conflicts with those terms, these terms apply to scholar plans.</P></Box>
    <S id="who" n="1." title="Who can book">
      <P>A scholar plan may be booked only by a parent, legal guardian or another adult with parental responsibility for each learner (“you”), from a verified personal DROP account. By booking, you confirm this, and you give the consent described in the <A href="/legal/privacy#children">Privacy Policy</A> for DROP to process the learners’ information.</P>
    </S>
    <S id="drivers" n="2." title="Who drives your children">
      <P>Only drivers who meet all of the following can see, accept or drive scholar trips:</P>
      <L items={[
        'An approved DROP driver account (identity, driving licence, Professional Driving Permit, vehicle registration and insurance checked).',
        'A police clearance certificate.',
        'A clearance from the National Child Protection Register (Children’s Act 38 of 2005, s 126) and the National Register for Sex Offenders (Criminal Law (Sexual Offences and Related Matters) Amendment Act 32 of 2007, s 45), renewed at least every 12 months.',
        'An operating licence for learner transport, and a valid roadworthy certificate for the vehicle.',
      ]} />
      <P>Our compliance team checks these documents. If any of them expires or is withdrawn, the driver can no longer take scholar trips. If a check reveals that a driver is listed on either register, their access to all trips involving children ends immediately.</P>
      <P>One driver accepts your plan for the month. If that driver is unavailable on a day, the trip is offered only to other drivers who meet the same requirements, and you are told.</P>
    </S>
    <S id="vehicle" n="3." title="In the vehicle">
      <L items={[
        'Every learner has their own seat and seat belt. DROP does not allow learners to share seats, even where road traffic regulations would count children as fractions of a seat.',
        'You must provide any child restraint (car seat or booster) the law requires for your child’s age and size. The driver may not transport a child who needs a restraint without one.',
        'No smoking, vaping, alcohol or other passengers on scholar trips, other than the learners on the plan.',
        'Learners must follow the driver’s reasonable safety instructions. We will contact you if a learner’s behaviour puts anyone at risk.',
      ]} />
    </S>
    <S id="handover" n="4." title="Pickup and handover">
      <L items={[
        'The driver arrives at the pickup time on the plan and waits up to 5 minutes. If the learner is not there, the driver contacts you through the app before leaving.',
        'At drop-off the driver follows the handover option you chose: hand over to a staff member at school, let the learner walk from the drop-off point, or hand over only to you.',
        'A driver will never leave a learner alone where your instructions require a handover. If no one is there to receive the learner, the driver contacts you and your emergency contact, waits in a safe place, and follows your instructions or brings the learner home.',
        'You can follow every trip live and receive notifications when the driver is on the way, when the learner is picked up and when they are dropped off.',
      ]} />
    </S>
    <S id="days" n="5." title="School days, absences and holidays">
      <L items={[
        'Trips run on the days and at the times on your plan, from the start date to the end of that month. Public holidays (Public Holidays Act 36 of 1994) are excluded automatically.',
        'School holidays differ between schools and provinces. Please skip those days in My DROP.',
        'You can skip any day up to 12 hours before the first pickup that day. Skipped days are refunded. On the day itself, you can cancel that trip in the app before it starts, and it is refunded too.',
      ]} />
    </S>
    <S id="price" n="6." title="Price and payment">
      <P>The plan price is shown before you book: each trip costs the on-demand fare less a 15% plan discount, and the total covers every trip in the period. You pay the full month in advance by card through Paystack. The money is held by DROP and released to the driver trip by trip, when each trip is completed. At the end of the period, everything you paid for trips that did not run is refunded to your card automatically, in one refund.</P>
    </S>
    <S id="renewal" n="7." title="Renewal">
      <P>From the 20th of each month, if renewal is switched on, we prepare next month’s plan with the same driver and tell you the price. It goes ahead only if you pay it. You can switch renewal off or change the plan at any time. This is a month-to-month arrangement, not a fixed-term contract.</P>
    </S>
    <S id="cancel" n="8." title="Cancelling">
      <P>You can cancel a plan at any time in My DROP. Trips stop 24 hours after you cancel, and every trip that does not run is refunded. If you cancel before paying, nothing is charged. The driver may also release a plan; we will then find another vetted driver, and trips continue to be offered to vetted drivers meanwhile.</P>
    </S>
    <S id="incidents" n="9." title="Safety incidents">
      <P>In an emergency, the driver contacts emergency services first, then you. Drivers must report any incident, injury or concern about a learner to DROP immediately. Anyone who suspects a child is being abused or neglected may report it to a designated child protection organisation, the provincial social development department or the police (Children’s Act s 110). DROP will cooperate fully with any investigation and may suspend a driver while it takes place.</P>
      <Important><P>DROP checks drivers and vehicles as described above and monitors trips, but the driver is responsible for driving safely. Our responsibility is set out in section 10 of the Terms of Service, and nothing limits our liability for our own negligence that causes injury, or any right under the CPA.</P></Important>
    </S>
    <S id="contact" n="10." title="Questions and complaints">
      <P>Raise a ticket in My DROP (safety tickets are handled first) or email {LEGAL.supportEmail}. Complaint escalation is explained in section 12 of the Terms of Service.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const staff: LegalDoc = {
  slug: 'staff-transport', title: 'Staff Transport Terms', audience: 'Business customers',
  summary: 'Monthly staff transport plans for business accounts: routes, invoicing, changes, cancellation and responsibilities.',
  body: () => <>
    <Box><P>These terms apply to staff transport plans booked by a business account, together with the <A href="/legal/terms">Terms of Service</A>. The Consumer Protection Act applies to a business customer only where the law treats it as a consumer (for example, below the turnover threshold set by the Minister).</P></Box>
    <S id="plans" n="1." title="How staff plans work">
      <L items={[
        'A plan covers one route (pickup point, workplace, times and days) from its start date to the end of that month, for up to 4 staff in a Comfort vehicle or 6 in an XL. Set up a plan per route or shift.',
        'Any approved DROP driver may accept a staff plan. One driver drives the plan for the month; on a day they cannot, the trip is offered to the nearest available driver.',
        'Each trip appears in your trip history and is tracked live like any other trip.',
        'Public holidays are excluded automatically. Skip other days (shutdowns, leave) in your dashboard at least 12 hours before the first pickup.',
      ]} />
    </S>
    <S id="price" n="2." title="Price and invoicing">
      <P>Each trip costs the on-demand fare less a 15% plan discount. Staff plans are charged to your business account: completed trips appear on your monthly invoice with your other business trips, and you pay only for trips that were driven. Invoices are payable within {LEGAL.invoiceTerms} unless your account agreement says otherwise. You may instead choose to pay a plan in advance by card, in which case trips that do not run are refunded at the end of the period.</P>
    </S>
    <S id="responsibilities" n="3." title="Your responsibilities">
      <L items={[
        'Give accurate route, time and passenger details, and keep them up to date.',
        'Tell your employees that DROP will process their names, contact numbers and trip locations to provide the transport, and give them our Privacy Policy. You are responsible for having a lawful basis to share their information with us (POPIA).',
        'Make sure your staff follow the Community Guidelines. You are responsible for damage your staff cause to a vehicle.',
      ]} />
    </S>
    <S id="cancel" n="4." title="Changes and cancellation">
      <P>You can switch renewal off, or cancel a plan at any time. Trips stop 24 hours after you cancel. A driver may release a plan; we will look for another driver and keep offering the trips to nearby drivers meanwhile.</P>
    </S>
    <S id="liability" n="5." title="Responsibility">
      <Important><P>Our responsibility is set out in section 10 of the Terms of Service. To the extent the law allows, DROP is not liable to your business for indirect loss such as lost productivity because a trip was late or did not run; in that case you pay nothing for that trip.</P></Important>
      <P>Nothing in these terms affects any rights your employees have under the Compensation for Occupational Injuries and Diseases Act 130 of 1993 or the Road Accident Fund Act 56 of 1996.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const refunds: LegalDoc = {
  slug: 'cancellations-refunds', title: 'Cancellation and Refund Policy', audience: 'Passengers and business customers',
  summary: 'When you can cancel, what it costs, and how and when refunds are paid.',
  body: () => <>
    <S id="trips" n="1." title="Rides, deliveries and premium drives">
      <Table head={['When you cancel', 'Charge', 'Refund for card trips']} rows={[
        ['Before a driver accepts', 'None', 'Full refund'],
        ['After a driver accepts, before the trip starts', 'None', 'Full refund'],
        ['After the trip starts', 'Cannot be cancelled in the app; contact support if something went wrong', 'Reviewed by support'],
      ]} />
      <P>If a driver cancels, or no driver accepts your trip, you are not charged, and any card payment is refunded in full.</P>
    </S>
    <S id="plans" n="2." title="Monthly scholar and staff plans">
      <L items={[
        'Cancel a plan at any time. Trips stop 24 hours later. Every trip that does not run is refunded.',
        'Skip a day up to 12 hours before the first pickup: that day is refunded.',
        'Cancel a single plan trip in the app before it starts: that trip is refunded.',
        'Public holidays are never charged.',
        'Refunds for card-paid plans are made automatically at the end of the period, in one refund of everything paid for trips that did not run.',
        'Staff plans on a business account are invoiced only for trips driven, so there is nothing to refund.',
      ]} />
    </S>
    <S id="group" n="3." title="Group travel (flights and coaches)">
      <P>Your payment is held in a separate account for your group and is only paid to the airline or coach operator once the group is confirmed. The fees below are the defaults; the fees for your route are shown before you pay and in My DROP.</P>
      <Table head={['When', 'Cancellation fee', 'Refund']} rows={[
        ['Before you pay (seat hold)', 'None', 'Nothing was charged'],
        ['Before the group’s fill deadline', 'None', 'Everything you paid'],
        ['After the fill deadline, before tickets are issued', '50% of what you paid', 'The rest'],
        ['After tickets are issued', '100%', 'None (the airline or operator has been paid). Airline or operator rules may allow changes; contact support'],
      ]} />
      <L items={[
        'If the group does not reach its minimum by the deadline, or the airline or operator cancels, you get a full refund. On some routes we first offer a free move to another group on the same route; if you decline, or do not choose within 7 days, we refund you in full.',
        'If you paid a deposit, the balance is due by the date shown in My DROP. If it is still unpaid 48 hours after that date, the booking is cancelled under the fees above.',
        'Unpaid seat holds expire after 30 minutes and the seats are released.',
        'You are responsible for valid passports, visas and any consent affidavits required for travellers under 18.',
      ]} />
    </S>
    <S id="how" n="4." title="How refunds are paid">
      <P>Card refunds go back to the card you paid with, through Paystack. We start the refund straight away; your bank usually shows it within 5 to 10 business days. Cash fares are settled with the driver; contact support if you were overcharged.</P>
    </S>
    <S id="problems" n="5." title="Something went wrong">
      <P>If you were charged incorrectly, the service was not provided, or a trip was unsafe, raise a ticket in My DROP within 30 days. If we find that the service was not provided with reasonable care and skill, we will refund you for the affected service (CPA ss 54 and 56 principles).</P>
    </S>
    <S id="ecta" n="6." title="Cooling-off">
      <P>The seven-day cooling-off right for online transactions (ECTA s 44) does not apply to transport services for a specific date or period, or to services that have started with your consent (ECTA s 42(2)). The more generous rights above apply instead.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const fees: LegalDoc = {
  slug: 'fees', title: 'Fees and Tariffs', audience: 'Everyone',
  summary: 'What passengers pay, what drivers pay, and how monthly plans and group travel are priced.',
  body: () => <>
    <S id="passengers" n="1." title="Passengers">
      <P>The fare is calculated as a base amount plus a rate per kilometre and per minute for the route, with a minimum fare per vehicle category, and rounded to the nearest R5. You see the total before you book. <b>Passengers pay no platform commission.</b> There is no surge pricing.</P>
      <P>The current tariffs for every service and category are listed on the <A href="/?info=Fee%20structure">live tariff table</A>. Tariffs shown at launch are subject to final confirmation.</P>
    </S>
    <S id="drivers" n="2." title="Drivers">
      <Table head={['Item', 'Amount']} rows={[
        ['DROP service fee', '10% of each fare, shown on every trip before the driver accepts'],
        ['Cash trips', 'The service fee is charged to the driver’s wallet; cash trips pause when R300 or more is owed'],
        ['Wallet withdrawals', 'Minimum R50, no withdrawal fee'],
        ['Sign-up and monthly platform fees', 'None'],
      ]} />
      <P>We give drivers at least 30 days’ notice of any change to these amounts.</P>
    </S>
    <S id="plans" n="3." title="Monthly plans">
      <P>Each trip on a scholar or staff plan costs the on-demand fare less 15%. The monthly price is the sum of all trips from the start date to the month end, excluding public holidays. Trips that do not run are not charged (see the <A href="/legal/cancellations-refunds">Cancellation and Refund Policy</A>).</P>
    </S>
    <S id="group" n="4." title="Group travel">
      <P>Group flights and coach trips have a fixed price per person, shown before you book, and charged in South African rand (US dollar amounts are estimates). Children pay the same fare and every traveller, including infants, needs a seat. You can pay in full or pay a deposit (usually 30%) with the balance due by the group’s fill deadline. There is no booking fee.</P>
    </S>
    <S id="vat" n="5." title="VAT">
      <P>Amounts include VAT where it applies. VAT registration: {LEGAL.vatNumber}.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const guidelines: LegalDoc = {
  slug: 'community-guidelines', title: 'Community Guidelines', audience: 'Passengers, drivers and business customers',
  summary: 'The standards of respect and safety that apply to everyone on DROP.',
  body: () => <>
    <S id="respect" n="1." title="Respect everyone">
      <L items={[
        'No discrimination on the basis of race, gender, sex, pregnancy, marital status, ethnic or social origin, colour, sexual orientation, age, disability, religion, conscience, belief, culture, language or birth (Constitution s 9; Promotion of Equality and Prevention of Unfair Discrimination Act 4 of 2000).',
        'Drivers must accept guide dogs and other assistance animals.',
        'No harassment, threats, violence, or sexual comments or contact of any kind. Sexual misconduct leads to permanent removal and a report to the police.',
        'Keep conversations polite; don’t share other people’s personal information.',
      ]} />
    </S>
    <S id="safety" n="2." title="Stay safe">
      <L items={[
        'Drivers: zero tolerance for alcohol or drugs, keep to speed limits, phone hands-free only, take breaks when tired.',
        'Passengers: wear a seat belt, check the vehicle registration and the driver’s photo before you get in, and use the panic button or call 10111 (112 from a mobile) in an emergency.',
        'No weapons in DROP vehicles, except where carried lawfully by a licence holder and kept out of sight.',
        'No smoking or vaping in DROP vehicles.',
      ]} />
    </S>
    <S id="fair" n="3." title="Keep it fair">
      <L items={[
        'Pay and be paid through the app. Off-app arrangements remove safety features and support.',
        'Rate honestly. No fake accounts, fake trips or manipulation of ratings or fares.',
        'Respect the vehicle and the passenger’s property.',
      ]} />
    </S>
    <S id="report" n="4." title="Reporting and enforcement">
      <P>Report a problem from the trip screen or My DROP. Safety reports are reviewed first, by a person. Depending on what happened, we may warn, suspend or remove an account, and we report crimes to the police. Drivers are given reasons and a chance to respond, as the Driver Partner Agreement sets out.</P>
    </S>
  </>,
};

/* =========================================================================================== */
const paia: LegalDoc = {
  slug: 'paia', title: 'PAIA Manual', audience: 'Anyone requesting access to records',
  summary: 'The manual of VINK Group (Pty) Ltd, trading as DROP, under section 51 of the Promotion of Access to Information Act.',
  body: () => <>
    <Box><P>Prepared in terms of section 51 of the Promotion of Access to Information Act 2 of 2000 (PAIA), as amended, and section 17 of POPIA. Date: {LEGAL.version}. Reviewed at least once a year.</P></Box>
    <S id="body" n="1." title="The private body and its contact details">
      <Table head={['Item', 'Details']} rows={[
        ['Name', <>{COMPANY.parent}, trading as {COMPANY.brand} ({COMPANY.name})</>],
        ['Registration number', COMPANY.registration],
        ['Physical address', LEGAL.physicalAddress],
        ['Postal address', LEGAL.postalAddress],
        ['Telephone', LEGAL.phone],
        ['Email for PAIA requests', LEGAL.privacyEmail],
        ['Website', LEGAL.website],
        ['Information Officer (head of the private body)', LEGAL.informationOfficer],
        ['Deputy Information Officer', LEGAL.deputyInformationOfficer],
      ]} />
    </S>
    <S id="guide" n="2." title="The Information Regulator’s guide">
      <P>The Information Regulator has published a guide on how to use PAIA and POPIA (PAIA s 10). It is available in the official languages on the Regulator’s website, inforegulator.org.za, and at its offices. You may also ask our Information Officer for a copy.</P>
    </S>
    <S id="automatic" n="3." title="Records available without a request (s 52)">
      <L items={['Our Terms of Service, Terms of Use, Privacy Policy, Cookie Notice, Driver Partner Agreement, plan terms, refund policy, fees, Community Guidelines and this manual, all published on our website', 'Public information about our services on our website and in the apps']} />
    </S>
    <S id="legislation" n="4." title="Records kept in terms of legislation">
      <P>We keep records as required by, among others: the Companies Act 71 of 2008; Income Tax Act 58 of 1962; Value-Added Tax Act 89 of 1991; Tax Administration Act 28 of 2011; Basic Conditions of Employment Act 75 of 1997; Labour Relations Act 66 of 1995; Employment Equity Act 55 of 1998; Compensation for Occupational Injuries and Diseases Act 130 of 1993; Unemployment Insurance Act 63 of 2001; Skills Development Levies Act 9 of 1999; Consumer Protection Act 68 of 2008; Electronic Communications and Transactions Act 25 of 2002; Protection of Personal Information Act 4 of 2013; National Land Transport Act 5 of 2009; National Road Traffic Act 93 of 1996; Children’s Act 38 of 2005; Criminal Law (Sexual Offences and Related Matters) Amendment Act 32 of 2007; Cybercrimes Act 19 of 2020; and the Financial Intelligence Centre Act 38 of 2001 where it applies.</P>
    </S>
    <S id="records" n="5." title="Subjects and categories of records">
      <Table head={['Subject', 'Categories of records']} rows={[
        ['Company', 'Incorporation documents, registers, minutes, resolutions, statutory returns'],
        ['Finance and tax', 'Financial statements, accounting records, ledger, invoices, payment records, tax returns'],
        ['Customers (passengers and businesses)', 'Accounts, verification records, bookings, trip records, receipts, complaints, correspondence'],
        ['Driver-partners', 'Applications, verification and vetting documents, vehicle records, agreements, earnings and payout records, ratings and conduct records'],
        ['Scholar and staff plans', 'Plans, consents, learner and staff details given by parents or employers, trip records'],
        ['Employees', 'Employment contracts, personnel and payroll records, leave, training'],
        ['Suppliers and operators', 'Contracts, data-processing agreements, invoices'],
        ['Information technology and security', 'System documentation, access and audit logs, security incident records, backups'],
      ]} />
    </S>
    <S id="popia" n="6." title="Processing of personal information (POPIA)">
      <P>The purposes of processing, the categories of data subjects and information, the recipients, transfers outside South Africa and our security measures are described in the <A href="/legal/privacy">Privacy Policy</A>, which forms part of this manual.</P>
    </S>
    <S id="request" n="7." title="How to request access">
      <O items={[
        'Complete Form 2 (Request for Access to Record) prescribed by the PAIA Regulations, available on the Information Regulator’s website or from our Information Officer.',
        'Send it to the Information Officer at the email or address above. Give enough detail to identify the records and show which right you want to exercise or protect, and how you want access (copy, inspection, electronic).',
        'Pay the request fee (currently R140 for private bodies) and any access fee for copies, as prescribed in Annexure B of the PAIA Regulations. If you ask only for your own personal information, you do not pay the request fee.',
        'We decide within 30 days, which we may extend once by up to 30 days with notice. If we refuse, we give reasons.',
      ]} />
      <P>We may refuse access on the grounds in Chapter 4 of Part 3 of PAIA, for example to protect another person’s privacy, commercial information of a third party, the safety of individuals, or legally privileged records.</P>
    </S>
    <S id="remedies" n="8." title="If you are not satisfied">
      <P>There is no internal appeal against a decision of a private body. You may complain to the Information Regulator within 180 days of the decision, or apply to court for relief (PAIA ss 77A and 78).</P>
    </S>
    <S id="availability" n="9." title="Availability of this manual">
      <P>This manual is available on our website and, on request, at our offices free of charge.</P>
    </S>
  </>,
};

export const DOCUMENTS: LegalDoc[] = [terms, termsOfUse, privacy, cookies, driverAgreement, scholar, staff, refunds, fees, guidelines, paia];
export const findDoc = (slug: string) => DOCUMENTS.find((d) => d.slug === slug);
