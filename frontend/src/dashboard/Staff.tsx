import { useState } from 'react';
import { api, date, type Notice, type User } from '../lib/api';
import { button, input, Field, ErrorText, Icon, StatusPill } from '../components/ui';
import { Empty, Loading, Table, useLoad, type Notify } from './common';

const ROLE_INFO: Record<string, string> = {
  admin: 'Super Admin: everything, including staff and settings.',
  compliance: 'Compliance officer: reviews identity documents and verifies accounts.',
  support: 'Support agent: handles tickets and enquiries, and can look up users and trips (no ID documents).',
  finance: 'Finance officer: pool account, driver payouts, cards and the ledger (no ID documents).',
};

export function StaffManager({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ staff: (User & { invitePending?: boolean })[] }>('/admin/staff');
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const shown = (name: string, invite: { sent: boolean; url: string | null }) => {
    if (invite.sent) { setLink(null); notify(`Invitation emailed to ${name}. The link works once and expires in 72 hours.`); }
    else if (invite.url) { setLink({ name, url: invite.url }); notify('Email isn’t set up yet, so copy the invitation link below and send it to them privately.'); }
  };
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try { const r = await api<{ invite: { sent: boolean; url: string | null } }>('/admin/staff', { body }); form.reset(); setError(''); shown(body.name, r.invite); void reload(); }
    catch (err) { setError((err as Error).message); }
  }
  const resend = async (u: User) => { try { const r = await api<{ invite: { sent: boolean; url: string | null } }>(`/admin/staff/${u.id}/invite`, { body: {} }); shown(u.name, r.invite); } catch (err) { notify((err as Error).message); } };
  const patch = async (u: User, body: object) => { try { await api(`/admin/staff/${u.id}`, { method: 'PATCH', body }); notify('Staff member updated.'); void reload(); } catch (err) { notify((err as Error).message); } };
  return <div className="grid gap-6">
    <form className="grid gap-4 rounded-2xl bg-grey p-5 md:grid-cols-2" onSubmit={add}>
      <Field label="Full name"><input name="name" required className={input} /></Field>
      <Field label="Work email"><input name="email" type="email" required className={input} /></Field>
      <Field label="Role"><select name="role" className={input} defaultValue="compliance"><option value="compliance">Compliance officer</option><option value="support">Support agent</option><option value="finance">Finance officer</option><option value="admin">Super Admin</option></select></Field>
      <p className="self-end text-[13px] leading-5 text-[#5b6b82]">We email them a single-use link to choose their own password (valid 72 hours). They then set up two-step sign-in. You never see or choose their password.</p>
      <div className="md:col-span-2"><ErrorText>{error}</ErrorText><button className={button}><Icon name="mail" size={16} />Send invitation</button></div>
    </form>
    {link && <div className="grid gap-2 rounded-2xl border border-[#f3c79b] bg-[#fff8f1] p-4 text-sm" role="status">
      <p><b>Invitation link for {link.name}</b>. Send it privately (not in a group chat). It works once and expires in 72 hours.</p>
      <div className="flex flex-wrap gap-2"><input readOnly aria-label="Invitation link" value={link.url} className={`${input} min-w-0 flex-1 font-mono text-[12px]`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="rounded-xl border border-[#cbd0d7] bg-white px-4 font-semibold" onClick={() => { void navigator.clipboard?.writeText(link.url); notify('Link copied.'); }}>Copy</button>
        <button type="button" className="px-2 underline" onClick={() => setLink(null)}>Done</button></div>
    </div>}
    <ul className="grid gap-2 text-[13px] text-[#5b6b82]">{Object.values(ROLE_INFO).map((r) => <li key={r}>• {r}</li>)}</ul>
    {!data ? <Loading /> : <Table head={['Name', 'Email', 'Role', 'Status', 'Two-step', '']} rows={data.staff.map((u) => [<b key="n">{u.name}</b>, u.email,
      <select key="r" className="rounded-lg border border-[#e3e8ef] bg-white p-2 text-[13px]" value={u.role} aria-label={`Role for ${u.name}`} onChange={(e) => patch(u, { role: e.target.value })}><option value="admin">Super Admin</option><option value="compliance">Compliance</option><option value="support">Support</option><option value="finance">Finance</option></select>,
      <StatusPill key="s" status={u.disabled ? 'suspended' : u.invitePending ? 'invited' : 'active'} />,
      <span key="m" className="text-[13px]">{u.demo ? 'Demo' : u.mfaEnabled ? 'On' : 'Set up at next sign-in'}</span>,
      <span key="d" className="flex flex-wrap gap-3">{u.invitePending && <button className="text-[13px] underline" onClick={() => resend(u)}>Resend invitation</button>}<button className="text-[13px] underline" onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>
        <button className="text-[13px] underline" onClick={() => patch(u, { endSessions: true })}>Sign out</button>
        {u.mfaEnabled && <button className="text-[13px] underline" onClick={() => { if (confirm(`Reset two-step sign-in for ${u.name}? They will set it up again at their next sign-in.`)) void patch(u, { resetMfa: true }); }}>Reset two-step</button>}</span>])} />}
  </div>;
}

export function Notifications({ onOpen }: { onOpen: (link: string) => void }) {
  const { data, reload } = useLoad<{ notifications: Notice[]; unread: number }>('/notifications');
  if (!data) return <Loading />;
  if (!data.notifications.length) return <Empty>You’re all caught up.</Empty>;
  return <div className="grid gap-3">
    {data.unread > 0 && <button className="w-fit text-sm font-semibold underline" onClick={async () => { await api('/notifications/read', { body: {} }); void reload(); }}>Mark all as read</button>}
    <ul className="grid gap-2">{data.notifications.map((n) => <li key={n.id}><button onClick={() => onOpen(n.link)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm ${n.read ? 'border-[#e3e8ef]' : 'border-orange/50 bg-orange/5'}`}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-[#cbd3de]' : 'bg-orange'}`} /><span className="flex-1"><b>{n.title}</b><span className="block text-[#5b6b82]">{n.body}</span></span><span className="shrink-0 text-[12px] text-[#8a97a8]">{date(n.createdAt)}</span></button></li>)}</ul>
  </div>;
}

interface SecurityEvent { id: string; type: string; severity: 'info' | 'medium' | 'high'; detail: Record<string, string>; at: string }
interface SecurityData { audit: { ok: boolean; entries?: number; brokenAt?: number; legacy: number }; events: SecurityEvent[]; maintenance: { on: boolean; message?: string; by?: string; at?: string } }

/** Admin: audit-log integrity, security events and the maintenance switch (incident response). */
export function SecurityPanel({ notify }: { notify: Notify }) {
  const { data, error, reload } = useLoad<SecurityData>('/admin/security');
  const [msg, setMsg] = useState('');
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const toggle = async (on: boolean) => {
    if (on && !confirm('Put DROP into maintenance mode? Customers will see a maintenance message until you turn it off. Staff can still work.')) return;
    try { await api('/admin/maintenance', { body: { on, message: msg } }); notify(on ? 'Maintenance mode is on.' : 'DROP is open again.'); void reload(); } catch (err) { notify((err as Error).message); }
  };
  const tone = { high: 'bg-red-100 text-red-900', medium: 'bg-orange/15 text-[#8a3a00]', info: 'bg-[#eef1f5] text-[#4d5b71]' };
  return <div className="grid gap-5">
    <div className="grid gap-3 md:grid-cols-2">
      <div className={`rounded-xl p-4 ${data.audit.ok ? 'bg-[#e7f6ee]' : 'bg-red-100'}`}><b className="flex items-center gap-2"><Icon name={data.audit.ok ? 'check' : 'shield'} size={18} />Audit log {data.audit.ok ? 'intact' : 'TAMPERED'}</b><p className="mt-1 text-[13px]">{data.audit.ok ? `${data.audit.entries} entries, hash chain verified.` : `The chain breaks at entry ${data.audit.brokenAt}. Follow the incident response plan.`}</p></div>
      <div className={`grid gap-2 rounded-xl p-4 ${data.maintenance.on ? 'bg-orange/15' : 'bg-[#eef1f5]'}`}>
        <b>Maintenance mode: {data.maintenance.on ? 'ON' : 'off'}</b>
        {data.maintenance.on ? <><p className="text-[13px]">Turned on by {data.maintenance.by}. Customers see: “{data.maintenance.message || 'DROP is down for a short maintenance break.'}”</p><button className={button} onClick={() => toggle(false)}>Reopen DROP</button></>
          : <div className="flex gap-2"><input className={input} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message for customers (optional)" maxLength={200} aria-label="Maintenance message" /><button className="shrink-0 rounded-xl border border-[#cbd0d7] px-4 text-sm font-semibold" onClick={() => toggle(true)}>Turn on</button></div>}
      </div>
    </div>
    <h4 className="font-semibold">Recent security events</h4>
    {data.events.length === 0 ? <Empty>No security events yet.</Empty> : <ul className="grid gap-2">{data.events.map((e) => <li key={e.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-[#e3e8ef] p-3 text-sm"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${tone[e.severity]}`}>{e.severity}</span><b className="min-w-0 flex-1">{e.type.replace(/_/g, ' ')}<span className="block font-normal text-[12px] text-[#5b6b82]">{Object.entries(e.detail).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span></b><span className="text-[12px] text-[#8a97a8]">{date(e.at)}</span></li>)}</ul>}
  </div>;
}
