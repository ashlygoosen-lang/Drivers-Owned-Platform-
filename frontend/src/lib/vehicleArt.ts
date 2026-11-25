/**
 * Original DROP vehicle illustrations (no brand artwork): a top-down view for map markers (front points
 * up, so it can be rotated to the driver's heading) and a side view for choosing a vehicle or a ride.
 * Plain SVG strings, so they work in Google Maps markers, React and the PNG export for the apps.
 */
export type VehicleType = 'hatchback' | 'sedan' | 'suv' | 'mpv' | 'minibus' | 'bakkie' | 'motorbike' | 'luxury_sedan' | 'luxury_suv';
export type ArtType = VehicleType | 'bus' | 'plane';

const NAVY = '#071B3A', ORANGE = '#FF6B00', GLASS = '#A9C1DC', GLASS_DARK = '#6F8FB3', LIGHT = '#FFF6D6', TAIL = '#E5484D';
const LUX = '#111827', GOLD = '#D6B45C';

interface TopSpec { w: number; l: number; nose: number; wind: number; roof: number; rear: number; body?: string; trim?: string; rails?: boolean; sideWindows?: boolean; bed?: number }
const TOP: Record<Exclude<VehicleType, 'motorbike'>, TopSpec> = {
  hatchback: { w: 22, l: 38, nose: 8, wind: 6, roof: 13, rear: 4 },
  sedan: { w: 22, l: 46, nose: 10, wind: 7, roof: 12, rear: 5 },
  suv: { w: 25, l: 46, nose: 9, wind: 6, roof: 17, rear: 4, rails: true },
  mpv: { w: 24, l: 50, nose: 8, wind: 7, roof: 22, rear: 4, rails: true },
  minibus: { w: 27, l: 62, nose: 5, wind: 7, roof: 41, rear: 4, sideWindows: true },
  bakkie: { w: 24, l: 52, nose: 10, wind: 6, roof: 9, rear: 3, bed: 21 },
  luxury_sedan: { w: 23, l: 52, nose: 13, wind: 8, roof: 13, rear: 6, body: LUX, trim: GOLD },
  luxury_suv: { w: 26, l: 50, nose: 10, wind: 7, roof: 19, rear: 5, body: LUX, trim: GOLD, rails: true },
};

function topCar(s: TopSpec, outline: string) {
  const { w, l } = s; const h = w / 2; const y0 = -l / 2;
  const body = s.body || NAVY, trim = s.trim || ORANGE;
  const yW = y0 + s.nose, yR = yW + s.wind, yG = yR + s.roof, yE = yG + s.rear;
  const parts: string[] = [];
  parts.push(`<rect x="${-h}" y="${y0}" width="${w}" height="${l}" rx="${Math.min(8, w / 3)}" fill="${body}" stroke="${outline}" stroke-width="2.5"/>`);
  // mirrors
  parts.push(`<ellipse cx="${-h - 1.2}" cy="${yW + 1.5}" rx="2.2" ry="1.4" fill="${body}" stroke="${outline}" stroke-width="1"/><ellipse cx="${h + 1.2}" cy="${yW + 1.5}" rx="2.2" ry="1.4" fill="${body}" stroke="${outline}" stroke-width="1"/>`);
  // headlights and tail lights
  parts.push(`<rect x="${-h + 2}" y="${y0 + 0.8}" width="${w * 0.26}" height="2.4" rx="1.2" fill="${LIGHT}"/><rect x="${h - 2 - w * 0.26}" y="${y0 + 0.8}" width="${w * 0.26}" height="2.4" rx="1.2" fill="${LIGHT}"/>`);
  parts.push(`<rect x="${-h + 2}" y="${y0 + l - 3}" width="${w * 0.22}" height="2" rx="1" fill="${TAIL}"/><rect x="${h - 2 - w * 0.22}" y="${y0 + l - 3}" width="${w * 0.22}" height="2" rx="1" fill="${TAIL}"/>`);
  // bonnet crease
  parts.push(`<path d="M${-h + 4} ${y0 + 3} Q0 ${yW - 1} ${h - 4} ${y0 + 3}" fill="none" stroke="#ffffff22" stroke-width="1"/>`);
  // windscreen (wide at the bonnet, narrower at the roof)
  parts.push(`<path d="M${-h + 2.5} ${yW} L${h - 2.5} ${yW} L${h - 4.5} ${yR} L${-h + 4.5} ${yR} Z" fill="${GLASS}"/>`);
  // roof
  parts.push(`<rect x="${-h + 4}" y="${yR}" width="${w - 8}" height="${s.roof}" rx="2.5" fill="${body}" stroke="#ffffff30" stroke-width="0.8"/>`);
  parts.push(`<rect x="${-h + 6}" y="${yR + 2}" width="${w - 12}" height="${Math.max(2, s.roof * 0.18)}" rx="1.5" fill="${trim}"/>`);
  if (s.rails) parts.push(`<line x1="${-h + 5}" y1="${yR + 1}" x2="${-h + 5}" y2="${yG - 1}" stroke="#ffffff55" stroke-width="1"/><line x1="${h - 5}" y1="${yR + 1}" x2="${h - 5}" y2="${yG - 1}" stroke="#ffffff55" stroke-width="1"/>`);
  if (s.sideWindows) {
    for (let y = yR + 3; y < yG - 4; y += 8) parts.push(`<rect x="${-h + 1}" y="${y}" width="2.4" height="6" rx="1" fill="${GLASS_DARK}"/><rect x="${h - 3.4}" y="${y}" width="2.4" height="6" rx="1" fill="${GLASS_DARK}"/>`);
  } else {
    parts.push(`<rect x="${-h + 1}" y="${yR + 1}" width="2.2" height="${s.roof - 2}" rx="1" fill="${GLASS_DARK}"/><rect x="${h - 3.2}" y="${yR + 1}" width="2.2" height="${s.roof - 2}" rx="1" fill="${GLASS_DARK}"/>`);
  }
  // rear window
  parts.push(`<path d="M${-h + 4.5} ${yG} L${h - 4.5} ${yG} L${h - 3} ${yE} L${-h + 3} ${yE} Z" fill="${GLASS_DARK}"/>`);
  if (s.bed) {
    const yb = yE + 1.5, bl = s.bed;
    parts.push(`<rect x="${-h + 2.5}" y="${yb}" width="${w - 5}" height="${bl}" rx="1.5" fill="#1E3557" stroke="#ffffff40" stroke-width="0.8"/>`);
    for (let i = 1; i < 4; i++) parts.push(`<line x1="${-h + 4}" y1="${yb + (bl * i) / 4}" x2="${h - 4}" y2="${yb + (bl * i) / 4}" stroke="#ffffff30" stroke-width="0.8"/>`);
    parts.push(`<rect x="${-h + 5}" y="${yb + 3}" width="${w - 10}" height="5" rx="1" fill="${ORANGE}" opacity="0.85"/>`);
  }
  return { parts, vb: [-h - 5, y0 - 3, w + 10, l + 6] };
}

function topBike(outline: string) {
  const p = [
    `<ellipse cx="0" cy="-15" rx="2.6" ry="5.5" fill="#1f2937" stroke="${outline}" stroke-width="1.5"/>`,
    `<ellipse cx="0" cy="15" rx="3" ry="6" fill="#1f2937" stroke="${outline}" stroke-width="1.5"/>`,
    `<rect x="-4" y="-11" width="8" height="22" rx="4" fill="${NAVY}" stroke="${outline}" stroke-width="2"/>`,
    `<line x1="-9" y1="-9" x2="9" y2="-9" stroke="${outline}" stroke-width="3" stroke-linecap="round"/><line x1="-9" y1="-9" x2="9" y2="-9" stroke="#1f2937" stroke-width="1.6" stroke-linecap="round"/>`,
    `<rect x="-5.5" y="6" width="11" height="9" rx="2" fill="${ORANGE}" stroke="${outline}" stroke-width="1.2"/>`, // delivery box
    `<ellipse cx="0" cy="-1" rx="7.5" ry="4.5" fill="#24467a" stroke="${outline}" stroke-width="1.2"/>`, // shoulders
    `<circle cx="0" cy="-2" r="4" fill="${ORANGE}" stroke="${outline}" stroke-width="1.2"/><path d="M-2.6 -4.2 A3 3 0 0 1 2.6 -4.2" fill="none" stroke="${NAVY}" stroke-width="1.2"/>`,
  ];
  return { parts: p, vb: [-12, -23, 24, 46] };
}

/** Top-down marker SVG. `size` is the height of a sedan in pixels; other vehicles keep their real proportions. */
export function topView(type: string, { size = 46, outline = '#ffffff', centered = false }: { size?: number; outline?: string; centered?: boolean } = {}) {
  const t = (type in TOP || type === 'motorbike' ? type : 'sedan') as VehicleType;
  const { parts, vb } = t === 'motorbike' ? topBike(outline) : topCar(TOP[t as Exclude<VehicleType, 'motorbike'>], outline);
  const height = Math.round((size * vb[3]) / 52); const width = Math.round((vb[2] / vb[3]) * height);
  const at = centered ? ` x="${-width / 2}" y="${-height / 2}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${at} width="${width}" height="${height}" viewBox="${vb.join(' ')}" aria-hidden="true">${parts.join('')}</svg>`;
}

/* ---------- side views (120 × 64) ---------- */
interface Side { body: string; glass: string[]; wheels: [number, number]; r?: number; color?: string; trim?: string; extra?: string }
const wheel = (x: number, r = 9) => `<circle cx="${x}" cy="50" r="${r}" fill="#1f2937"/><circle cx="${x}" cy="50" r="${r * 0.48}" fill="#cbd5e1"/><circle cx="${x}" cy="50" r="${r * 0.16}" fill="#475569"/>`;
const SIDE: Record<ArtType, Side> = {
  hatchback: { body: 'M10 48 L10 38 Q12 32 22 30 L34 20 Q40 16 54 16 L80 16 Q90 16 94 22 L98 30 Q106 32 106 40 L106 48 Z', glass: ['M37 22 Q42 19 54 19 L62 19 L62 30 L28 30 Z', 'M66 19 L80 19 Q88 19 91 24 L94 30 L66 30 Z'], wheels: [28, 88] },
  sedan: { body: 'M6 48 L6 38 Q8 33 18 31 L34 20 Q40 16 52 16 L74 16 Q84 16 90 24 L94 30 L108 32 Q114 34 114 41 L114 48 Z', glass: ['M37 22 Q42 19 52 19 L60 19 L60 30 L28 30 Z', 'M64 19 L74 19 Q82 19 86 25 L88 30 L64 30 Z'], wheels: [26, 94] },
  suv: { body: 'M6 48 L6 34 Q7 28 16 27 L28 14 Q31 11 38 11 L100 11 Q106 11 108 18 L112 30 Q114 33 114 40 L114 48 Z', glass: ['M31 16 Q33 14 38 14 L58 14 L58 27 L22 27 Z', 'M62 14 L84 14 L84 27 L62 27 Z', 'M88 14 L100 14 Q103 14 104 18 L107 27 L88 27 Z'], wheels: [26, 94], r: 10, extra: '<rect x="40" y="8" width="56" height="2.5" rx="1" fill="#475569"/>' },
  mpv: { body: 'M4 48 L4 34 Q5 28 14 27 L28 13 Q31 10 38 10 L106 10 Q112 10 113 16 L115 30 Q116 34 116 40 L116 48 Z', glass: ['M31 15 Q33 13 38 13 L56 13 L56 27 L21 27 Z', 'M60 13 L80 13 L80 27 L60 27 Z', 'M84 13 L106 13 Q109 13 110 17 L111 27 L84 27 Z'], wheels: [24, 96] },
  minibus: { body: 'M4 48 L4 30 Q4 22 10 18 L16 10 Q19 7 26 7 L110 7 Q116 7 116 13 L116 48 Z', glass: ['M18 12 Q20 10 26 10 L32 10 L32 26 L10 26 Q10 20 14 16 Z', 'M36 10 L52 10 L52 24 L36 24 Z', 'M56 10 L72 10 L72 24 L56 24 Z', 'M76 10 L92 10 L92 24 L76 24 Z', 'M96 10 L112 10 L112 24 L96 24 Z'], wheels: [22, 98], extra: '<rect x="4" y="32" width="112" height="3" fill="#FF6B00"/>' },
  bakkie: { body: 'M4 48 L4 34 Q5 29 14 28 L28 16 Q31 13 38 13 L60 13 Q64 13 64 17 L64 30 L116 30 L116 48 Z', glass: ['M31 18 Q33 16 38 16 L46 16 L46 28 L22 28 Z', 'M50 16 L58 16 Q61 16 61 19 L61 28 L50 28 Z'], wheels: [24, 96], r: 10, extra: '<rect x="66" y="26" width="48" height="5" rx="1" fill="#1E3557"/><rect x="70" y="27" width="20" height="3" rx="1" fill="#FF6B00"/>' },
  motorbike: { body: '', glass: [], wheels: [26, 94], r: 12, extra: '<path d="M26 50 L52 32 L78 32 L94 50" fill="none" stroke="#071B3A" stroke-width="5" stroke-linejoin="round"/><path d="M44 30 L80 28 Q86 28 86 34 L70 38 L46 38 Z" fill="#071B3A"/><path d="M80 24 L88 18" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/><rect x="28" y="20" width="22" height="16" rx="2" fill="#FF6B00"/><path d="M58 28 Q60 14 70 12 L76 22 L68 30 Z" fill="#24467a"/><circle cx="74" cy="9" r="6" fill="#FF6B00"/>' },
  luxury_sedan: { body: 'M4 48 L4 39 Q6 34 18 32 L36 20 Q44 15 58 15 L78 15 Q88 15 94 23 L98 30 L112 32 Q117 34 117 41 L117 48 Z', glass: ['M39 21 Q46 18 58 18 L66 18 L66 30 L30 30 Z', 'M70 18 L78 18 Q86 18 90 24 L92 30 L70 30 Z'], wheels: [26, 96], color: LUX, trim: GOLD, extra: '<rect x="20" y="36" width="88" height="1.5" fill="#D6B45C"/>' },
  luxury_suv: { body: 'M5 48 L5 34 Q6 28 16 27 L28 13 Q31 10 38 10 L102 10 Q108 10 110 17 L113 30 Q115 33 115 40 L115 48 Z', glass: ['M31 15 Q33 13 38 13 L58 13 L58 27 L22 27 Z', 'M62 13 L84 13 L84 27 L62 27 Z', 'M88 13 L102 13 Q105 13 106 17 L109 27 L88 27 Z'], wheels: [26, 94], r: 10, color: LUX, trim: GOLD, extra: '<rect x="20" y="35" width="88" height="1.5" fill="#D6B45C"/>' },
  bus: { body: 'M3 48 L3 12 Q3 5 10 5 L112 5 Q117 5 117 11 L117 48 Z', glass: ['M6 9 L18 9 L18 28 L6 28 Z', 'M22 9 L38 9 L38 24 L22 24 Z', 'M42 9 L58 9 L58 24 L42 24 Z', 'M62 9 L78 9 L78 24 L62 24 Z', 'M82 9 L98 9 L98 24 L82 24 Z', 'M102 9 L114 9 L114 24 L102 24 Z'], wheels: [24, 96], r: 9, extra: '<rect x="3" y="30" width="114" height="4" fill="#FF6B00"/><rect x="20" y="36" width="20" height="10" rx="1" fill="#0C2E65"/>' },
  plane: { body: '', glass: [], wheels: [0, 0], extra: '<path d="M8 34 Q8 28 18 28 L96 28 Q112 28 116 34 Q112 40 96 40 L18 40 Q8 40 8 34 Z" fill="#071B3A"/><path d="M52 30 L36 8 L46 8 L72 30 Z" fill="#0C2E65"/><path d="M52 38 L36 60 L46 60 L72 38 Z" fill="#0C2E65"/><path d="M12 30 L6 16 L14 16 L24 30 Z" fill="#FF6B00"/><path d="M100 30 Q108 30 112 34 L100 34 Z" fill="#A9C1DC"/><g fill="#A9C1DC">' + Array.from({ length: 9 }, (_, i) => `<circle cx="${30 + i * 7}" cy="32" r="1.4"/>`).join('') + '</g>' },
};

/** Side-view illustration (for choosing a vehicle or a ride). */
export function sideView(type: string, { width = 120 }: { width?: number } = {}) {
  const s = SIDE[(type in SIDE ? type : 'sedan') as ArtType];
  const color = s.color || NAVY;
  const inner = [
    `<ellipse cx="60" cy="58" rx="54" ry="3" fill="#071B3A18"/>`,
    s.body ? `<path d="${s.body}" fill="${color}"/>` : '',
    ...s.glass.map((g) => `<path d="${g}" fill="${GLASS}"/>`),
    s.body && type !== 'bus' && type !== 'minibus' ? `<rect x="${s.wheels[1] + 10}" y="34" width="5" height="3" rx="1" fill="${LIGHT}"/><rect x="${Math.max(4, s.wheels[0] - 20)}" y="35" width="4" height="3" rx="1" fill="${TAIL}"/>` : '',
    s.extra || '',
    type === 'plane' ? '' : wheel(s.wheels[0], s.r) + wheel(s.wheels[1], s.r),
    s.trim ? '' : '',
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round((width * 64) / 120)}" viewBox="0 0 120 64" aria-hidden="true">${inner}</svg>`;
}

export const VEHICLE_LABEL: Record<string, string> = {
  hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV', mpv: '7-seater', minibus: 'Minibus', bakkie: 'Bakkie', motorbike: 'Motorbike',
  luxury_sedan: 'Luxury sedan', luxury_suv: 'Luxury SUV', bus: 'Coach', plane: 'Aircraft',
};
/** Which picture to show for a booking category before a driver is assigned. */
export const CATEGORY_ART: Record<string, string> = {
  Go: 'hatchback', Comfort: 'sedan', XL: 'mpv', Executive: 'luxury_sedan', Minibus: 'minibus', Documents: 'motorbike', 'Small parcel': 'motorbike',
  'Food & retail': 'motorbike', Bakkie: 'bakkie', 'Executive sedan': 'luxury_sedan', 'Luxury SUV': 'luxury_suv',
};
