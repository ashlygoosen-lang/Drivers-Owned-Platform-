import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, STATUS_LABEL, type BookingStatus } from '../lib/api';
import { MapCanvas, type Pin } from '../components/MapCanvas';
import { LiveMap } from '../components/LiveMap';
import { StatusPill } from '../components/ui';
import { Empty, Loading } from './common';

interface FleetDriver { id: string; name: string; vehicle: string; vehicleType?: string; rating: number | null; lat: number; lng: number; heading: number; speed: number | null; at: string; stale: boolean; state: 'available' | 'on_trip'; trip: { id: string; ref: string; status: BookingStatus; pickup: string; destination: string } | null }
interface Fleet { drivers: FleetDriver[]; requests: { id: string; ref: string; service: string; pickup: string; lat: number; lng: number; createdAt: string }[]; at: string }

const ago = (iso: string) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };

/** Staff: every online driver on one live map, plus open requests waiting for a driver. */
export function FleetMap() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => { try { setFleet(await api<Fleet>('/admin/fleet')); setError(''); } catch (err) { setError((err as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  const pins = useMemo<Pin[]>(() => fleet ? [
    ...fleet.requests.map((r) => ({ id: `r:${r.id}`, kind: 'request' as const, lat: r.lat, lng: r.lng, label: `${r.ref} waiting` })),
    ...fleet.drivers.map((d) => ({ id: `d:${d.id}`, kind: 'car' as const, lat: d.lat, lng: d.lng, heading: d.heading, muted: d.stale, vehicle: d.vehicleType, label: `${d.name} · ${d.state === 'on_trip' ? 'on a trip' : 'available'}`, onClick: () => setSelected(d.id) })),
  ] : [], [fleet]);

  if (error) return <p className="text-sm text-red-800">{error}</p>;
  if (!fleet) return <Loading />;
  const sel = fleet.drivers.find((d) => d.id === selected);
  const onTrip = fleet.drivers.filter((d) => d.state === 'on_trip').length;
  return <div className="grid gap-4">
    <div className="grid grid-cols-3 gap-3 text-center">{[['Online drivers', fleet.drivers.length], ['On a trip', onTrip], ['Waiting requests', fleet.requests.length]].map(([l, v]) => <div key={l} className="rounded-xl bg-[#eef1f5] p-3"><b className="block font-display text-2xl">{v}</b><span className="text-[12px] text-[#505d71]">{l}</span></div>)}</div>
    <MapCanvas pins={pins} lines={[]} fitKey={`fleet:${fleet.drivers.length}:${fleet.requests.length > 0}`} className="h-[420px]" caption="Online drivers and waiting requests" />
    {sel?.trip && <div className="grid gap-2 rounded-xl border border-[#d2dae4] p-4"><p className="text-sm font-semibold">{sel.name} · {sel.trip.ref} · {sel.trip.pickup} → {sel.trip.destination}</p><LiveMap bookingId={sel.trip.id} viewer="staff" className="h-72" /></div>}
    {fleet.drivers.length === 0 ? <Empty>No drivers are online with location sharing right now.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-[#d1dae5]"><th className="p-3 font-medium">Driver</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Trip</th><th className="p-3 font-medium">Last update</th></tr></thead>
      <tbody>{fleet.drivers.map((d) => <tr key={d.id} onClick={() => setSelected(d.id)} className={`table-row cursor-pointer border-b border-[#dee4ed] ${selected === d.id ? 'bg-[#fff4ec]' : ''}`}><td className="p-3"><b>{d.name}</b><span className="block text-[12px] text-[#505d71]">{d.vehicle}</span></td><td className="p-3"><StatusPill status={d.state === 'on_trip' ? 'On trip' : 'Available'} /></td><td className="p-3">{d.trip ? `${d.trip.ref} · ${STATUS_LABEL[d.trip.status]}` : '—'}</td><td className={`p-3 ${d.stale ? 'text-red-800' : ''}`}>{ago(d.at)}{d.speed != null && d.speed > 1 ? ` · ${Math.round(d.speed * 3.6)} km/h` : ''}</td></tr>)}</tbody></table></div>}
  </div>;
}
