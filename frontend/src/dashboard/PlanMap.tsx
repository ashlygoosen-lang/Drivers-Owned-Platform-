import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useComms } from '../lib/comms';
import { MapCanvas, type Pin } from '../components/MapCanvas';
import { sideView, VEHICLE_LABEL } from '../lib/vehicleArt';

interface PlanMapData { pickup: { lat: number; lng: number; label: string } | null; destination: { lat: number; lng: number; label: string } | null; vehicleType: string; vehicle: string; live: { lat: number; lng: number; heading: number; at: string; bookingId: string; status: string } | null }

/** A plan's route with its vehicle: the real vehicle type, moving live while one of the plan's trips is under way. */
export function PlanMap({ planId, scholar, onTrack }: { planId: string; scholar: boolean; onTrack?: (bookingId: string) => void }) {
  const { on } = useComms();
  const [d, setD] = useState<PlanMapData | null>(null);
  const load = useCallback(async () => { try { setD(await api<PlanMapData>(`/plans/${planId}/map`)); } catch { /* the rest of the page still works */ } }, [planId]);
  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useEffect(() => on((event, x) => {
    if (!d?.live || x?.bookingId !== d.live.bookingId) return;
    if (event === 'location' && x.driver) setD((cur) => cur && cur.live ? { ...cur, live: { ...cur.live, lat: x.driver.lat, lng: x.driver.lng, heading: x.driver.heading ?? cur.live.heading } } : cur);
    else if (event === 'trip') void load();
  }), [on, d?.live, load]);
  const pins = useMemo<Pin[]>(() => {
    if (!d) return [];
    const out: Pin[] = [];
    if (d.pickup) out.push({ id: 'pickup', kind: 'pickup', lat: d.pickup.lat, lng: d.pickup.lng, label: scholar ? 'Home pickup' : 'Pickup' });
    if (d.destination) out.push({ id: 'destination', kind: 'destination', lat: d.destination.lat, lng: d.destination.lng, label: scholar ? 'School' : 'Work' });
    if (d.live) out.push({ id: 'car', kind: 'car', lat: d.live.lat, lng: d.live.lng, heading: d.live.heading, vehicle: d.vehicleType, label: d.vehicle || VEHICLE_LABEL[d.vehicleType] });
    return out;
  }, [d, scholar]);
  if (!d || (!d.pickup && !d.destination)) return null;
  return <section className="overflow-hidden rounded-2xl border border-[#d2dae4] bg-white">
    <div className="relative">
      <MapCanvas pins={pins} lines={d.pickup && d.destination ? [{ id: 'route', path: [d.pickup, d.destination], style: 'dashed' }] : []} fitKey={`plan:${planId}:${Boolean(d.live)}`} className="h-72" caption={d.live ? 'Live position' : 'Route'} />
      {d.live && <span className="absolute left-3 top-3 rounded-full bg-[#17744a] px-3 py-1 text-[12px] font-bold text-white shadow">● Live now</span>}
    </div>
    <div className="flex flex-wrap items-center gap-4 p-4">
      <span className="w-[110px]" aria-hidden dangerouslySetInnerHTML={{ __html: sideView(d.vehicleType, { width: 110 }) }} />
      <div className="min-w-0 flex-1 text-sm"><p className="font-semibold text-navy">{VEHICLE_LABEL[d.vehicleType] || 'Vehicle'}{d.vehicle ? ` · ${d.vehicle}` : ''}</p>
        <p className="text-[#536175]">{d.live ? 'On the way now. The map shows the vehicle as it moves.' : 'The vehicle appears on the map, live, whenever a trip on this plan is under way.'}</p></div>
      {d.live && onTrack && <button className="rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => onTrack(d.live!.bookingId)}>Open live trip</button>}
    </div>
  </section>;
}
