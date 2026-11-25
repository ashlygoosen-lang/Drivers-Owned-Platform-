import { useState } from 'react';
import { api } from '../lib/api';
import { sideView, VEHICLE_LABEL } from '../lib/vehicleArt';
import { button, outline, ErrorText, Spinner } from '../components/ui';
import { VehiclePicker, emptyVehicle, vehicleBody, useCatalogue, type VehicleChoice } from '../components/VehiclePicker';
import { useLoad, Loading, type Notify } from './common';

export interface VehicleProfile { type: string; make: string; model: string; year: number; plate: string; colour: string; seats: number; listed: boolean; categories: string[]; submittedAt?: string }

function VehicleCard({ v, title, pending }: { v: VehicleProfile; title: string; pending?: boolean }) {
  const c = useCatalogue();
  const label = (k: string) => c?.rules.find((r) => r.key === k)?.label || k.replace(':', ' · ');
  return <div className={`grid gap-4 rounded-2xl border p-5 sm:grid-cols-[150px_1fr] ${pending ? 'border-[#f3c79b] bg-[#fff8f1]' : 'border-[#d2dae4] bg-white'}`}>
    <span aria-hidden dangerouslySetInnerHTML={{ __html: sideView(v.type, { width: 150 }) }} />
    <div className="grid content-start gap-2 text-sm">
      <p className="text-[12px] font-bold uppercase tracking-wide text-[#5b6b82]">{title}</p>
      <p className="font-display text-xl font-extrabold text-navy">{v.make} {v.model}</p>
      <p className="text-[#536175]">{VEHICLE_LABEL[v.type]} · {v.year} · {v.colour} · <b className="text-navy">{v.plate}</b> · {v.seats} seat{v.seats === 1 ? '' : 's'}{v.listed ? '' : ' · unlisted model'}</p>
      <div className="flex flex-wrap gap-1.5">{v.categories.map((k) => <span key={k} className="rounded-full bg-[#eef2f7] px-2.5 py-1 text-[12px] font-semibold text-navy">{label(k)}</span>)}</div>
      {pending && <p className="text-[13px] text-[#9a4300]">Waiting for compliance to check the new vehicle’s papers. You keep driving your current vehicle until then.</p>}
    </div>
  </div>;
}

/** The driver's vehicle: what it can do, and a change request (checked by compliance once approved). */
export function DriverVehicle({ notify, approved }: { notify: Notify; approved: boolean }) {
  const { data, reload } = useLoad<{ vehicle: VehicleProfile | null; legacy: string | null; pending: VehicleProfile | null }>('/drivers/vehicle');
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<VehicleChoice>(emptyVehicle);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const r = await api<{ pending: VehicleProfile | null }>('/drivers/vehicle', { method: 'PUT', body: vehicleBody(v) });
      notify(r.pending ? 'Vehicle change sent to compliance. Upload the new vehicle’s registration and insurance under Verification.' : 'Vehicle saved.');
      setEditing(false); setV(emptyVehicle()); void reload();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <div className="grid gap-4">
    {data.vehicle ? <VehicleCard v={data.vehicle} title="Your vehicle" />
      : <div className="rounded-2xl border border-dashed border-[#cbd2dc] p-5 text-sm"><p className="font-semibold">{data.legacy ? `On file: ${data.legacy}` : 'No vehicle on file yet.'}</p><p className="mt-1 text-[#536175]">Choose your vehicle from the list so we can send you the trips it qualifies for and show riders the right picture on the map.</p></div>}
    {data.pending && <VehicleCard v={data.pending} title="New vehicle, waiting for approval" pending />}
    {!editing ? <button className={`${outline} justify-self-start`} onClick={() => setEditing(true)}>{data.vehicle || data.legacy ? 'Change vehicle' : 'Add your vehicle'}</button>
      : <form className="grid gap-4 rounded-2xl border border-[#d2dae4] bg-white p-5" onSubmit={save}>
        <VehiclePicker value={v} onChange={setV} />
        {approved && <p className="text-[13px] text-[#536175]">Because you’re already approved, compliance checks a new vehicle before it’s used for trips.</p>}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3"><button className={button} disabled={busy || !v.type}>{busy && <Spinner />}{approved ? 'Send for approval' : 'Save vehicle'}</button><button type="button" className={outline} onClick={() => setEditing(false)}>Cancel</button></div>
      </form>}
  </div>;
}
