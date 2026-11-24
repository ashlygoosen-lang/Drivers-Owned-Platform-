import { forwardRef } from 'react';
import { Mark } from './assets';

/* Brand application artwork. Every piece is a real vector (SVG) that downloads as SVG or PNG. */
export const NAVY = '#071B3A', ORANGE = '#FF6B00', WHITE = '#FFFFFF', GREY = '#F5F7FA', SLATE = '#5B6B82';
const sans = { fontFamily: 'Inter, Helvetica Neue, Arial, sans-serif' } as const;
const display = { fontFamily: 'Manrope, Inter, Arial, sans-serif' } as const;
type P = { className?: string };

/** Signature brand device: an orange route line ending in a pin dot. */
function Route({ d, w = 6 }: { d: string; w?: number }) {
  return <path d={d} fill="none" stroke={ORANGE} strokeWidth={w} strokeLinecap="round" />;
}

export const BusinessCardFront = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 850 550" role="img" aria-label="DROP business card front">
    <rect width="850" height="550" rx="24" fill={NAVY} />
    <Route d="M-20 470 C 220 470 300 330 520 330 S 790 230 880 180" w={5} />
    <Mark name="drop-logo-primary-dark" x={425} y={110} h={250} anchor="middle" />
  </svg>
));

export const BusinessCardBack = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 850 550" role="img" aria-label="DROP business card back">
    <rect width="850" height="550" rx="24" fill={WHITE} stroke="#E3E8EF" strokeWidth="2" />
    <rect x="0" y="500" width="850" height="50" fill={NAVY} /><rect x="0" y="494" width="850" height="6" fill={ORANGE} />
    <Mark name="drop-logo-horizontal-light" x={70} y={66} h={64} />
    <g style={sans}>
      <text x="70" y="250" fontSize="40" fontWeight="700" fill={NAVY}>Full Name</text>
      <text x="70" y="290" fontSize="22" fill={ORANGE} fontWeight="600">Job Title</text>
      <g fontSize="20" fill={SLATE}>
        <text x="70" y="360">+27 00 000 0000</text><text x="70" y="392">name@drop.co.za</text><text x="70" y="424">Cape Town, South Africa</text>
      </g>
      <text x="780" y="532" fontSize="17" fill={WHITE} textAnchor="end" fontWeight="600" letterSpacing="1">RIDE SMART. GO FURTHER.</text>
    </g>
  </svg>
));

export const Letterhead = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 595 842" role="img" aria-label="DROP letterhead (A4)">
    <rect width="595" height="842" fill={WHITE} />
    <rect width="595" height="6" fill={ORANGE} />
    <Mark name="drop-logo-horizontal-tagline-light" x={48} y={40} h={52} />
    <g style={sans} fontSize="8.5" fill={SLATE} textAnchor="end"><text x="547" y="56">DROP — Drivers Owned Platform</text><text x="547" y="68">Cape Town, South Africa</text><text x="547" y="80">hello@drop.co.za</text></g>
    <line x1="48" y1="112" x2="547" y2="112" stroke="#E3E8EF" />
    <g style={sans} fill="#B7C1CF" fontSize="9">{['Date', '', 'Recipient name', 'Company', 'Address', '', 'Dear …'].map((t, i) => <text key={i} x="48" y={150 + i * 16}>{t}</text>)}</g>
    {Array.from({ length: 16 }, (_, i) => <rect key={i} x="48" y={290 + i * 18} width={i % 5 === 4 ? 300 : 499} height="6" rx="3" fill="#EEF1F5" />)}
    <rect x="0" y="800" width="595" height="42" fill={NAVY} />
    <g style={sans} fontSize="7.5" fill="#C9D3E3"><text x="48" y="825">DROP is a division of VINK Group (Pty) Ltd · Registration number 2018/079316/07</text><text x="547" y="825" textAnchor="end" fill={ORANGE} fontWeight="700">RIDE SMART. GO FURTHER.</text></g>
  </svg>
));

export const SocialAvatar = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 1080 1080" role="img" aria-label="DROP social profile image">
    <rect width="1080" height="1080" fill={NAVY} />
    <Mark name="drop-symbol-dark" x={540} y={250} h={460} anchor="middle" />
    <Mark name="drop-wordmark-dark" x={540} y={700} h={150} anchor="middle" />
  </svg>
));

export const FacebookCover = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 1640 624" role="img" aria-label="DROP Facebook cover">
    <rect width="1640" height="624" fill={NAVY} />
    <circle cx="1400" cy="300" r="380" fill="#0D2A57" />
    <Route d="M820 560 C 1000 560 1080 420 1240 400 S 1480 300 1500 180" w={8} />
    <circle cx="1500" cy="180" r="18" fill={ORANGE} />
    <g style={display}><text x="420" y="290" fontSize="92" fontWeight="800" fill={WHITE} letterSpacing="-2">Ride Smart.</text><text x="420" y="390" fontSize="92" fontWeight="800" fill={ORANGE} letterSpacing="-2">Go Further.</text></g>
    <g style={sans}><text x="424" y="460" fontSize="30" fill="#C9D3E3">Rides · Deliveries · Premium Drive</text></g>
  </svg>
));

export const InstagramPost = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 1080 1350" role="img" aria-label="DROP Instagram post template">
    <rect width="1080" height="1350" fill={GREY} />
    <rect x="0" y="0" width="1080" height="760" fill={NAVY} />
    <Route d="M-20 640 C 300 640 420 420 660 420 S 980 260 1100 200" w={10} />
    <Mark name="drop-symbol-dark" x={540} y={150} h={360} anchor="middle" />
    <g style={display}><text x="80" y="900" fontSize="92" fontWeight="800" fill={NAVY} letterSpacing="-2">R0 passenger</text><text x="80" y="1000" fontSize="92" fontWeight="800" fill={ORANGE} letterSpacing="-2">commission.</text></g>
    <g style={sans}><text x="84" y="1080" fontSize="34" fill={SLATE}>Fares upfront. Every time.</text></g>
    <Mark name="drop-logo-horizontal-light" x={80} y={1175} h={82} />
    <rect x="680" y="1180" width="320" height="76" rx="16" fill={ORANGE} /><text x="840" y="1229" style={sans} fontSize="30" fontWeight="700" fill={NAVY} textAnchor="middle">Book now</text>
  </svg>
));

export const DigitalAd = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 1200 628" role="img" aria-label="DROP digital advert 1200×628">
    <rect width="1200" height="628" fill={NAVY} />
    <rect x="760" y="0" width="440" height="628" fill={ORANGE} />
    <Mark name="drop-symbol-mono-white" x={980} y={130} h={360} anchor="middle" />
    <Mark name="drop-logo-horizontal-dark" x={70} y={60} h={70} />
    <g style={display}><text x="70" y="300" fontSize="68" fontWeight="800" fill={WHITE} letterSpacing="-1.5">Your ride, upfront.</text><text x="70" y="378" fontSize="68" fontWeight="800" fill={ORANGE} letterSpacing="-1.5">No surprises.</text></g>
    <rect x="70" y="450" width="260" height="70" rx="14" fill={ORANGE} /><text x="200" y="495" style={sans} fontSize="26" fontWeight="700" fill={NAVY} textAnchor="middle">Get a fare</text>
  </svg>
));

export const Poster = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 594 841" role="img" aria-label="DROP promotional poster (A-series)">
    <rect width="594" height="841" fill={NAVY} />
    <circle cx="297" cy="300" r="230" fill="#0D2A57" />
    <Route d="M-10 520 C 140 520 200 420 300 420 S 480 360 610 300" w={6} />
    <Mark name="drop-symbol-dark" x={297} y={130} h={300} anchor="middle" />
    <g style={display} textAnchor="middle"><text x="297" y="590" fontSize="62" fontWeight="800" fill={WHITE} letterSpacing="-1.5">Ride Smart.</text><text x="297" y="658" fontSize="62" fontWeight="800" fill={ORANGE} letterSpacing="-1.5">Go Further.</text></g>
    <g style={sans} textAnchor="middle"><text x="297" y="705" fontSize="17" fill="#C9D3E3">Rides, deliveries and premium travel. R0 passenger commission.</text></g>
    <rect x="0" y="760" width="594" height="81" fill={WHITE} />
    <Mark name="drop-logo-horizontal-light" x={40} y={778} h={46} />
    <text x="554" y="808" style={sans} fontSize="15" fontWeight="700" fill={NAVY} textAnchor="end">Book on the web today</text>
  </svg>
));

export const PresentationSlide = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 1600 900" role="img" aria-label="DROP presentation title slide">
    <rect width="1600" height="900" fill={WHITE} />
    <rect width="620" height="900" fill={NAVY} />
    <Route d="M0 760 C 200 760 300 600 460 600 S 600 520 640 470" w={8} />
    <Mark name="drop-logo-primary-dark" x={310} y={230} h={300} anchor="middle" />
    <g style={sans}><text x="720" y="330" fontSize="22" fontWeight="700" fill={ORANGE} letterSpacing="3">PRESENTATION TITLE</text></g>
    <g style={display}><text x="716" y="430" fontSize="76" fontWeight="800" fill={NAVY} letterSpacing="-2">Your headline</text><text x="716" y="520" fontSize="76" fontWeight="800" fill={NAVY} letterSpacing="-2">goes here.</text></g>
    <g style={sans}><text x="720" y="600" fontSize="28" fill={SLATE}>Presenter name · Date</text></g>
    <rect x="720" y="800" width="800" height="2" fill="#E3E8EF" /><text x="1520" y="850" style={sans} fontSize="18" fill={SLATE} textAnchor="end">drop · Ride Smart. Go Further.</text>
  </svg>
));

/** Side view of a sedan in DROP livery: white body, navy rocker panel, orange route line, logo on the doors. */
export const VehicleWrap = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 1000 400" role="img" aria-label="DROP vehicle livery, side view">
    <rect width="1000" height="400" fill={GREY} />
    <ellipse cx="500" cy="340" rx="440" ry="16" fill="#D9DFE7" />
    <defs><clipPath id="body"><path d="M70 262 Q66 222 112 212 L262 192 Q330 122 420 112 L610 110 Q690 114 760 186 L898 206 Q944 214 946 256 L948 292 Q948 306 934 306 L84 306 Q70 306 70 292 Z" /></clipPath></defs>
    <path d="M70 262 Q66 222 112 212 L262 192 Q330 122 420 112 L610 110 Q690 114 760 186 L898 206 Q944 214 946 256 L948 292 Q948 306 934 306 L84 306 Q70 306 70 292 Z" fill={WHITE} stroke="#C5CEDA" strokeWidth="2" />
    <g clipPath="url(#body)">
      <rect x="0" y="266" width="1000" height="60" fill={NAVY} />
      <path d="M60 266 C 300 266 420 258 600 258 S 840 252 960 246" fill="none" stroke={ORANGE} strokeWidth="8" />
    </g>
    <path d="M290 192 Q348 136 424 128 L512 127 L512 192 Z" fill="#20324F" /><path d="M528 127 L606 127 Q672 132 722 190 L528 192 Z" fill="#20324F" />
    <line x1="520" y1="128" x2="520" y2="266" stroke="#C5CEDA" strokeWidth="2" /><line x1="740" y1="196" x2="742" y2="266" stroke="#C5CEDA" strokeWidth="2" />
    <Mark name="drop-logo-horizontal-light" x={548} y={200} h={42} />
    <Mark name="drop-symbol-light" x={398} y={198} h={46} />
    <text x="536" y="294" style={sans} fontSize="11.5" fontWeight="700" fill={WHITE} letterSpacing="2">RIDE SMART. GO FURTHER.</text>
    <text x="330" y="294" style={sans} fontSize="12" fontWeight="600" fill="#C9D3E3" letterSpacing="1">Book on the DROP app</text>
    {[230, 780].map((cx) => <g key={cx}><circle cx={cx} cy="306" r="52" fill="#141B26" /><circle cx={cx} cy="306" r="30" fill="#AAB4C3" /><circle cx={cx} cy="306" r="9" fill="#141B26" /></g>)}
    <rect x="920" y="226" width="22" height="12" rx="4" fill={ORANGE} /><rect x="74" y="232" width="16" height="12" rx="4" fill="#E2483D" />
  </svg>
));

export const DoorSticker = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 600 400" role="img" aria-label="DROP vehicle door sticker">
    <rect width="600" height="400" rx="28" fill={WHITE} stroke="#E3E8EF" strokeWidth="2" />
    <rect x="0" y="0" width="600" height="400" rx="28" fill="none" stroke={NAVY} strokeWidth="14" />
    <Mark name="drop-logo-horizontal-light" x={300} y={78} h={96} anchor="middle" />
    <rect x="70" y="214" width="460" height="4" rx="2" fill={ORANGE} />
    <g style={sans} textAnchor="middle"><text x="300" y="276" fontSize="34" fontWeight="800" fill={NAVY} letterSpacing="2">DRIVER PARTNER</text><text x="300" y="322" fontSize="20" fill={SLATE}>Vehicle no. ____________</text></g>
  </svg>
));

export const Uniform = forwardRef<SVGSVGElement, P>(({ className }, ref) => (
  <svg ref={ref} className={className} viewBox="0 0 600 600" role="img" aria-label="DROP driver uniform polo shirt">
    <rect width="600" height="600" fill={GREY} />
    <path d="M220 90 L170 100 L70 170 L110 270 L160 245 L160 520 Q160 535 175 535 L425 535 Q440 535 440 520 L440 245 L490 270 L530 170 L430 100 L380 90 Q300 140 220 90 Z" fill={NAVY} />
    <path d="M220 90 Q300 140 380 90 L362 84 Q300 118 238 84 Z" fill={ORANGE} />
    <path d="M276 112 L300 190 L324 112" fill="none" stroke="#0D2A57" strokeWidth="4" /><circle cx="300" cy="146" r="4" fill={WHITE} /><circle cx="300" cy="170" r="4" fill={WHITE} />
    <path d="M70 170 L110 270 M530 170 L490 270" stroke={ORANGE} strokeWidth="8" />
    <Mark name="drop-logo-horizontal-dark" x={338} y={190} h={30} />
    <rect x="160" y="500" width="280" height="6" fill={ORANGE} />
  </svg>
));
