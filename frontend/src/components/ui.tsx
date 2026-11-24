import { useState } from 'react';

export type IconName = 'arrow' | 'car' | 'box' | 'star' | 'shield' | 'pin' | 'clock' | 'check' | 'people' | 'wallet' | 'menu' | 'close' | 'phone' | 'user' | 'logout' | 'upload' | 'mail' | 'building' | 'file' | 'plus' | 'trash' | 'up' | 'spark';

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    car: <><path d="m5 7 2-4h10l2 4 2 3v8h-3v-3H6v3H3v-8l2-3Zm0 0h14M3 11h18" /><path d="M6 12v1m12-1v1" /></>,
    box: <path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9v10M3 8l9 4 9-4M8 5l9 5" />,
    star: <path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" />,
    shield: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" /><path d="m8 12 3 3 5-6" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-4a6 6 0 0 1 12 0v4m1-16a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 5" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 8V5l14-3v3m4 7h-6v4h6" /></>,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    close: <path d="m5 5 14 14M5 19 19 5" />,
    phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />,
    upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    building: <path d="M4 21V5l8-3v19M12 8h8v13M4 21h17M8 7v1m0 3v1m0 3v1m8-4v1m0 3v1" />,
    file: <path d="M6 2h8l5 5v15H6V2Zm8 0v5h5M9 13h7M9 17h7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />,
    up: <path d="M12 19V5m-6 6 6-6 6 6" />,
    spark: <path d="M12 2v6m0 8v6M2 12h6m8 0h6M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3" />,
  };
  return <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export const button = 'motion-button inline-flex min-h-11 items-center justify-center gap-3 rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_#071b3a26] hover:bg-navy-2 disabled:cursor-not-allowed disabled:opacity-60';
export const outline = 'motion-button inline-flex min-h-11 items-center justify-center gap-3 rounded-xl border border-[#cbd0d7] px-6 py-3 text-sm font-semibold hover:bg-[#e9ecf1] disabled:opacity-60';
export const limeButton = 'motion-button gold-button inline-flex min-h-12 items-center justify-center gap-3 rounded-xl px-7 text-sm font-bold text-navy';
export const darkOutline = 'motion-button inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-white/25 px-7 text-sm font-semibold text-white hover:bg-white/10';
export const input = 'min-h-12 w-full rounded-xl border border-[#d9dce1] bg-[#f4f6f8] px-4 text-sm outline-none focus:border-forest';

export function BrandImage({ src, alt, className = '', priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <div role="img" aria-label={alt} className={`${className} flex items-center justify-center bg-[#d6dee8] text-forest`}><span className="grid justify-items-center gap-3"><Icon name="car" size={40} /><span className="text-sm">DROP · Image unavailable</span></span></div>
    : <img src={src} alt={alt} width={1536} height={864} decoding="async" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} onError={() => setFailed(true)} className={className} />;
}

/** Official DROP logos (vector files in /public/brand). */
export function Logo({ light = false, compact = false, tagline = false, className = '' }: { light?: boolean; compact?: boolean; tagline?: boolean; className?: string }) {
  const theme = light ? 'dark' : 'light';
  const file = compact ? `drop-wordmark-${theme}` : tagline ? `drop-logo-horizontal-tagline-${theme}` : `drop-logo-horizontal-${theme}`;
  return <img src={`/brand/${file}.svg`} alt="DROP" width={compact ? 120 : 160} height={compact ? 40 : 48} className={`block h-10 w-auto ${className}`} decoding="async" />;
}

export function BrandSymbol({ className = '', theme = 'light' }: { className?: string; theme?: 'light' | 'dark' | 'mono-navy' | 'mono-white' }) {
  return <img src={`/brand/drop-symbol-${theme}.svg`} alt="" aria-hidden="true" className={className} />;
}

export function Label({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return <div className={`mb-4 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[1.6px] ${light ? 'text-orange' : 'text-orange-dark'}`}><span className="h-2 w-2 rotate-45 rounded-[2px] bg-orange" />{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="grid gap-2 text-sm">{label}{children}{hint && <span className="text-[12px] text-[#5a6677]">{hint}</span>}</label>;
}

export function ErrorText({ children }: { children?: string }) {
  return children ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{children}</p> : null;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function StatusPill({ status }: { status: string }) {
  const tone = /complete|approved|resolved|active|verified|passed|closed|issued|received|online/i.test(status) ? 'bg-[#e8f5ee] text-[#17744a]'
    : /cancel|reject|declin|suspend|expired|action required|attention/i.test(status) ? 'bg-[#fdecec] text-[#b42828]'
    : /not started|not scheduled/i.test(status) ? 'bg-[#eef1f5] text-[#5b6b82]'
    : 'bg-[#fff1e6] text-[#b34a00]';
  return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold capitalize ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

export function MapView({ active = false }: { active?: boolean }) {
  const [zoom, setZoom] = useState(1);
  return <div className="relative h-full min-h-72 overflow-hidden rounded-xl bg-[#e6ebf1]">
    <svg className="absolute h-full w-full" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Stylised Cape Town trip map">
      <g className="motion-map" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
        <path d="M0 0h170l-45 70-40 55L0 150Z" fill="#ced4de" /><path d="m440 260 160-70v210H400Z" fill="#cdd8e6" />
        {Array.from({ length: 13 }, (_, i) => <path key={`h${i}`} d={`M-50 ${i * 40} 650 ${i * 40 - 70}`} stroke="#fff" strokeWidth="10" />)}
        {Array.from({ length: 15 }, (_, i) => <path key={i} d={`m${i * 52} -50 -100 550`} stroke="#fff" strokeWidth="8" />)}
        <path d="M-20 270 170 220 290 250 440 120 630 95" fill="none" stroke="#c9d0db" strokeWidth="19" /><path d="M-20 270 170 220 290 250 440 120 630 95" fill="none" stroke="white" strokeWidth="12" />
        <path className="motion-route" pathLength="1" d="m200 282 25-108 116-14 32-90" fill="none" stroke="#0c2e65" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="200" cy="282" r="10" fill="#fff" stroke="#0c2e65" strokeWidth="5" /><circle cx="373" cy="70" r="10" fill="#0c2e65" stroke="white" strokeWidth="4" />
        <g fill="#616b7a" fontSize="11" fontFamily="sans-serif"><text x="85" y="110">GREEN POINT</text><text x="290" y="310">CAPE TOWN</text><text x="395" y="60">V&amp;A WATERFRONT</text><text x="430" y="345">DISTRICT SIX</text><text x="60" y="355">GARDENS</text></g>
        <g className="map-car" style={{ transform: `translate(${active ? 257 : 220}px, ${active ? 170 : 210}px) rotate(-12deg)` }}><rect x="-11" y="-17" width="22" height="34" rx="6" fill="#071b3a" stroke="white" strokeWidth="3" /><path d="M-6-8H6M-6 8H6" stroke="#ff8229" strokeWidth="5" /></g>
      </g>
    </svg>
    <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-2 text-[12px] font-medium shadow-sm"><span className="live-dot mr-2 inline-block h-1.5 w-1.5 rounded-full bg-green-700" />Trip view</span>
    <div className="absolute bottom-4 right-4 flex flex-col rounded-lg bg-white shadow"><button aria-label="Zoom in" className="h-11 w-11 border-b border-gray-100 text-xl" onClick={() => setZoom(Math.min(zoom + .2, 1.8))}>+</button><button aria-label="Zoom out" className="h-11 w-11 text-xl" onClick={() => setZoom(Math.max(zoom - .2, 1))}>−</button></div>
    <span className="absolute bottom-3 left-4 text-[12px] text-[#4c5768]">Stylised map · Cape Town</span>
  </div>;
}
