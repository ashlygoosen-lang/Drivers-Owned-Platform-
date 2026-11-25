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
  const { data, reload } = useLoad<{ staff: User[] }>('/admin/staff');
  const [error, setError] = useState('');
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    try { await api('/admin/staff', { body: Object.fromEntries(new FormData(form)) }); form.reset(); setError(''); notify('Staff account created. Share the temporary password securely.'); void reload(); }
    catch (err) { setError((err as Error).message); }
  }
  const patch = async (u: User, body: object) => { try { await api(`/admin/staff/${u.id}`, { method: 'PATCH', body }); notify('Staff member updated.'); void reload(); } catch (err) { notify((err as Error).message); } };
  return <div className="grid gap-6">
    <form className="grid gap-4 rounded-2xl bg-grey p-5 md:grid-cols-2" onSubmit={add}>
      <Field label="Full name"><input name="name" required className={input} /></Field>
      <Field label="Work email"><input name="email" type="email" required className={input} /></Field>
      <Field label="Role"><select name="role" className={input} defaultValue="compliance"><option value="compliance">Compliance officer</option><option value="support">Support agent</option><option value="finance">Finance officer</option><option value="admin">Super Admin</option></select></Field>
      <Field label="Temporary password" hint="8+ characters with letters and numbers. They can change it under Profile."><input name="password" type="text" required minLength={8} className={input} autoComplete="off" /></Field>
      <div className="md:col-span-2"><ErrorText>{error}</ErrorText><button className={button}><Icon name="plus" size={16} />Add staff member</button></div>
    </form>
    <ul className="grid gap-2 text-[13px] text-[#5b6b82]">{Object.values(ROLE_INFO).map((r) => <li key={r}>• {r}</li>)}</ul>
    {!data ? <Loading /> : <Table head={['Name', 'Email', 'Role', 'Status', 'Two-step', '']} rows={data.staff.map((u) => [<b key="n">{u.name}</b>, u.email,
      <select key="r" className="rounded-lg border border-[#e3e8ef] bg-white p-2 text-[13px]" value={u.role} aria-label={`Role for ${u.name}`} onChange={(e) => patch(u, { role: e.target.value })}><option value="admin">Super Admin</option><option value="compliance">Compliance</option><option value="support">Support</option><option value="finance">Finance</option></select>,
      <StatusPill key="s" status={u.disabled ? 'suspended' : 'active'} />,
      <span key="m" className="text-[13px]">{u.demo ? 'Demo' : u.mfaEnabled ? 'On' : 'Set up at next sign-in'}</span>,
      <span key="d" className="flex flex-wrap gap-3"><button className="text-[13px] underline" onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>
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
