import { useCallback, useEffect, useState } from 'react';
import { api, date, money, openProtectedFile, STATUS_LABEL, type Application, type Booking, type DashboardData, type Employee, type Enquiry, type Ticket, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, input, Field, ErrorText, Icon, MapView, Spinner, StatusPill } from '../components/ui';
import { Counter } from '../motion/Counter';
import { useLoad, Loading, Empty, Table, type Notify } from './common';
import { VerificationCentre, VerificationBanner } from './Verification';
import { VerificationQueue, ExpiringDocuments, AuditLog } from './Compliance';
import { StaffManager, Notifications } from './Staff';
import { WalletPanel } from './Wallet';
import { FinanceOverviewPanel, Payouts, CardsAdmin, Ledger } from './Finance';
import { VERIFICATION_LABEL } from '../lib/api';

const TABS = {
  passenger: ['Overview', 'Verification', 'Book a ride', 'My trips', 'Places & payment', 'Notifications', 'Profile', 'Support'],
  driver: ['Overview', 'Verification', 'Ride requests', 'Wallet & card', 'Trip history', 'Vehicle & application', 'Ownership', 'Notifications', 'Profile', 'Support'],
  business: ['Overview', 'Verification', 'Company bookings', 'Employees', 'Invoices', 'Notifications', 'Account', 'Support'],
  compliance: ['Overview', 'Verification queue', 'Expiring documents', 'Audit log', 'Notifications', 'Profile'],
  support: ['Overview', 'Tickets', 'Enquiries', 'Users', 'Bookings', 'Notifications', 'Profile'],
  finance: ['Overview', 'Finance', 'Payouts', 'Cards', 'Ledger', 'Bookings', 'Users', 'Notifications', 'Profile'],
  admin: ['Overview', 'Verification queue', 'Applications', 'Drivers', 'Users', 'Bookings', 'Finance', 'Payouts', 'Cards', 'Ledger', 'Tickets', 'Enquiries', 'Expiring documents', 'Audit log', 'Staff', 'Notifications'],
} as const;

function Overview({ onAction, actionLabel }: { onAction: () => void; actionLabel: string }) {
  const { data, error } = useLoad<DashboardData>('/dashboard');
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const max = Math.max(1, ...data.chart.data.map((d) => d.value));
  return <>
    <div className={`grid gap-3 sm:grid-cols-2 ${data.stats.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>{data.stats.map((s) => <div key={s.label} className="stat-card rounded-lg bg-[#ebeff4] p-4"><p className="text-[12px] text-[#536175]">{s.label}</p><p className="mt-2 text-2xl font-semibold"><Counter value={s.value} money={s.money} /></p></div>)}</div>
    <div className="chart my-6 flex h-40 items-end justify-around gap-3 border-b border-[#cfd7e1] px-3" role="img" aria-label={`${data.chart.title}: ${data.chart.data.map((d) => `${d.day} ${d.value}`).join(', ')}`}>
      {data.chart.data.map((d, i) => <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[11px] text-[#536175]">{d.value ? (data.chart.money ? money(d.value) : d.value) : ''}</span><div className="chart-bar w-full max-w-10 rounded-t bg-[#4e5d73]" style={{ height: `${Math.max(2, (d.value / max) * 80)}%`, animationDelay: `${i * 60}ms` }} /><span className="text-[12px] text-[#526075]">{d.day}</span></div>)}
    </div>
    <p className="text-[12px] text-[#546276]">{data.chart.title}</p>
    <button className={`${button} mt-6`} onClick={onAction}>{actionLabel}<Icon name="arrow" size={16} /></button>
  </>;
}

function Trips({ onTrack, onBook, driver = false }: { onTrack: (b: Booking) => void; onBook?: () => void; driver?: boolean }) {
  const { data, error } = useLoad<{ bookings: Booking[] }>('/bookings');
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  if (!data.bookings.length) return <Empty>No trips yet.{onBook && <> <button className="font-semibold underline" onClick={onBook}>Book your first journey</button></>}</Empty>;
  return <Table head={['Reference', 'Journey', driver ? 'You earned' : 'Fare', 'Status', '']} rows={data.bookings.map((b) => [
    <b key="r">{b.ref}</b>,
    <span key="j">{b.pickup} → {b.destination}<span className="block text-[12px] text-[#505d71]">{b.service} · {b.category} · {date(b.createdAt)}{b.passengerName && ` · ${b.passengerName}`}</span></span>,
    money(driver ? b.driverEarnings : b.fare),
    <StatusPill key="s" status={b.status === 'requested' ? 'requested' : STATUS_LABEL[b.status]} />,
    driver ? '' : <button key="t" className="min-h-11 text-sm font-semibold underline" onClick={() => onTrack(b)}>{['completed', 'cancelled'].includes(b.status) ? (b.status === 'completed' && !b.rating ? 'Rate' : 'View') : 'Track'}</button>,
  ])} />;
}

function ProfileForm({ notify, places = false }: { notify: Notify; places?: boolean }) {
  const { user, setUser } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    form.querySelectorAll<HTMLInputElement>('input[type=password]').forEach((i) => { i.value = ''; });
    const body: Record<string, unknown> = places
      ? { savedPlaces: { home: f.home, work: f.work }, paymentPreference: f.paymentPreference }
      : { name: f.name, phone: f.phone, notifications: f.notifications, ...(f.company !== undefined && { company: f.company }), ...(f.newPassword && { newPassword: f.newPassword, currentPassword: f.currentPassword }) };
    setBusy(true); setError('');
    try { setUser((await api<{ user: User }>('/auth/me', { method: 'PATCH', body })).user); notify('Your changes have been saved.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="grid max-w-xl gap-4" onSubmit={submit}>
    {places ? <>
      <Field label="Home address"><input name="home" defaultValue={user.savedPlaces?.home} list="drop-places" className={input} placeholder="Your home address" /></Field>
      <Field label="Work address"><input name="work" defaultValue={user.savedPlaces?.work} list="drop-places" className={input} placeholder="Your work address" /></Field>
      <Field label="Preferred payment" hint="DROP never stores card numbers. You pay your driver directly."><select name="paymentPreference" defaultValue={user.paymentPreference} className={input}><option>Card</option><option>Cash</option>{user.role === 'business' && <option>Business account</option>}</select></Field>
    </> : <>
      <Field label="Full name"><input name="name" required minLength={2} defaultValue={user.name} className={input} /></Field>
      {user.role === 'business' && <Field label="Company name"><input name="company" defaultValue={user.company} className={input} /></Field>}
      <Field label="Mobile number"><input name="phone" type="tel" defaultValue={user.phone} className={input} /></Field>
      <Field label="Notifications"><select name="notifications" defaultValue={user.notifications} className={input}><option>Email</option><option>SMS</option><option>None</option></select></Field>
      <details className="rounded-lg border border-[#d2dae4] p-4"><summary className="cursor-pointer text-sm font-semibold">Change password</summary><div className="mt-4 grid gap-4"><Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" className={input} /></Field><Field label="New password"><input name="newPassword" type="password" minLength={8} autoComplete="new-password" className={input} /></Field></div></details>
    </>}
    <ErrorText>{error}</ErrorText>
    <button className={button} disabled={busy}>{busy && <Spinner />}Save changes</button>
  </form>;
}

function Support({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ tickets: Ticket[] }>('/support/tickets');
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    try { const r = await api<{ ticket: Ticket }>('/support/tickets', { body: Object.fromEntries(new FormData(form)) }); notify(`Ticket ${r.ticket.ref} opened. Our support team will respond by email.`); form.reset(); setError(''); void reload(); }
    catch (err) { setError((err as Error).message); }
  }
  return <div className="grid gap-8 lg:grid-cols-2">
    <form className="grid gap-4" onSubmit={submit}>
      <Field label="Issue type"><select name="type" className={input}>{['Trip help', 'Payment or fee dispute', 'Safety concern', 'Lost item', 'Account', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Booking reference (optional)"><input name="bookingRef" className={input} placeholder="DRP-1001" /></Field>
      <Field label="Tell us what happened"><textarea name="message" required minLength={10} rows={4} className={`${input} py-3`} /></Field>
      <ErrorText>{error}</ErrorText>
      <button className={button}>Open a ticket</button>
      <p className="text-[12px] text-[#505d71]">In an emergency, call SAPS on 10111 first.</p>
    </form>
    <div><h4 className="mb-3 text-sm font-semibold">Your tickets</h4>{!data ? <Loading /> : !data.tickets.length ? <Empty>No tickets yet.</Empty> : <ul className="grid gap-3">{data.tickets.map((t) => <li key={t.id} className="rounded-lg border border-[#d7dee7] p-4 text-sm"><div className="flex items-center justify-between gap-3"><b>{t.ref} · {t.type}</b><StatusPill status={t.status} /></div><p className="mt-2 text-[#505d71]">{t.message}</p>{t.replies.map((r, i) => <p key={i} className="mt-3 rounded bg-[#e6ecf3] p-3"><b>{r.by}:</b> {r.message}</p>)}</li>)}</ul>}</div>
  </div>;
}

/* ---------------- Driver ---------------- */
function DriverRequests({ notify }: { notify: Notify }) {
  const { user, setUser } = useAuth();
  const [state, setState] = useState<{ requests: Booking[]; active: Booking | null } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setState(await api('/drivers/requests')); } catch (err) { setError((err as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  if (!user) return null;
  const approved = user.driverStatus === 'approved' && user.verificationStatus === 'verified';
  const act = async (path: string, msg: string) => { try { await api(path, { body: {} }); notify(msg); setError(''); void load(); } catch (err) { setError((err as Error).message); } };
  const toggle = async () => { try { setUser((await api<{ user: User }>('/drivers/online', { body: { online: !user.online } })).user); setTimeout(load, 50); } catch (err) { setError((err as Error).message); } };
  const a = state?.active;
  const NEXT: Record<string, string> = { accepted: 'I’m on my way to pickup', arriving: 'Passenger collected · start trip', in_progress: 'Complete trip' };
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#ebeff4] p-4"><p className="text-sm">{approved ? (user.online ? 'You’re online and visible for new requests.' : 'Go online to receive ride and delivery requests.') : (user.verificationStatus === 'submitted' ? 'Your documents are being reviewed. You can go online as soon as they are approved.' : 'Complete your verification (Verification tab) to go online and accept trips.')}</p><button className={user.online ? button : outline} aria-pressed={!!user.online} disabled={!approved} onClick={toggle}>{user.online ? '● Online' : '○ Go online'}</button></div>
    <ErrorText>{error}</ErrorText>
    {a && <div className="rounded-xl border border-forest bg-[#e6ecf3] p-5"><StatusPill status={STATUS_LABEL[a.status]} /><h4 className="mt-3 font-semibold">{a.pickup} → {a.destination}</h4><p className="my-2 text-sm">{a.passenger?.name}{a.passenger?.phone && <> · <a className="underline" href={`tel:${a.passenger.phone}`}>{a.passenger.phone}</a></>}<br />{a.distanceKm} km · {money(a.fare)} fare · you keep {money(a.driverEarnings)} · {a.payment}{a.notes && <><br />Note: {a.notes}</>}{a.parcel && <><br />Parcel: {a.parcel}</>}</p>
      <div className="flex flex-wrap gap-3"><button className={button} onClick={() => act(`/drivers/bookings/${a.id}/advance`, a.status === 'in_progress' ? `Trip ${a.ref} complete. ${money(a.driverEarnings)} added to your earnings.` : 'Trip updated.')}>{NEXT[a.status]}</button>{a.status !== 'in_progress' && <button className={outline} onClick={() => act(`/bookings/${a.id}/cancel`, 'Trip released back to other drivers.')}>Release trip</button>}</div>
      <div className="mt-5 h-60"><MapView active /></div></div>}
    {user.online && !a && (!state ? <Loading /> : state.requests.length ? state.requests.map((b) => <div key={b.id} className="request-card rounded-xl bg-[#e6ecf3] p-5"><h4 className="font-semibold">{b.pickup} → {b.destination}</h4><p className="my-3 text-sm">{b.service} · {b.category} · {b.distanceKm} km · fare {money(b.fare)} · you keep {money(b.driverEarnings)}{b.scheduledFor && <><br />Scheduled: {date(b.scheduledFor)}</>}</p><button className={button} onClick={() => act(`/drivers/bookings/${b.id}/accept`, `Request ${b.ref} accepted. Head to the pickup point.`)}>Accept request</button></div>) : <Empty>No open requests right now. This list refreshes automatically.</Empty>)}
  </div>;
}

function DriverApplication() {
  const { data } = useLoad<{ application: Application | null }>('/drivers/application');
  if (!data) return <Loading />;
  const a = data.application;
  if (!a) return <Empty>No vehicle application on file.</Empty>;
  return <div className="grid gap-4 text-sm"><div className="flex items-center gap-3"><b>{a.ref}</b><StatusPill status={a.status} /></div>
    <Table head={['Check', 'Status']} rows={[['Identity & documents', <StatusPill key="i" status={a.status === 'approved' ? 'verified' : a.checks.identity} />], ['Vehicle inspection', <StatusPill key="v" status={a.checks.inspection} />], ['Account activation', <StatusPill key="a" status={a.checks.activation} />]]} />
    <p>Vehicle: {a.vehicle} · Programme: {a.participation}{a.city && ` · ${a.city}`}</p>{a.notes && <p className="rounded-lg bg-[#e6ecf3] p-3">Note from onboarding: {a.notes}</p>}</div>;
}

/* ---------------- Business ---------------- */
function Employees({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ employees: Employee[] }>('/business/employees');
  const [error, setError] = useState('');
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget;
    try { await api('/business/employees', { body: Object.fromEntries(new FormData(form)) }); form.reset(); setError(''); notify('Team member added.'); void reload(); } catch (err) { setError((err as Error).message); }
  }
  return <div className="grid gap-6">
    <form className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={add}><Field label="Name"><input name="name" required className={input} /></Field><Field label="Email"><input name="email" type="email" required className={input} /></Field><Field label="Department"><input name="department" className={input} /></Field><button className={`${button} min-h-12`}><Icon name="plus" size={16} />Add</button></form>
    <ErrorText>{error}</ErrorText>
    {!data ? <Loading /> : !data.employees.length ? <Empty>Add the people who travel on your company account.</Empty> : <Table head={['Name', 'Email', 'Department', '']} rows={data.employees.map((m) => [m.name, m.email, m.department || '—', <button key="x" aria-label={`Remove ${m.name}`} className="min-h-11 text-red-800" onClick={async () => { await api(`/business/employees/${m.id}`, { method: 'DELETE' }); void reload(); }}><Icon name="trash" size={17} /></button>])} />}
  </div>;
}

function Invoices() {
  const { data } = useLoad<DashboardData>('/dashboard');
  if (!data) return <Loading />;
  if (!data.invoices?.length) return <Empty>Invoices appear here once company trips are completed.</Empty>;
  return <Table head={['Invoice', 'Period', 'Trips', 'Total', 'Status']} rows={data.invoices.map((i) => [i.ref, i.period, i.trips, money(i.total), <StatusPill key="s" status={i.status} />])} />;
}

/* ---------------- Admin ---------------- */
function AdminApplications({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ applications: Application[] }>('/admin/applications');
  if (!data) return <Loading />;
  if (!data.applications.length) return <Empty>No driver applications yet.</Empty>;
  const decide = async (a: Application, status: string) => {
    const notes = status === 'rejected' ? window.prompt('Reason for declining (shared with the applicant):') ?? '' : '';
    try { await api(`/admin/applications/${a.id}`, { method: 'PATCH', body: { status, notes } }); notify(`${a.ref} marked ${status.replace('_', ' ')}.`); void reload(); } catch (err) { notify((err as Error).message); }
  };
  return <div className="grid gap-4">{data.applications.map((a) => <div key={a.id} className="rounded-xl border border-[#d2dae4] p-5 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><b>{a.ref} · {a.applicant?.name}</b><span className="flex gap-2"><StatusPill status={`documents: ${VERIFICATION_LABEL[(a as Application & { verificationStatus?: keyof typeof VERIFICATION_LABEL }).verificationStatus || 'not_started']}`} /><StatusPill status={a.status} /></span></div>
    <p className="my-2 text-[#505d71]">{a.applicant?.email} · {a.applicant?.phone} · {a.participation} · {a.city} · {a.vehicle} · {date(a.createdAt)}</p>
    <p className="mb-2 text-[13px] text-[#5b6b82]">Identity documents are reviewed in the Verification queue. Approving the documents activates the driver automatically.</p>
    <div className="my-3 flex flex-wrap gap-2">{Object.entries(a.documents || {}).map(([k, d]) => <button key={k} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#e6ecf3] px-3 text-[13px]" onClick={() => openProtectedFile(`/admin/files/${d.file}`).catch((e) => notify(e.message))}><Icon name="file" size={15} />{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</button>)}</div>
    {a.status !== 'approved' && <div className="flex flex-wrap gap-2">{a.status === 'submitted' && <button className={outline} onClick={() => decide(a, 'under_review')}>Start review</button>}<button className={button} onClick={() => decide(a, 'approved')}>Approve application</button>{a.status !== 'rejected' && <button className="min-h-11 px-3 text-red-800 underline" onClick={() => decide(a, 'rejected')}>Decline</button>}</div>}
  </div>)}</div>;
}

function AdminUsers({ role, notify, readOnly = false }: { role?: string; notify: Notify; readOnly?: boolean }) {
  const [q, setQ] = useState('');
  const { data, reload } = useLoad<{ users: User[] }>(`/admin/users?${new URLSearchParams({ ...(role && { role }), q })}`);
  const patch = async (u: User, body: object) => { try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); notify('User updated.'); void reload(); } catch (err) { notify((err as Error).message); } };
  return <div className="grid gap-4"><input className={input} placeholder="Search by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
    {!data ? <Loading /> : !data.users.length ? <Empty>No users found.</Empty> : <Table head={['Name', 'Contact', 'Role', 'Status', '']} rows={data.users.map((u) => [
      <span key="n"><b>{u.name}</b>{u.company && <span className="block text-[12px]">{u.company}</span>}</span>, <span key="c">{u.email}<span className="block text-[12px]">{u.phone}</span></span>, u.role,
      <span key="s" className="flex flex-wrap gap-1"><StatusPill status={u.disabled ? 'suspended' : u.role === 'driver' ? `${u.driverStatus}${u.online ? ' · online' : ''}` : 'active'} />{['passenger', 'driver', 'business'].includes(u.role) && <StatusPill status={VERIFICATION_LABEL[u.verificationStatus || 'not_started']} />}</span>,
      readOnly ? <span key="a" /> : <span key="a" className="flex flex-wrap gap-2">{u.role === 'driver' && u.driverStatus === 'approved' && <button className="text-[13px] underline" onClick={() => patch(u, { driverStatus: 'suspended' })}>Suspend driving</button>}{u.role === 'driver' && u.driverStatus === 'suspended' && <button className="text-[13px] underline" onClick={() => patch(u, { driverStatus: 'approved' })}>Reinstate</button>}{u.role !== 'admin' && <button className="text-[13px] underline" onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Enable account' : 'Disable account'}</button>}</span>,
    ])} />}</div>;
}

function AdminBookings() {
  const [status, setStatus] = useState('');
  const { data } = useLoad<{ bookings: Booking[] }>(`/admin/bookings${status ? `?status=${status}` : ''}`);
  return <div className="grid gap-4"><select className={`${input} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
    {!data ? <Loading /> : !data.bookings.length ? <Empty>No bookings.</Empty> : <Table head={['Ref', 'Journey', 'Passenger / driver', 'Fare / fee', 'Status']} rows={data.bookings.map((b) => [b.ref, <span key="j">{b.pickup} → {b.destination}<span className="block text-[12px]">{b.service} · {b.category} · {date(b.createdAt)}</span></span>, <span key="p">{b.passenger?.name || '—'}<span className="block text-[12px]">{b.driver?.name || 'Unassigned'}</span></span>, <span key="f">{money(b.fare)}<span className="block text-[12px]">fee {money(b.driverServiceFee)}</span></span>, <StatusPill key="s" status={b.status} />])} />}</div>;
}

function AdminTickets({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ tickets: Ticket[] }>('/admin/tickets');
  if (!data) return <Loading />;
  if (!data.tickets.length) return <Empty>No support tickets.</Empty>;
  const update = async (t: Ticket, body: object) => { try { await api(`/admin/tickets/${t.id}`, { method: 'PATCH', body }); notify('Ticket updated.'); void reload(); } catch (err) { notify((err as Error).message); } };
  return <ul className="grid gap-3">{data.tickets.map((t) => <li key={t.id} className="rounded-xl border border-[#d2dae4] p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><b>{t.ref} · {t.type}{t.priority === 'urgent' && <span className="ml-2 text-red-800">URGENT</span>}</b><StatusPill status={t.status} /></div><p className="mt-1 text-[12px] text-[#505d71]">{t.user?.name} · {t.user?.email}{t.bookingRef && ` · ${t.bookingRef}`} · {date(t.createdAt)}</p><p className="my-3">{t.message}</p>{t.replies.map((r, i) => <p key={i} className="mb-2 rounded bg-[#e6ecf3] p-2"><b>{r.by}:</b> {r.message}</p>)}
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void update(t, { reply: f.get('reply') || undefined, status: f.get('status') }); (e.currentTarget.elements.namedItem('reply') as HTMLInputElement).value = ''; }}><input name="reply" className={`${input} min-w-48 flex-1`} placeholder="Add a reply" aria-label="Reply" /><select name="status" defaultValue={t.status} className={`${input} w-40`} aria-label="Status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select><button className={button}>Update</button></form></li>)}</ul>;
}

function AdminEnquiries({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ enquiries: Enquiry[] }>('/admin/enquiries');
  if (!data) return <Loading />;
  if (!data.enquiries.length) return <Empty>No enquiries yet.</Empty>;
  return <Table head={['Ref', 'From', 'Topic', 'Message', 'Status']} rows={data.enquiries.map((e) => [e.ref, <span key="f">{e.name}<span className="block text-[12px]"><a className="underline" href={`mailto:${e.email}`}>{e.email}</a>{e.phone && ` · ${e.phone}`}{e.company && ` · ${e.company}`}</span></span>, e.topic, <span key="m" className="block max-w-xs whitespace-pre-wrap">{e.message}</span>,
    <select key="s" className="rounded border border-[#d2dae4] bg-white p-2 text-[13px]" defaultValue={e.status} aria-label="Enquiry status" onChange={async (ev) => { await api(`/admin/enquiries/${e.id}`, { method: 'PATCH', body: { status: ev.target.value } }); notify('Enquiry updated.'); void reload(); }}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select>])} />;
}

/* ---------------- Shell ---------------- */
export function Dashboard({ onBook, onTrack, onOwnership, onNotice, onSignedOut, initialTab = 'Overview' }: { onSignedOut: () => void; onBook: () => void; onTrack: (b: Booking) => void; onOwnership: () => void; onNotice: Notify; initialTab?: string }) {
  const { user, signOut, refresh } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const poll = () => api<{ unread: number }>('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
    poll(); const t = setInterval(poll, 20000); return () => clearInterval(t);
  }, [tab]);
  useEffect(() => { void refresh(); }, [tab, refresh]);
  if (!user) return null;
  const tabs = TABS[user.role] as readonly string[];
  const customer = ['passenger', 'driver', 'business'].includes(user.role);
  const openLink = (link: string) => setTab(({ verification: 'Verification', queue: 'Verification queue', application: 'Vehicle & application', wallet: 'Wallet & card' } as Record<string, string>)[link] || 'Overview');
  const overviewAction = { driver: ['View ride requests', () => setTab('Ride requests')], admin: ['Open verification queue', () => setTab('Verification queue')], compliance: ['Open verification queue', () => setTab('Verification queue')], support: ['Open tickets', () => setTab('Tickets')], finance: ['Open payouts', () => setTab('Payouts')] } as Record<string, [string, () => void]>;
  const [actionLabel, action] = overviewAction[user.role] || ['Book a journey', onBook];
  const view = () => {
    switch (tab) {
      case 'Overview': return <>{customer && <VerificationBanner status={user.verificationStatus || 'not_started'} onOpen={() => setTab('Verification')} />}<Overview onAction={action} actionLabel={actionLabel} /></>;
      case 'Verification': return <VerificationCentre notify={onNotice} onDone={() => void refresh()} />;
      case 'Verification queue': return <VerificationQueue notify={onNotice} />;
      case 'Expiring documents': return <ExpiringDocuments notify={onNotice} />;
      case 'Audit log': return <AuditLog />;
      case 'Staff': return <StaffManager notify={onNotice} />;
      case 'Wallet & card': return <WalletPanel notify={onNotice} />;
      case 'Finance': return <FinanceOverviewPanel notify={onNotice} />;
      case 'Payouts': return <Payouts notify={onNotice} />;
      case 'Cards': return <CardsAdmin notify={onNotice} />;
      case 'Ledger': return <Ledger />;
      case 'Notifications': return <Notifications onOpen={openLink} />;
      case 'My trips': case 'Company bookings': return <Trips onTrack={onTrack} onBook={onBook} />;
      case 'Trip history': return <Trips onTrack={onTrack} driver />;
      case 'Places & payment': return <ProfileForm notify={onNotice} places />;
      case 'Profile': case 'Account': return <ProfileForm notify={onNotice} />;
      case 'Support': return <Support notify={onNotice} />;
      case 'Ride requests': return <DriverRequests notify={onNotice} />;
      case 'Vehicle & application': return <DriverApplication />;
      case 'Ownership': return <div className="text-sm leading-7"><h4 className="mb-3 text-lg font-semibold">Participation, membership & equity</h4><p>As a DROP driver you may apply for the driver-owner programme. Membership and formal equity are distinct: joining or driving does not automatically grant shares. Eligibility, legal structure, voting rights and any equity allocation are set out in formal programme documents and agreements.</p><button onClick={onOwnership} className={`${outline} mt-5`}>View programme overview</button></div>;
      case 'Employees': return <Employees notify={onNotice} />;
      case 'Invoices': return <Invoices />;
      case 'Applications': return <AdminApplications notify={onNotice} />;
      case 'Drivers': return <AdminUsers role="driver" notify={onNotice} />;
      case 'Users': return <AdminUsers notify={onNotice} readOnly={user.role !== 'admin'} />;
      case 'Bookings': return <AdminBookings />;
      case 'Tickets': return <AdminTickets notify={onNotice} />;
      case 'Enquiries': return <AdminEnquiries notify={onNotice} />;
      default: return null;
    }
  };
  return <div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-grey p-3 text-sm"><span className="flex flex-wrap items-center gap-2">Signed in as <b>{user.name}</b> · {user.email}{customer && <StatusPill status={VERIFICATION_LABEL[user.verificationStatus || 'not_started']} />}</span>
      <span className="flex items-center gap-4"><button className="relative flex min-h-10 items-center gap-2 font-semibold" onClick={() => setTab('Notifications')} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Icon name="mail" size={18} />{unread > 0 && <span className="absolute -right-2 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange px-1 text-[11px] font-bold text-navy">{unread}</span>}</button><button className="flex min-h-10 items-center gap-2 font-semibold" onClick={() => { signOut(); onSignedOut(); onNotice('You have been signed out.'); }}><Icon name="logout" size={17} />Sign out</button></span></div>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[210px_minmax(0,1fr)]">
      <nav className="dash-nav flex flex-wrap content-start gap-1 md:flex-col" aria-label="Dashboard navigation">{tabs.map((t) => <button onClick={() => t === 'Book a ride' ? onBook() : setTab(t)} key={t} aria-current={tab === t ? 'page' : undefined} className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${tab === t ? 'bg-navy font-semibold text-white' : 'hover:bg-grey'}`}>{t}{t === 'Notifications' && unread > 0 && <span className="rounded-full bg-orange px-2 text-[11px] font-bold text-navy">{unread}</span>}{t === 'Verification' && user.verificationStatus !== 'verified' && <span className="h-2 w-2 rounded-full bg-orange" />}</button>)}</nav>
      <div className="min-w-0 rounded-xl border border-[#e3e8ef] bg-white p-5"><h3 className="mb-5 font-display text-xl font-extrabold">{tab}</h3><div className="step-panel" key={tab}>{view()}</div></div>
    </div>
  </div>;
}
