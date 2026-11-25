/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import { topView } from '../lib/vehicleArt';
import { loadGoogleMaps, mapsConfig, onMapsAuthFailure, mapsAuthFailed, type LatLng, type MapsConfig } from '../lib/maps';

export interface Pin { id: string; kind: 'car' | 'pickup' | 'destination' | 'passenger' | 'request'; lat: number; lng: number; heading?: number; label?: string; muted?: boolean; vehicle?: string; onClick?: () => void }
export interface Line { id: string; path: LatLng[]; style: 'route' | 'dashed' | 'trail' }

// Each car is drawn as its real vehicle type (hatchback, minibus, bakkie, motorbike…), rotated to its heading.

function pinElement(p: Pin) {
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.title = p.label || '';
  el.setAttribute('aria-label', p.label || p.kind);
  if (p.kind === 'car') {
    el.innerHTML = `<div style="transition:transform .9s linear;transform:rotate(${p.heading || 0}deg);filter:drop-shadow(0 4px 6px #071b3a55)${p.muted ? ';opacity:.45' : ''}">${topView(p.vehicle || 'sedan')}</div>`;
  } else if (p.kind === 'pickup') {
    el.innerHTML = '<div style="width:22px;height:22px;border-radius:50%;background:#fff;border:6px solid #071b3a;box-shadow:0 2px 6px #0004"></div>';
  } else if (p.kind === 'destination') {
    el.innerHTML = '<svg width="34" height="44" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19Z" fill="#ff6b00" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#071b3a"/></svg>';
  } else if (p.kind === 'passenger') {
    el.innerHTML = '<div style="width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 8px #1a73e833"></div>';
  } else {
    el.innerHTML = '<div style="width:14px;height:14px;border-radius:50%;background:#ff6b00;border:3px solid #fff;box-shadow:0 1px 4px #0005"></div>';
  }
  if (p.onClick) { el.style.cursor = 'pointer'; el.addEventListener('click', p.onClick); }
  return el;
}

/** Google map when a browser key is configured; otherwise a live position plot with the same pins. */
export function MapCanvas({ pins, lines, fitKey, className = '', caption }: { pins: Pin[]; lines: Line[]; fitKey: string; className?: string; caption?: string }) {
  const [cfg, setCfg] = useState<MapsConfig | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void mapsConfig().then(setCfg); return onMapsAuthFailure(() => setFailed(true)); }, []);
  if (!cfg) return <div className={`rounded-xl bg-[#e6ebf1] ${className}`} />;
  if (cfg.provider === 'google' && cfg.browserKey && !failed && !mapsAuthFailed()) return <GoogleMap cfg={cfg} pins={pins} lines={lines} fitKey={fitKey} className={className} onFail={() => setFailed(true)} />;
  return <PlotMap pins={pins} lines={lines} className={className} caption={caption || (failed ? 'Google Maps is unavailable. Showing live positions.' : 'Live positions')} />;
}

function GoogleMap({ cfg, pins, lines, fitKey, className, onFail }: { cfg: MapsConfig; pins: Pin[]; lines: Line[]; fitKey: string; className: string; onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<any>(null);
  const map = useRef<any>(null);
  const markers = useRef(new Map<string, { m: any; kind: string; anim?: number }>());
  const polylines = useRef(new Map<string, any>());
  const [ready, setReady] = useState(false);
  const fitted = useRef('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const maps = await loadGoogleMaps(cfg.browserKey!);
        const [{ Map }, marker] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')]);
        if (dead || !el.current) return;
        g.current = { maps, AdvancedMarkerElement: marker.AdvancedMarkerElement };
        map.current = new Map(el.current, { center: cfg.center, zoom: 13, mapId: cfg.mapId, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: 'greedy', clickableIcons: false });
        setReady(true);
      } catch { if (!dead) onFail(); }
    })();
    return () => { dead = true; };
  }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Markers: create, move (cars glide between fixes), remove.
  useEffect(() => {
    if (!ready) return;
    const seen = new Set<string>();
    for (const p of pins) {
      seen.add(p.id);
      const cur = markers.current.get(p.id);
      if (!cur || cur.kind !== p.kind) {
        cur?.m && (cur.m.map = null);
        const m = new g.current.AdvancedMarkerElement({ map: map.current, position: { lat: p.lat, lng: p.lng }, content: pinElement(p), title: p.label || '', zIndex: p.kind === 'car' ? 10 : 5 });
        markers.current.set(p.id, { m, kind: p.kind });
        continue;
      }
      const from = cur.m.position; const fromLat = typeof from.lat === 'function' ? from.lat() : from.lat; const fromLng = typeof from.lng === 'function' ? from.lng() : from.lng;
      if (p.kind === 'car') {
        const rot = cur.m.content?.firstElementChild as HTMLElement | null;
        if (rot) { rot.style.transform = `rotate(${p.heading || 0}deg)`; rot.style.opacity = p.muted ? '.45' : '1'; }
        cancelAnimationFrame(cur.anim || 0);
        const start = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - start) / 1000);
          cur.m.position = { lat: fromLat + (p.lat - fromLat) * k, lng: fromLng + (p.lng - fromLng) * k };
          if (k < 1) cur.anim = requestAnimationFrame(step);
        };
        cur.anim = requestAnimationFrame(step);
      } else if (fromLat !== p.lat || fromLng !== p.lng) cur.m.position = { lat: p.lat, lng: p.lng };
    }
    for (const [id, cur] of markers.current) if (!seen.has(id)) { cur.m.map = null; markers.current.delete(id); }
  }, [ready, pins]);

  useEffect(() => {
    if (!ready) return;
    const seen = new Set<string>();
    for (const l of lines) {
      seen.add(l.id);
      const opts = l.style === 'route'
        ? { strokeColor: '#071b3a', strokeOpacity: 0.9, strokeWeight: 6, icons: [] }
        : l.style === 'trail'
          ? { strokeColor: '#ff6b00', strokeOpacity: 0.9, strokeWeight: 5, icons: [] }
          : { strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#071b3a', scale: 3 }, offset: '0', repeat: '14px' }] };
      const existing = polylines.current.get(l.id);
      if (existing) { existing.setOptions(opts); existing.setPath(l.path); }
      else polylines.current.set(l.id, new g.current.maps.Polyline({ map: map.current, path: l.path, ...opts }));
    }
    for (const [id, pl] of polylines.current) if (!seen.has(id)) { pl.setMap(null); polylines.current.delete(id); }
  }, [ready, lines]);

  // Fit the view when the trip stage changes (not on every fix, so people can pan freely).
  useEffect(() => {
    if (!ready || !pins.length || fitted.current === fitKey) return;
    fitted.current = fitKey;
    fit();
  }, [ready, fitKey, pins.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function fit() {
    if (!map.current || !pins.length) return;
    if (pins.length === 1) { map.current.setCenter({ lat: pins[0].lat, lng: pins[0].lng }); map.current.setZoom(15); return; }
    const b = new g.current.maps.LatLngBounds();
    pins.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
    lines.forEach((l) => l.path.forEach((pt) => b.extend(pt)));
    map.current.fitBounds(b, 60);
  }

  return <div className={`relative overflow-hidden rounded-xl bg-[#e6ebf1] ${className}`}>
    <div ref={el} className="absolute inset-0" />
    {ready && pins.length > 0 && <button onClick={fit} className="absolute right-3 top-3 rounded-full bg-white px-3 py-2 text-[12px] font-semibold shadow" aria-label="Recentre the map">Recentre</button>}
  </div>;
}

/** No Google key: plot real coordinates on a simple projected grid so tracking still works. */
function PlotMap({ pins, lines, className, caption }: { pins: Pin[]; lines: Line[]; className: string; caption: string }) {
  const W = 600, H = 400, pad = 50;
  const proj = useMemo(() => {
    const pts = [...pins, ...lines.flatMap((l) => l.path)];
    if (!pts.length) return null;
    let [minLat, maxLat, minLng, maxLng] = [Math.min(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lat)), Math.min(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lng))];
    const span = Math.max(maxLat - minLat, (maxLng - minLng) * 0.83, 0.01);
    const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
    [minLat, maxLat, minLng, maxLng] = [cLat - span / 2, cLat + span / 2, cLng - span / 1.66, cLng + span / 1.66];
    return (p: LatLng) => [pad + ((p.lng - minLng) / (maxLng - minLng)) * (W - 2 * pad), pad + ((maxLat - p.lat) / (maxLat - minLat)) * (H - 2 * pad)] as const;
  }, [pins, lines]);
  return <div className={`relative overflow-hidden rounded-xl bg-[#e9eef4] ${className}`}>
    <svg className="absolute h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }} role="img" aria-label={caption}>
      {Array.from({ length: 76 }, (_, i) => <path key={`v${i}`} d={`M${(i - 30) * 40} -1200v3000`} stroke="#fff" strokeWidth={i % 4 ? 2 : 7} />)}
      {Array.from({ length: 70 }, (_, i) => <path key={`h${i}`} d={`M-1200 ${(i - 30) * 40}h3000`} stroke="#fff" strokeWidth={i % 4 ? 2 : 7} />)}
      {proj && lines.map((l) => <polyline key={l.id} points={l.path.map((p) => proj(p).join(',')).join(' ')} fill="none" stroke={l.style === 'trail' ? '#ff6b00' : '#071b3a'} strokeWidth={l.style === 'route' ? 5 : 4} strokeDasharray={l.style === 'dashed' ? '8 8' : undefined} strokeLinecap="round" strokeLinejoin="round" />)}
      {proj && pins.map((p) => {
        const [x, y] = proj(p);
        return <g key={p.id} style={{ transform: `translate(${x}px, ${y}px)`, transition: p.kind === 'car' ? 'transform 1s linear' : undefined }} opacity={p.muted ? 0.45 : 1} onClick={p.onClick} className={p.onClick ? 'cursor-pointer' : undefined}>
          {p.kind === 'car' && <g transform={`rotate(${p.heading || 0})`} dangerouslySetInnerHTML={{ __html: topView(p.vehicle || 'sedan', { size: 40, centered: true }) }} />}
          {p.kind === 'pickup' && <circle r="10" fill="#fff" stroke="#071b3a" strokeWidth="6" />}
          {p.kind === 'destination' && <><circle r="12" fill="#ff6b00" stroke="#fff" strokeWidth="3" /><circle r="4" fill="#071b3a" /></>}
          {p.kind === 'passenger' && <><circle r="16" fill="#1a73e833" /><circle r="8" fill="#1a73e8" stroke="#fff" strokeWidth="3" /></>}
          {p.kind === 'request' && <circle r="7" fill="#ff6b00" stroke="#fff" strokeWidth="3" />}
          {p.label && p.kind !== 'car' && <text y={p.kind === 'request' ? -14 : -20} textAnchor="middle" fontSize="12" fontWeight="600" fill="#071b3a" stroke="#fff" strokeWidth="3" paintOrder="stroke">{p.label.length > 26 ? `${p.label.slice(0, 25)}…` : p.label}</text>}
        </g>;
      })}
    </svg>
    <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-[#4c5768]">{caption}</span>
  </div>;
}
