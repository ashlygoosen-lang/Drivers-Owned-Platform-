import { useState } from 'react';
import { api, date } from '../lib/api';
import { sideView, VEHICLE_LABEL } from '../lib/vehicleArt';
import { button, outline, input } from '../components/ui';
import { useLoad, type Notify } from './common';
import type { VehicleProfile } from './DriverVehicle';

interface Change { userId: string; name: string; email: string; current: VehicleProfile | null; currentLabel: string; pending: VehicleProfile }

const Line = ({ v }: { v: VehicleProfile }) => <span className="flex items-center gap-3"><span className="w-20 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: sideView(v.type, { width: 80 }) }} />
  <span className="text-sm"><b className="block text-navy">{v.make} {v.model} · {v.plate}</b><span className="text-[#536175]">{VEHICLE_LABEL[v.type]} · {v.year} · {v.colour} · {v.seats} seats{v.listed ? '' : ' · not in the catalogue, check it carefully'}</span></span></span>;

/** Vehicle changes from approved drivers, waiting for compliance to check the new vehicle's papers. */
export function VehicleChanges({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<{ pending: Change[] }>('/compliance/vehicles');
  const [reason, setReason] = useState<Record<string, string>>({});
  if (!data || !data.pending.length) return null;
  const decide = async (c: Change, decision: 'approve' | 'reject') => {
    try { await api(`/compliance/vehicles/${c.userId}/decision`, { body: { decision, reason: reason[c.userId] } }); notify(decision === 'approve' ? `${c.name}’s new vehicle approved.` : 'Vehicle change declined; the driver has been told why.'); void reload(); }
    catch (e) { notify((e as Error).message); }
  };
  return <section className="grid gap-3 rounded-2xl border border-[#f3c79b] bg-[#fff8f1] p-5">
    <div><h4 className="font-display text-lg font-extrabold text-navy">Vehicle changes to check ({data.pending.length})</h4>
      <p className="text-sm text-[#536175]">Approve only once the new vehicle’s registration, licence disc, roadworthy and insurance are uploaded and match. Until then the driver keeps their current vehicle.</p></div>
    {data.pending.map((c) => <article key={c.userId} className="grid gap-3 rounded-xl bg-white p-4">
      <p className="text-sm"><b>{c.name}</b> · {c.email} · requested {c.pending.submittedAt ? date(c.pending.submittedAt) : ''}</p>
      <div className="grid gap-3 md:grid-cols-2"><div><p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8a96a8]">Current</p>{c.current ? <Line v={c.current} /> : <p className="text-sm">{c.currentLabel || 'None on file'}</p>}</div>
        <div><p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#9a4300]">New</p><Line v={c.pending} /></div></div>
      <div className="flex flex-wrap items-center gap-2"><button className={`${button} min-h-10 px-4`} onClick={() => decide(c, 'approve')}>Approve vehicle</button>
        <input className={`${input} min-h-10 max-w-xs`} aria-label={`Reason for declining ${c.name}'s vehicle`} placeholder="Reason, if declining" value={reason[c.userId] || ''} onChange={(e) => setReason({ ...reason, [c.userId]: e.target.value })} />
        <button className={`${outline} min-h-10 px-4`} disabled={(reason[c.userId] || '').trim().length < 3} onClick={() => decide(c, 'reject')}>Decline</button></div>
    </article>)}
  </section>;
}
