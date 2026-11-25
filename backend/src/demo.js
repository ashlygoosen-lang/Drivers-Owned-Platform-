/**
 * Demo accounts for every dashboard, with realistic sample data.
 *
 * Demo logins are ON unless DEMO_MODE=false is set.
 * DEMO_MODE=false  disable them (do this before real customers use the site)
 *
 * Demo accounts have random, unknown passwords: the only way in is the one-click demo login, which
 * only works while demo mode is on. Turn demo mode OFF before real customers use the site: the demo
 * Super Admin, compliance, support and finance accounts can see real customer data.
 */
import crypto from 'node:crypto';
import { db, id, now, nextRef } from './db.js';
import { hashPassword } from './auth.js';
import { DOC_TYPES, REQUIREMENTS, storeEncrypted, encryptText, sealIdNumber } from './kyc.js';
import { quote } from './pricing.js';
import { post, cents, walletAccount } from './money/ledger.js';
import { recordCardPayment, settleTrip } from './money/settlement.js';

import { demoEnabled, DEMO_DOMAIN, isDemoUser, demoRoleAllowed } from './demoPolicy.js';
export { demoEnabled, DEMO_DOMAIN, isDemoUser, demoRoleAllowed };

export const DEMO_ACCOUNTS = [
  { role: 'passenger', email: `passenger@${DEMO_DOMAIN}`, name: 'Lerato Mokoena', title: 'Passenger', blurb: 'Book rides, track trips, verification done.' },
  { role: 'driver', email: `driver@${DEMO_DOMAIN}`, name: 'Thabo Nkosi', title: 'Driver', blurb: 'Ride requests, wallet, DROP card, withdrawals.' },
  { role: 'business', email: `business@${DEMO_DOMAIN}`, name: 'Naledi Dlamini', title: 'Business', blurb: 'Company trips, team members, invoices.' },
  { role: 'admin', email: `admin@${DEMO_DOMAIN}`, name: 'Demo Super Admin', title: 'Super Admin', blurb: 'Everything: users, drivers, finance, staff.' },
  { role: 'compliance', email: `compliance@${DEMO_DOMAIN}`, name: 'Nomsa Khumalo', title: 'Compliance', blurb: 'Review ID documents and verify accounts.' },
  { role: 'support', email: `support@${DEMO_DOMAIN}`, name: 'Sipho Ndlovu', title: 'Support', blurb: 'Tickets, enquiries, user and trip look-up.' },
  { role: 'finance', email: `finance@${DEMO_DOMAIN}`, name: 'Fiona van Wyk', title: 'Finance', blurb: 'Pool account, payouts, cards, ledger.' },
];


/* ---------- sample documents (clearly marked as demo) ---------- */
function demoPdf(title) {
  const text = `DROP DEMO DOCUMENT - ${title} - NOT A REAL DOCUMENT`.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 50 780 Td (${text.slice(0, 70)}) Tj 0 -30 Td /F1 12 Tf (Sample file for the DROP demo dashboards.) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${stream.length}>>stream\n${stream}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj${o}endobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

/** A tiny valid PNG (solid colour) for photo documents such as the selfie. */
function demoPng() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
}

function saId(yymmdd, serial) {
  const partial = yymmdd + serial;
  for (let c = 0; c < 10; c++) {
    const n = partial + c;
    let sum = 0;
    for (let i = 0; i < 13; i++) { let d = Number(n[12 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    if (sum % 10 === 0) return n;
  }
  return partial + '0';
}

const iso = (daysAgo, hour = 9) => { const d = new Date(Date.now() - daysAgo * 86_400_000); d.setUTCHours(hour, 15, 0, 0); return d.toISOString(); };
const dayStr = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function addVerification(user, { status, profile, docStatuses = {}, submittedDaysAgo = 3 }) {
  const req = REQUIREMENTS[user.role];
  const documents = [...req.required, ...(user.role === 'driver' ? ['roadworthy'] : [])].map((type) => {
    const meta = DOC_TYPES[type];
    const docStatus = docStatuses[type] || (status === 'verified' ? 'approved' : 'pending');
    const isPhoto = meta.imageOnly;
    return {
      id: id(), type, file: storeEncrypted(isPhoto ? demoPng() : demoPdf(meta.label)), mime: isPhoto ? 'image/png' : 'application/pdf', ext: isPhoto ? 'png' : 'pdf',
      originalName: `${type.replace(/_/g, '-')}-demo.${isPhoto ? 'png' : 'pdf'}`, size: 1200, status: docStatus,
      reason: docStatus === 'rejected' ? 'The image is blurry. Please upload a clearer copy.' : '',
      expiresAt: meta.expires ? dayStr(type === 'prdp' ? 21 : 400) : null, issuedAt: meta.maxAgeDays ? dayStr(-20) : null,
      uploadedAt: iso(submittedDaysAgo + 1), reviewedAt: docStatus === 'pending' ? null : iso(submittedDaysAgo - 1), reviewedBy: docStatus === 'pending' ? null : 'Nomsa Khumalo',
    };
  });
  const decided = status === 'verified';
  db.insert('verifications', {
    id: id(), userId: user.id, role: user.role, profile: profile.idNumber ? sealIdNumber(profile, profile.idNumber) : profile, documents, status,
    consentAt: iso(submittedDaysAgo), submittedAt: status === 'in_progress' ? null : iso(submittedDaysAgo),
    decision: decided ? 'approved' : null, decidedAt: decided ? iso(submittedDaysAgo - 1) : null, decidedBy: decided ? 'Nomsa Khumalo' : null, decisionNote: '',
    history: [{ status: 'submitted', at: iso(submittedDaysAgo) }, ...(decided ? [{ status: 'verified', at: iso(submittedDaysAgo - 1), by: 'Nomsa Khumalo' }] : [])],
    createdAt: iso(submittedDaysAgo + 1),
  });
  db.update('users', user.id, { verificationStatus: status });
}

const address = { addressLine1: '12 Long Street', suburb: 'City Centre', city: 'Cape Town', province: 'Western Cape', postalCode: '8001', nationality: 'South African', idType: 'sa_id' };

async function makeUser(acc, extra = {}) {
  return db.insert('users', {
    id: id(), name: acc.name, email: acc.email, phone: acc.phone || '+27 82 000 0000', role: acc.role, company: acc.company || '',
    passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')), // unknown password: demo login only
    online: false, savedPlaces: { home: 'Sea Point Promenade', work: 'Cape Town City Centre' }, paymentPreference: 'Card', notifications: 'Email',
    demo: true, createdAt: iso(40), ...extra,
  });
}

function makeBooking(passenger, driver, { pickup, destination, category = 'Comfort', service = 'Ride', payment = 'Card', daysAgo = 1, status = 'completed', rating = 5, passengerName = '' }) {
  const q = quote({ service, pickup, destination });
  const o = q.options.find((x) => x.category === category) || q.options[0];
  const at = iso(daysAgo, 7 + (daysAgo % 10));
  const booking = db.insert('bookings', {
    id: id(), ref: nextRef('booking', 'DRP'), userId: passenger.id, service, category: o.category, pickup, destination, passengers: service === 'Delivery' ? 0 : 1,
    parcel: service === 'Delivery' ? 'Signed contract, one envelope' : '', passengerName, notes: '', scheduledFor: null, payment,
    distanceKm: q.distanceKm, durationMin: q.durationMin, approximate: q.approximate, fare: o.fare, passengerCommission: 0, driverServiceFee: o.driverServiceFee, driverEarnings: o.driverEarnings,
    status, paymentStatus: payment === 'Card' ? 'paid' : payment === 'Cash' ? 'cash' : 'invoice', driverId: status === 'requested' ? null : driver?.id || null,
    rating: status === 'completed' ? rating : null, feedback: status === 'completed' && rating === 5 ? 'Friendly driver, spotless car.' : '',
    history: [{ status: 'requested', at }, ...(status === 'completed' ? [{ status: 'accepted', at }, { status: 'in_progress', at }, { status: 'completed', at }] : [])],
    completedAt: status === 'completed' ? at : null, createdAt: at,
  });
  if (payment === 'Card') {
    const reference = `DEMO-${booking.ref}`;
    recordCardPayment(booking, { reference, amountCents: cents(o.fare), provider: 'Demo' });
    db.update('bookings', booking.id, { paymentReference: reference });
  }
  if (status === 'completed' && driver) settleTrip(db.byId('bookings', booking.id));
  return booking;
}

/** Create the demo accounts and sample data once. Safe to call on every start. */
/**
 * A trip in progress between the demo passenger and the demo driver, so both can try chat and calls
 * (sign in as each in two browsers). Recreated if a visitor completes or cancels it.
 */
export function seedDemoTrip() {
  if (!demoEnabled()) return;
  const passenger = db.find('users', (u) => u.email === `passenger@${DEMO_DOMAIN}`);
  const driver = db.find('users', (u) => u.email === `driver@${DEMO_DOMAIN}`);
  if (!passenger || !driver) return;
  if (db.find('bookings', (b) => b.driverId === driver.id && ['accepted', 'arriving', 'in_progress'].includes(b.status))) return;
  const b = makeBooking(passenger, driver, { pickup: 'V&A Waterfront', destination: 'Kirstenbosch Gardens', category: 'Comfort', payment: 'Cash', daysAgo: 0, status: 'arriving' });
  const at = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString();
  db.update('bookings', b.id, { demoLive: true, notes: 'Meet at the clock tower', history: [{ status: 'requested', at: at(9) }, { status: 'accepted', at: at(8) }, { status: 'arriving', at: at(7) }] });
  db.update('users', driver.id, { online: true });
  const msg = (who, text, minAgo) => db.insert('messages', {
    id: id(), bookingId: b.id, senderId: who ? who.id : null, senderRole: who === driver ? 'driver' : who ? 'passenger' : 'system', senderName: who ? who.name.split(' ')[0] : 'DROP',
    kind: who ? 'text' : 'system', text, createdAt: at(minAgo), readAt: who ? at(minAgo - 0.5) : undefined,
  });
  msg(null, 'Driver assigned. You can message and call each other here. Your numbers stay private.', 8);
  msg(driver, 'Hi Lerato, Thabo here. I’m 5 minutes away in a white Corolla Quest.', 6);
  msg(passenger, 'Great, I’m at the clock tower by the entrance.', 5);
  msg(driver, 'Perfect, see you there.', 4);
}

export async function seedDemo() {
  if (!demoEnabled()) return false;
  if (db.find('users', (u) => u.email === DEMO_ACCOUNTS[0].email)) { seedDemoTrip(); return false; }
  const A = Object.fromEntries(DEMO_ACCOUNTS.map((a) => [a.role, a]));

  const passenger = await makeUser({ ...A.passenger, phone: '+27 82 123 4567' });
  addVerification(passenger, { status: 'verified', profile: { ...address, legalName: 'Lerato Mokoena', idNumber: saId('900101', '500908'), dateOfBirth: '1990-01-01' } });

  const driver = await makeUser({ ...A.driver, phone: '+27 82 111 2222' }, { vehicle: 'Toyota Corolla Quest · CA 123-456', driverStatus: 'approved', rating: 4.9 });
  addVerification(driver, { status: 'verified', profile: { ...address, addressLine1: '45 Main Road', suburb: 'Observatory', postalCode: '7925', legalName: 'Thabo Nkosi', idNumber: saId('880505', '512308'), dateOfBirth: '1988-05-05', emergencyName: 'Zanele Nkosi', emergencyPhone: '+27829998888' } });
  db.insert('applications', { id: id(), ref: nextRef('application', 'APP'), userId: driver.id, participation: 'Driver-owner programme', city: 'Cape Town', vehicle: 'Toyota Corolla Quest · CA 123-456', vehicleYear: 2020, vehicleColour: 'White', seats: 4, documents: {}, status: 'approved', checks: { identity: 'verified', inspection: 'passed', activation: 'active' }, notes: '', reviewedBy: 'Nomsa Khumalo', createdAt: iso(30) });

  const business = await makeUser({ ...A.business, company: 'Atlantic Seaboard Hotels (Pty) Ltd', phone: '+27 21 555 0100' }, {
    paymentPreference: 'Business account',
    employees: [['Ayesha Patel', 'ayesha@atlanticseaboard.example', 'Guest services'], ['Johan Botha', 'johan@atlanticseaboard.example', 'Sales'], ['Kagiso Mabena', 'kagiso@atlanticseaboard.example', 'Operations']].map(([name, email, department]) => ({ id: id(), name, email, department, addedAt: iso(20) })),
  });
  addVerification(business, { status: 'verified', profile: { ...address, addressLine1: '1 Beach Road', suburb: 'Sea Point', postalCode: '8005', legalName: 'Naledi Dlamini', idNumber: saId('850315', '080908'), dateOfBirth: '1985-03-15', companyName: 'Atlantic Seaboard Hotels (Pty) Ltd', registrationNumber: '2015/123456/07', vatNumber: '4123456789' } });

  for (const role of ['admin', 'compliance', 'support', 'finance']) await makeUser({ ...A[role], phone: '' });

  // People waiting for compliance review
  const applicant = await makeUser({ name: 'Bongani Zulu', email: `applicant.driver@${DEMO_DOMAIN}`, role: 'driver', phone: '+27 83 444 5555' }, { vehicle: 'Suzuki Swift · CA 987-654', driverStatus: 'pending' });
  addVerification(applicant, { status: 'submitted', submittedDaysAgo: 1, profile: { ...address, addressLine1: '8 Klipfontein Road', suburb: 'Athlone', postalCode: '7764', legalName: 'Bongani Zulu', idNumber: saId('920812', '512308'), dateOfBirth: '1992-08-12', emergencyName: 'Thandi Zulu', emergencyPhone: '+27827776666' } });
  db.insert('applications', { id: id(), ref: nextRef('application', 'APP'), userId: applicant.id, participation: 'Driver-owner programme', city: 'Cape Town', vehicle: 'Suzuki Swift · CA 987-654', vehicleYear: 2021, vehicleColour: 'Silver', seats: 4, documents: {}, status: 'submitted', checks: { identity: 'pending', inspection: 'not scheduled', activation: 'pending review' }, notes: '', createdAt: iso(2) });
  const newRider = await makeUser({ name: 'Amahle Cele', email: `new.passenger@${DEMO_DOMAIN}`, role: 'passenger', phone: '+27 84 222 3333' });
  addVerification(newRider, { status: 'action_required', submittedDaysAgo: 2, docStatuses: { id_document: 'approved', proof_of_address: 'rejected' }, profile: { ...address, legalName: 'Amahle Cele', idNumber: saId('990720', '012308'), dateOfBirth: '1999-07-20' } });

  // Trips: card, cash and business; one open request for the driver to accept
  const trips = [
    ['Cape Town City Centre', 'Cape Town International Airport', 'Comfort', 'Card', 9], ['V&A Waterfront', 'Camps Bay', 'Comfort', 'Card', 8], ['Sea Point Promenade', 'Claremont', 'XL', 'Card', 6],
    ['Gardens', 'Woodstock', 'Comfort', 'Cash', 5], ['Rondebosch', 'Century City', 'Comfort', 'Card', 3], ['Green Point', 'Stellenbosch', 'Executive', 'Card', 2], ['Observatory', 'V&A Waterfront', 'Comfort', 'Cash', 1],
  ];
  for (const [pickup, destination, category, payment, daysAgo] of trips) makeBooking(passenger, driver, { pickup, destination, category, payment, daysAgo });
  for (const [pickup, destination, daysAgo, name] of [['Sea Point Promenade', 'Cape Town International Airport', 4, 'Ayesha Patel'], ['Sea Point Promenade', 'Century City', 2, 'Johan Botha']]) makeBooking(business, driver, { pickup, destination, category: 'Executive', payment: 'Business account', daysAgo, passengerName: name });
  makeBooking(passenger, null, { pickup: 'Cape Town City Centre', destination: 'Muizenberg', category: 'Comfort', payment: 'Cash', daysAgo: 0, status: 'requested' });

  // Driver wallet activity: card, bank account, withdrawals
  const card = db.insert('cards', { id: id(), userId: driver.id, reference: '70000000001', type: 'virtual', programme: process.env.CARD_PROGRAMME_NAME || 'DROP Driver Card', maskedNumber: '5999 00** **** 4821', validDate: '11/29', cardIdentifier: 'DEMO4821', trackingNumber: 'DEMO4821', status: 'active', sandbox: true, issuedAt: iso(12) });
  db.update('users', driver.id, { walletRef: '70000000001', bankAccount: { holder: 'Thabo Nkosi', bank: 'Capitec', branchCode: '470010', accountType: 'Savings', accountEnc: encryptText('1234567890'), masked: '•••• 7890', nameMatchesId: true, updatedAt: iso(15) } });
  for (const [amount, merchant, mcc, category, daysAgo] of [[45000, 'ENGEN OBSERVATORY        ZA', '5541', 'Fuel', 6], [3500, 'V&A WATERFRONT PARKING   ZA', '7523', 'Tolls & parking', 4], [52000, 'SHELL N1 CITY            ZA', '5541', 'Fuel', 2], [8900, 'CHECKERS OBSERVATORY     ZA', '5411', 'Food & groceries', 1]]) {
    const t = `DEMO${amount}${daysAgo}`;
    const entry = post({ type: 'card.purchase', memo: `Purchase · ${merchant.trim()}`, lines: [{ account: walletAccount(driver.id), dr: amount }, { account: 'card_settlement', cr: amount }], meta: { userId: driver.id, cardId: card.id, transactionID: t, mcc, category, merchant: merchant.trim() } });
    db.update('ledger', entry.id, { createdAt: iso(daysAgo, 14) });
    db.insert('cardEvents', { id: id(), key: `demo|${t}`, method: 'Deduct', reference: card.reference, userId: driver.id, cardId: card.id, transactionID: t, transactionDate: '', transactionType: '00', amount, merchant: merchant.trim(), mcc, category, captureMode: 'EMV', approved: true, reversed: 0, resultCode: 1, response: { resultCode: 1 }, createdAt: iso(daysAgo, 14) });
  }
  db.insert('cardEvents', { id: id(), key: 'demo|declined', method: 'Deduct', reference: card.reference, userId: driver.id, cardId: card.id, transactionID: 'DEMODECL', transactionDate: '', transactionType: '00', amount: 20000, merchant: 'SUNBET ONLINE ZA', mcc: '7995', category: 'Other', captureMode: 'ECOM', approved: false, reversed: 0, resultCode: -784, response: { resultCode: -784 }, createdAt: iso(3, 21) });
  const paid = db.insert('withdrawals', { id: id(), ref: nextRef('withdrawal', 'WDR'), userId: driver.id, amount: 50000, fee: 0, status: 'paid', bank: 'Capitec', branchCode: '470010', accountType: 'Savings', holder: 'Thabo Nkosi', masked: '•••• 7890', accountEnc: encryptText('1234567890'), bankReference: 'CAP-EFT-20931', paidAt: iso(5), processedBy: 'Fiona van Wyk', createdAt: iso(6) });
  post({ type: 'withdrawal.requested', key: `wdr:${paid.id}`, memo: `Withdrawal ${paid.ref} to Capitec •••• 7890`, meta: { userId: driver.id }, lines: [{ account: walletAccount(driver.id), dr: 50000 }, { account: 'payouts_pending', cr: 50000 }] });
  post({ type: 'withdrawal.paid', key: `wdr-paid:${paid.id}`, memo: `Withdrawal ${paid.ref} paid · CAP-EFT-20931`, meta: { userId: driver.id }, lines: [{ account: 'payouts_pending', dr: 50000 }, { account: 'pool', cr: 50000 }] });
  const open = db.insert('withdrawals', { id: id(), ref: nextRef('withdrawal', 'WDR'), userId: driver.id, amount: 30000, fee: 0, status: 'requested', bank: 'Capitec', branchCode: '470010', accountType: 'Savings', holder: 'Thabo Nkosi', masked: '•••• 7890', accountEnc: encryptText('1234567890'), createdAt: iso(0, 6) });
  post({ type: 'withdrawal.requested', key: `wdr:${open.id}`, memo: `Withdrawal ${open.ref} to Capitec •••• 7890`, meta: { userId: driver.id }, lines: [{ account: walletAccount(driver.id), dr: 30000 }, { account: 'payouts_pending', cr: 30000 }] });

  // Support desk content
  db.insert('tickets', { id: id(), ref: nextRef('ticket', 'SUP'), userId: passenger.id, role: 'passenger', type: 'Lost item', priority: 'normal', bookingRef: 'DRP-1002', message: 'I think I left my sunglasses in the car after my trip to Camps Bay.', status: 'in_progress', replies: [{ by: 'Sipho Ndlovu', message: 'We’ve contacted your driver and will update you shortly.', at: iso(1) }], createdAt: iso(2) });
  db.insert('tickets', { id: id(), ref: nextRef('ticket', 'SUP'), userId: driver.id, role: 'driver', type: 'Payment or fee dispute', priority: 'normal', bookingRef: '', message: 'Can you confirm when my withdrawal from this morning will reach my bank?', status: 'open', replies: [], createdAt: iso(0, 7) });
  db.insert('tickets', { id: id(), ref: nextRef('ticket', 'SUP'), userId: newRider.id, role: 'passenger', type: 'Safety concern', priority: 'urgent', bookingRef: '', message: 'A driver asked me to cancel in the app and pay cash instead. I did not feel comfortable.', status: 'open', replies: [], createdAt: iso(0, 8) });
  db.insert('enquiries', { id: id(), ref: nextRef('enquiry', 'ENQ'), userId: null, topic: 'Business solutions', name: 'Marco Rossi', email: 'marco@capeevents.example', phone: '+27 21 555 0199', company: 'Cape Events Co.', message: 'We need transport for 40 delegates during a conference in March. Can DROP help?', status: 'new', createdAt: iso(1) });
  db.insert('enquiries', { id: id(), ref: nextRef('enquiry', 'ENQ'), userId: null, topic: 'Driver ownership', name: 'Peter Mahlangu', email: 'peter.m@example.com', phone: '', company: '', message: 'How does the driver-owner programme work if I already drive for another platform?', status: 'contacted', createdAt: iso(3) });

  const notes = [[passenger.id, 'You’re verified', 'Your identity is verified. Thank you for helping keep DROP safe.'], [driver.id, 'Withdrawal paid', 'R 500.00 was sent to Capitec •••• 7890. Reference CAP-EFT-20931.'], [driver.id, 'Document expiring soon', 'Your PrDP expires in 3 weeks. Please upload a current copy to stay active.']];
  for (const [userId, title, body] of notes) db.insert('notifications', { id: id(), userId, title, body, link: title.includes('PrDP') ? 'verification' : 'wallet', read: false, createdAt: iso(1) });
  console.log(`[drop] Demo mode: created ${DEMO_ACCOUNTS.length} demo accounts with sample data.`);
  seedDemoTrip();
  return true;
}
