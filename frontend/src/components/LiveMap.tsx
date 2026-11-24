import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useComms } from '../lib/comms';
import { decodePolyline, fmtDist, fmtEta, type LatLng } from '../lib/maps';
import { MapCanvas, type Line, type Pin } from './MapCanvas';
import { Icon } from './ui';

interface Fix { lat: number; lng: number; heading: number; speed: number | null; accuracy: number | null; at: string; source?: string; stale?: boolean; name?: string; vehicle?: string }
interface Eta { durationSec: number; distanceM: number; estimated: boolean }
export interface Tracking {
  bookingId: string; ref: string; status: string; stage: 'to_pickup' | 'to_destination' | string;
  pickup: (LatLng & { label: string }) | null; destination: (LatLng & { label: string }) | null;
  driver: Fix | null; passenger: (LatLng & { accuracy: number | null; at: string }) | null;
  eta: Eta | null; route: { polyline: string; version: number } | null; trail: [number, number][];
}

/** Live map of one trip: the car moving in real time, the route, and the ETA. */
export function LiveMap({ bookingId, viewer, className = 'h-80' }: { bookingId: string; viewer: 'passenger' | 'driver' | 'staff'; className?: string }) {
  const { on, live } = useComms();
  const [t, setT] = useState<Tracking | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setT(await api<Tracking>(`/bookings/${bookingId}/tracking`)); setError(''); } catch (err) { setError((err as Error).message); }
  }, [bookingId]);
  useEffect(() => { void load(); const timer = setInterval(load, 30_000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (live) void load(); }, [live, load]);
  useEffect(() => on((event, d) => {
    if (d?.bookingId !== bookingId) return;
    if (event === 'location') setT((cur) => cur && { ...cur, driver: { ...cur.driver, ...d.driver, stale: false }, eta: d.eta, stage: d.stage, route: d.route || (d.stage === cur.stage ? cur.route : null) });
    else if (event === 'passenger-location') setT((cur) => cur && { ...cur, passenger: d.passenger });
    else if (event === 'trip') void load();
  }), [on, bookingId, load]);

  const target = t && (t.stage === 'to_pickup' ? t.pickup : t.stage === 'to_destination' ? t.destination : null);
  const routePath = useMemo(() => (t?.route?.polyline ? decodePolyline(t.route.polyline) : null), [t?.route?.polyline]);

  const pins = useMemo<Pin[]>(() => {
    if (!t) return [];
    const out: Pin[] = [];
    if (t.pickup && t.stage !== 'to_destination') out.push({ id: 'pickup', kind: 'pickup', ...t.pickup, label: `Pickup · ${t.pickup.label}` });
    if (t.destination) out.push({ id: 'destination', kind: 'destination', ...t.destination, label: `Destination · ${t.destination.label}` });
    if (t.passenger) out.push({ id: 'passenger', kind: 'passenger', lat: t.passenger.lat, lng: t.passenger.lng, label: 'Passenger’s location' });
    if (t.driver) out.push({ id: 'car', kind: 'car', lat: t.driver.lat, lng: t.driver.lng, heading: t.driver.heading, muted: t.driver.stale, label: t.driver.vehicle || 'Your DROP car' });
    return out;
  }, [t]);

  const lines = useMemo<Line[]>(() => {
    if (!t) return [];
    const out: Line[] = [];
    if (t.trail.length > 1) out.push({ id: 'trail', style: 'trail', path: t.trail.map(([lat, lng]) => ({ lat, lng })) });
    if (t.driver && target) out.push(routePath ? { id: 'route', style: 'route', path: routePath } : { id: 'route', style: 'dashed', path: [t.driver, target] });
    else if (!t.driver && t.pickup && t.destination && !t.trail.length) out.push({ id: 'plan', style: 'dashed', path: [t.pickup, t.destination] });
    return out;
  }, [t, target, routePath]);

  if (error) return <div className={`grid place-items-center rounded-xl bg-[#e6ebf1] p-6 text-sm text-[#505d71] ${className}`}>{error}</div>;
  const arrived = t?.stage === 'to_pickup' && t.eta && t.eta.distanceM < 120;
  const who = viewer === 'driver' ? 'You are' : `${t?.driver?.name || 'Your driver'} is`;
  const headline = !t ? '' : !t.driver
    ? (['completed', 'cancelled'].includes(t.status) ? (t.trail.length ? 'Route driven on this trip' : 'Trip map') : t.status === 'requested' ? 'Finding a driver near you…' : 'Waiting for the driver’s location…')
    : arrived ? (viewer === 'driver' ? 'You’ve arrived at the pickup' : `${t.driver.name || 'Your driver'} has arrived`)
      : t.eta ? `${who} ${fmtEta(t.eta.durationSec)} ${t.stage === 'to_pickup' ? 'from the pickup' : 'from the destination'}` : 'Live location';

  return <div className="grid gap-2">
    <div className="relative">
      <MapCanvas pins={pins} lines={lines} fitKey={`${t?.stage}:${Boolean(t?.driver)}`} className={className} caption="Live positions · add a Google Maps key for street maps" />
      {t && <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold shadow-sm">{t.driver && !t.driver.stale ? <><span className="live-dot mr-2 inline-block h-1.5 w-1.5 rounded-full bg-green-700" />Live</> : t.driver?.stale ? 'Last known position' : t.ref}</span>
      </div>}
    </div>
    {t && <div className="flex items-center gap-3 rounded-xl bg-navy px-4 py-3 text-white" aria-live="polite">
      <Icon name={arrived ? 'pin' : 'car'} size={20} className="shrink-0 text-orange" />
      <p className="min-w-0 flex-1 text-sm"><b className="block">{headline}</b>{t.driver && t.eta && !arrived && <span className="text-[12px] text-[#c9d3e3]">{fmtDist(t.eta.distanceM)} away{t.eta.estimated ? ' · estimated' : ' · live traffic'}{t.driver.speed != null && t.driver.speed > 1 ? ` · ${Math.round(t.driver.speed * 3.6)} km/h` : ''}</span>}{t.driver?.stale && <span className="block text-[12px] text-[#ffb27a]">Location not updated for a few minutes. The driver may be in a poor signal area.</span>}</p>
    </div>}
  </div>;
}

/** Driver: send GPS fixes while online (the phone must stay on this page). Demo accounts are simulated. */
export function useDriverGps(enabled: boolean, demo: boolean) {
  const [state, setState] = useState<{ status: 'off' | 'waiting' | 'on' | 'denied' | 'unsupported' | 'demo'; accuracy?: number }>({ status: 'off' });
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) { setState({ status: 'off' }); return; }
    if (demo) { setState({ status: 'demo' }); return; }
    if (!('geolocation' in navigator)) { setState({ status: 'unsupported' }); return; }
    setState({ status: 'waiting' });
    const id = navigator.geolocation.watchPosition((pos) => {
      setState({ status: 'on', accuracy: Math.round(pos.coords.accuracy) });
      if (Date.now() - last.current < 3000) return;
      last.current = Date.now();
      void api('/drivers/location', { body: { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading ?? undefined, speed: pos.coords.speed ?? undefined, accuracy: pos.coords.accuracy } }).catch(() => {});
    }, (err) => setState({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'waiting' }), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 });
    // Keep the screen awake on phones that support it, so tracking doesn't stop.
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { navigator.geolocation.clearWatch(id); void lock?.release(); };
  }, [enabled, demo]);
  return state;
}

export function GpsStatus({ state }: { state: ReturnType<typeof useDriverGps> }) {
  const text = {
    off: 'Location sharing starts when you go online.',
    waiting: 'Finding your GPS position…',
    on: `Sharing your live location with DROP${state.accuracy ? ` · accurate to ${state.accuracy} m` : ''}. Keep this page open while you drive.`,
    denied: 'Location access is blocked. Allow location for this site in your browser settings so passengers can see you arriving.',
    unsupported: 'This browser cannot share location. Use Chrome or Safari on your phone.',
    demo: 'Demo account: your car’s position is simulated along Cape Town roads.',
  }[state.status];
  return <p className={`flex items-center gap-2 text-[12px] ${state.status === 'denied' ? 'text-red-800' : 'text-[#4d5b71]'}`}><Icon name="pin" size={15} className={state.status === 'on' || state.status === 'demo' ? 'text-[#17744a]' : ''} />{text}</p>;
}

/** Passenger: optionally share where they are with the driver until pickup. */
export function SharePickupLocation({ bookingId, status }: { bookingId: string; status: string }) {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const allowed = ['accepted', 'arriving'].includes(status);
  useEffect(() => {
    if (!on || !allowed) return;
    if (!('geolocation' in navigator)) { setMsg('This browser cannot share location.'); setOn(false); return; }
    let last = 0;
    const id = navigator.geolocation.watchPosition((pos) => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      void api(`/bookings/${bookingId}/my-location`, { body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }).then(() => setMsg('Your driver can see where you are until you’re picked up.')).catch((err) => setMsg((err as Error).message));
    }, () => { setMsg('Location access is blocked in your browser.'); setOn(false); }, { enableHighAccuracy: true, maximumAge: 5000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [on, allowed, bookingId]);
  useEffect(() => { if (!allowed) setOn(false); }, [allowed]);
  if (!allowed) return null;
  return <div className="grid gap-1">
    <button onClick={() => { if (on) void api(`/bookings/${bookingId}/my-location`, { body: { stop: true } }).catch(() => {}); setOn(!on); setMsg(''); }} aria-pressed={on} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold ${on ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6]' : 'border-[#cbd0d7] hover:bg-[#e9ecf1]'}`}><Icon name="pin" size={17} />{on ? 'Sharing my location · stop' : 'Share my location with my driver'}</button>
    {msg && <p className="text-[12px] text-[#4d5b71]">{msg}</p>}
  </div>;
}
