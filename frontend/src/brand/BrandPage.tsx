import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName, button, outline, limeButton, input } from '../components/ui';
import { COMPANY } from '../lib/company';
import { downloadPng, downloadSvg } from './assets';
import * as M from './mockups';

const LOGOS: { file: string; name: string; use: string; dark?: boolean }[] = [
  { file: 'drop-logo-primary-light', name: 'Primary logo', use: 'Hero placements, signage, cover pages.' },
  { file: 'drop-logo-primary-dark', name: 'Primary logo · dark', use: 'On Midnight Navy or photography.', dark: true },
  { file: 'drop-logo-horizontal-light', name: 'Horizontal logo', use: 'Website header, documents, email.' },
  { file: 'drop-logo-horizontal-dark', name: 'Horizontal logo · dark', use: 'Dark headers, footers, apps.', dark: true },
  { file: 'drop-logo-horizontal-tagline-light', name: 'Horizontal with tagline', use: 'Letterheads, adverts, footers.' },
  { file: 'drop-logo-horizontal-tagline-dark', name: 'Horizontal with tagline · dark', use: 'Dark adverts and presentations.', dark: true },
  { file: 'drop-symbol-light', name: 'Symbol', use: 'Map markers, small spaces, stickers.' },
  { file: 'drop-wordmark-light', name: 'Wordmark', use: 'When the symbol already appears nearby.' },
  { file: 'drop-logo-horizontal-mono-navy', name: 'Monochrome · navy', use: 'One-colour print, embossing, fax.' },
  { file: 'drop-logo-horizontal-mono-white', name: 'Monochrome · white', use: 'Reversed one-colour, vinyl cut.', dark: true },
  { file: 'drop-app-icon', name: 'Passenger app icon', use: 'iOS and Android passenger app.' },
  { file: 'drop-driver-app-icon', name: 'Driver app icon', use: 'iOS and Android driver app.' },
];

const COLOURS = [
  { name: 'Midnight Navy', hex: '#071B3A', rgb: '7 27 58', cmyk: '88 53 0 77', role: 'Primary. Text, headers, dark surfaces.', ratio: '45%', text: 'white' },
  { name: 'Dynamic Orange', hex: '#FF6B00', rgb: '255 107 0', cmyk: '0 58 100 0', role: 'Accent. Key actions, highlights, the pin.', ratio: '10%', text: '#071B3A' },
  { name: 'Pure White', hex: '#FFFFFF', rgb: '255 255 255', cmyk: '0 0 0 0', role: 'Backgrounds and reversed text.', ratio: '30%', text: '#071B3A' },
  { name: 'Light Grey', hex: '#F5F7FA', rgb: '245 247 250', cmyk: '2 1 0 2', role: 'Section backgrounds, cards, inputs.', ratio: '15%', text: '#071B3A' },
];
const SUPPORT = [['Navy 600', '#0D2A57', 'Hover, raised dark surfaces'], ['Orange 700', '#E65F00', 'Orange text on white (AA large)'], ['Slate', '#5B6B82', 'Secondary text'], ['Line', '#E3E8EF', 'Borders and dividers'], ['Success', '#1E8E5A', 'Confirmations'], ['Alert', '#D93636', 'Errors and SOS']];

const SECTIONS = [['logo', 'Logo'], ['colour', 'Colour'], ['type', 'Typography'], ['icons', 'Iconography'], ['ui', 'Interface'], ['apps', 'Applications'], ['voice', 'Voice'], ['downloads', 'Downloads']] as const;

function Download({ file, dark }: { file: string; dark?: boolean }) {
  return <div className="flex gap-2 text-[12px] font-semibold">
    <a className={`rounded-lg px-3 py-2 ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-grey text-navy hover:bg-[#e6ebf2]'}`} href={`/brand/${file}.svg`} download>SVG</a>
    <a className={`rounded-lg px-3 py-2 ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-grey text-navy hover:bg-[#e6ebf2]'}`} href={`/brand/png/${file}${/icon/.test(file) ? '-1024' : ''}.png`} download>PNG</a>
  </div>;
}

function Artwork({ title, size, children, art }: { title: string; size: string; children: (ref: React.RefObject<SVGSVGElement | null>) => React.ReactNode; art: string }) {
  const ref = useRef<SVGSVGElement>(null);
  return <figure className="brand-card flex flex-col rounded-2xl border border-[#e3e8ef] bg-white p-4">
    <div className="flex flex-1 items-center justify-center rounded-xl bg-grey p-4">{children(ref)}</div>
    <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3"><span><b className="block text-sm text-navy">{title}</b><span className="text-[12px] text-[#5b6b82]">{size}</span></span>
      <span className="flex gap-2 text-[12px] font-semibold"><button className="rounded-lg bg-grey px-3 py-2 text-navy hover:bg-[#e6ebf2]" onClick={() => downloadSvg(ref.current, art)}>SVG</button><button className="rounded-lg bg-grey px-3 py-2 text-navy hover:bg-[#e6ebf2]" onClick={() => downloadPng(ref.current, art)}>PNG</button></span>
    </figcaption>
  </figure>;
}

function Signature() {
  const [name, setName] = useState('Full Name');
  const [title, setTitle] = useState('Job Title');
  const [phone, setPhone] = useState('+27 00 000 0000');
  const [email, setEmail] = useState('name@drop.co.za');
  const [copied, setCopied] = useState(false);
  const html = `<table cellpadding="0" cellspacing="0" style="font-family:Inter,Arial,sans-serif;color:#071B3A"><tr><td style="padding-right:16px;border-right:3px solid #FF6B00"><img src="${location.origin}/brand/png/drop-logo-horizontal-light.png" alt="DROP" width="140" style="display:block"></td><td style="padding-left:16px;font-size:13px;line-height:1.5"><b style="font-size:15px">${name}</b><br><span style="color:#E65F00">${title}</span><br>${phone} · <a href="mailto:${email}" style="color:#071B3A">${email}</a><br><span style="color:#5B6B82;font-size:11px">Ride Smart. Go Further. · A division of VINK Group (Pty) Ltd</span></td></tr></table>`;
  return <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
    <div className="grid gap-3">{[['Name', name, setName], ['Title', title, setTitle], ['Phone', phone, setPhone], ['Email', email, setEmail]].map(([l, v, set]) => <label key={l as string} className="grid gap-1 text-sm">{l as string}<input className={input} value={v as string} onChange={(e) => (set as (s: string) => void)(e.target.value)} /></label>)}</div>
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[#e3e8ef] bg-white p-6"><div dangerouslySetInnerHTML={{ __html: html }} />
      <button className={outline} onClick={async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([`${name}\n${title}\n${phone} · ${email}`], { type: 'text/plain' }) })]); } catch { await navigator.clipboard.writeText(html); } setCopied(true); setTimeout(() => setCopied(false), 2500); }}>{copied ? 'Copied — paste into Gmail or Outlook settings' : 'Copy signature'}</button></div>
  </div>;
}

export function BrandPage() {
  useEffect(() => { document.title = 'DROP Brand Identity — Ride Smart. Go Further.'; }, []);
  const icons: IconName[] = ['car', 'box', 'star', 'pin', 'shield', 'clock', 'wallet', 'people', 'phone', 'user', 'mail', 'building', 'file', 'upload', 'check', 'arrow'];
  const h2 = 'font-display text-3xl font-extrabold tracking-[-1px] text-navy md:text-[40px]';
  const eyebrow = 'mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[1.6px] text-orange-dark';
  const Eyebrow = ({ children }: { children: React.ReactNode }) => <p className={eyebrow}><span className="h-2 w-2 rotate-45 rounded-[2px] bg-orange" />{children}</p>;

  return <div className="min-h-screen bg-white text-navy">
    <header className="sticky top-0 z-30 border-b border-[#e3e8ef] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between gap-6 px-6">
        <a href="/" className="flex items-center gap-3"><img src="/brand/drop-logo-horizontal-light.svg" alt="DROP" className="h-9" /><span className="hidden border-l border-[#e3e8ef] pl-3 text-sm font-semibold text-[#5b6b82] sm:block">Brand identity</span></a>
        <nav className="hidden gap-6 text-sm font-medium lg:flex">{SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} className="hover:text-orange-dark">{l}</a>)}</nav>
        <a className={`${limeButton} min-h-10 px-5`} href="/brand/drop-brand-assets.zip" download><Icon name="upload" size={16} className="rotate-180" />Brand kit</a>
      </div>
    </header>

    <section className="relative overflow-hidden bg-navy text-white">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M-40 520 C 360 520 520 300 860 300 S 1300 160 1500 90" fill="none" stroke="#FF6B00" strokeWidth="4" strokeLinecap="round" opacity=".9" /><circle cx="1500" cy="90" r="10" fill="#FF6B00" /></svg>
      <div className="relative mx-auto grid max-w-[1320px] items-center gap-12 px-6 py-20 lg:grid-cols-[1.1fr_1fr] lg:py-28">
        <div><Eyebrow>Brand identity · Version 1.0</Eyebrow><h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-[-2px] md:text-7xl">Ride Smart.<br /><span className="text-orange">Go Further.</span></h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-[#c9d3e3]">The official DROP identity: logo system, colour, typography, interface style and brand applications. Use this page and the brand kit whenever you create anything for DROP.</p>
          <div className="mt-8 flex flex-wrap gap-3"><a className={limeButton} href="/brand/drop-brand-assets.zip" download>Download brand kit (.zip)</a><a className="motion-button inline-flex min-h-12 items-center rounded-xl border border-white/25 px-6 text-sm font-semibold hover:bg-white/10" href="#logo">Explore the guidelines</a></div></div>
        <div className="rounded-3xl bg-white p-10 shadow-2xl"><img src="/brand/drop-logo-primary-light.svg" alt="DROP primary logo" className="mx-auto w-full max-w-md" /></div>
      </div>
    </section>

    <section className="mx-auto max-w-[1320px] px-6 py-20">
      <div className="grid gap-10 lg:grid-cols-3">
        {[['Who we are', 'DROP is a South African e-hailing and mobility technology brand: rides, deliveries and premium travel, built around the people who drive.'], ['What we promise', 'Smart, transparent travel. Fares shown upfront, R0 passenger platform commission, and drivers who share in what they build.'], ['How we feel', 'Modern, trustworthy, fast and human. Confident without shouting, premium without being exclusive.']].map(([t, d]) => <div key={t}><h3 className="font-display text-xl font-extrabold">{t}</h3><p className="mt-3 leading-7 text-[#5b6b82]">{d}</p></div>)}
      </div>
    </section>

    <section id="logo" className="scroll-mt-20 border-t border-[#e3e8ef] bg-grey">
      <div className="mx-auto max-w-[1320px] px-6 py-20">
        <Eyebrow>01 · Logo</Eyebrow><h2 className={h2}>A pin that carries you.</h2>
        <p className="mt-4 max-w-2xl leading-7 text-[#5b6b82]">The symbol joins a location pin and a car: where you are, and how you get there. The wordmark leans forward for momentum, and the O holds a smaller pin, the moment of drop-off. Every letter is drawn as a vector, so the logo looks the same everywhere.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{LOGOS.map((l) => <figure key={l.file} className={`brand-card flex flex-col rounded-2xl border p-5 ${l.dark ? 'border-transparent bg-navy text-white' : 'border-[#e3e8ef] bg-white'}`}>
          <div className="flex h-44 items-center justify-center"><img src={`/brand/${l.file}.svg`} alt={l.name} className="max-h-full max-w-[85%]" /></div>
          <figcaption className="mt-4 flex items-end justify-between gap-3"><span><b className="block text-sm">{l.name}</b><span className={`text-[12px] ${l.dark ? 'text-[#c9d3e3]' : 'text-[#5b6b82]'}`}>{l.use}</span></span><Download file={l.file} dark={l.dark} /></figcaption>
        </figure>)}</div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-[#e3e8ef] bg-white p-6"><h3 className="font-display text-lg font-extrabold">Clear space</h3><p className="mt-2 text-sm leading-6 text-[#5b6b82]">Keep space equal to the height of the O's pin (x) on every side. Nothing enters this zone.</p>
            <div className="mt-5 flex justify-center"><div className="relative border-2 border-dashed border-orange/60 p-6"><img src="/brand/drop-logo-horizontal-light.svg" alt="" className="h-12" /><span className="absolute left-1 top-1 text-[10px] font-bold text-orange-dark">x</span></div></div></div>
          <div className="rounded-2xl border border-[#e3e8ef] bg-white p-6"><h3 className="font-display text-lg font-extrabold">Minimum size</h3><p className="mt-2 text-sm leading-6 text-[#5b6b82]">Horizontal logo: 96 px / 25 mm wide. Symbol: 24 px / 6 mm. Below 24 px use the favicon (pin only).</p>
            <div className="mt-5 flex items-end justify-center gap-6"><img src="/brand/drop-logo-horizontal-light.svg" alt="" style={{ width: 96 }} /><img src="/brand/drop-symbol-light.svg" alt="" style={{ width: 24 }} /><img src="/favicon.svg" alt="" style={{ width: 16 }} /></div></div>
          <div className="rounded-2xl border border-[#e3e8ef] bg-white p-6"><h3 className="font-display text-lg font-extrabold">Don’t</h3>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-[11px] text-[#5b6b82]">
              {[['Stretch', { transform: 'scaleX(1.5)' }], ['Recolour', { filter: 'hue-rotate(140deg)' }], ['Add effects', { filter: 'drop-shadow(4px 4px 0 #f0f) blur(.6px)' }], ['Rotate', { transform: 'rotate(-14deg)' }], ['Low contrast', { opacity: 0.25 }], ['Busy photo', { background: 'repeating-linear-gradient(45deg,#f88 0 6px,#8cf 6px 12px)' }]].map(([l, st]) => <div key={l as string}><div className="flex h-14 items-center justify-center overflow-hidden rounded-lg bg-grey"><img src="/brand/drop-logo-horizontal-light.svg" alt="" className="h-6" style={st as React.CSSProperties} /></div><span className="mt-1 block"><b className="text-[#D93636]">✕</b> {l as string}</span></div>)}
            </div></div>
        </div>
      </div>
    </section>

    <section id="colour" className="mx-auto max-w-[1320px] scroll-mt-20 px-6 py-20">
      <Eyebrow>02 · Colour</Eyebrow><h2 className={h2}>Midnight Navy leads. Orange moves.</h2>
      <p className="mt-4 max-w-2xl leading-7 text-[#5b6b82]">Navy and white carry most of the page. Orange is the accent: one primary action, the pin, a highlight. Using it sparingly keeps it powerful.</p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{COLOURS.map((c) => <div key={c.hex} className="brand-card overflow-hidden rounded-2xl border border-[#e3e8ef] bg-white">
        <button className="flex h-40 w-full items-end justify-between p-5 text-left" style={{ background: c.hex, color: c.text }} onClick={() => navigator.clipboard?.writeText(c.hex)} title="Copy HEX"><b className="font-display text-xl">{c.name}</b><span className="text-sm font-bold">{c.ratio}</span></button>
        <dl className="grid grid-cols-[60px_1fr] gap-y-1 p-5 text-[13px]"><dt className="text-[#5b6b82]">HEX</dt><dd className="font-semibold">{c.hex}</dd><dt className="text-[#5b6b82]">RGB</dt><dd>{c.rgb}</dd><dt className="text-[#5b6b82]">CMYK</dt><dd>{c.cmyk}</dd><dd className="col-span-2 mt-2 text-[#5b6b82]">{c.role}</dd></dl>
      </div>)}</div>
      <div className="mt-6 flex h-4 overflow-hidden rounded-full" aria-label="Colour proportions"><span className="bg-navy" style={{ width: '45%' }} /><span className="bg-white ring-1 ring-inset ring-[#e3e8ef]" style={{ width: '30%' }} /><span className="bg-grey" style={{ width: '15%' }} /><span className="bg-orange" style={{ width: '10%' }} /></div>
      <h3 className="mt-12 font-display text-lg font-extrabold">Supporting tones</h3>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{SUPPORT.map(([n, h, r]) => <div key={h} className="text-[13px]"><span className="block h-16 rounded-xl border border-black/5" style={{ background: h }} /><b className="mt-2 block">{n}</b><span className="text-[#5b6b82]">{h} · {r}</span></div>)}</div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{[['White on Navy', '#071B3A', '#FFFFFF', '16.6 : 1 · AAA'], ['Navy on Orange', '#FF6B00', '#071B3A', '6.4 : 1 · AA'], ['Navy on Light Grey', '#F5F7FA', '#071B3A', '15.6 : 1 · AAA']].map(([l, bg, fg, r]) => <div key={l} className="flex items-center justify-between rounded-xl p-5" style={{ background: bg, color: fg, border: bg === '#F5F7FA' ? '1px solid #e3e8ef' : undefined }}><b>{l}</b><span className="text-sm">{r}</span></div>)}</div>
      <p className="mt-3 text-[13px] text-[#5b6b82]">White text on orange is only 2.9 : 1, so orange buttons use navy text. Use Orange 700 for orange text on white.</p>
    </section>

    <section id="type" className="scroll-mt-20 border-y border-[#e3e8ef] bg-grey">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-6 py-20 lg:grid-cols-2">
        <div><Eyebrow>03 · Typography</Eyebrow><h2 className={h2}>Bold headlines. Easy reading.</h2>
          <p className="mt-4 leading-7 text-[#5b6b82]"><b className="text-navy">Manrope</b> (ExtraBold 800, Bold 700) for headlines, numbers and the wordmark. <b className="text-navy">Inter</b> (Regular 400 to Semibold 600) for body copy, interfaces and forms. Both are free Google Fonts.</p>
          <div className="mt-8 grid grid-cols-2 gap-4"><div className="rounded-2xl bg-white p-6"><p className="font-display text-6xl font-extrabold">Aa</p><p className="mt-3 text-sm font-semibold">Manrope</p><p className="text-[12px] text-[#5b6b82]">Display · 700 / 800</p></div><div className="rounded-2xl bg-white p-6"><p className="text-6xl font-semibold">Aa</p><p className="mt-3 text-sm font-semibold">Inter</p><p className="text-[12px] text-[#5b6b82]">Text · 400 / 500 / 600</p></div></div></div>
        <div className="grid content-start gap-5 rounded-2xl bg-white p-8">{[['Display · 64/68 · Manrope 800', 'font-display text-5xl font-extrabold tracking-[-2px] md:text-[64px]', 'Go Further.'], ['H2 · 40/46 · Manrope 800', 'font-display text-[32px] font-extrabold tracking-[-1px] md:text-[40px]', 'Your ride, upfront.'], ['H3 · 22/30 · Manrope 800', 'font-display text-[22px] font-extrabold', 'Driver ownership'], ['Body · 16/28 · Inter 400', 'text-base leading-7 text-[#5b6b82]', 'See your fare before you book and understand exactly what you pay.'], ['Label · 12 · Inter 700 caps', 'text-[12px] font-bold uppercase tracking-[1.6px] text-orange-dark', 'Ride smart. Go further.']].map(([meta, cls, sample]) => <div key={meta} className="border-b border-[#eef1f5] pb-4 last:border-0"><p className="mb-1 text-[11px] text-[#8a97a8]">{meta}</p><p className={cls}>{sample}</p></div>)}</div>
      </div>
    </section>

    <section id="icons" className="mx-auto max-w-[1320px] scroll-mt-20 px-6 py-20">
      <Eyebrow>04 · Iconography</Eyebrow><h2 className={h2}>Simple lines, rounded ends.</h2>
      <p className="mt-4 max-w-2xl leading-7 text-[#5b6b82]">24 px grid, 1.6 px stroke, round caps and joins. Navy by default; orange only for an active or selected state.</p>
      <div className="mt-10 grid grid-cols-4 gap-3 sm:grid-cols-8">{icons.map((n, i) => <div key={n} className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border ${i === 3 ? 'border-orange bg-orange/10 text-orange-dark' : 'border-[#e3e8ef]'}`}><Icon name={n} size={28} /><span className="text-[11px] text-[#5b6b82]">{n}</span></div>)}</div>
    </section>

    <section id="ui" className="scroll-mt-20 bg-grey">
      <div className="mx-auto max-w-[1320px] px-6 py-20">
        <Eyebrow>05 · Interface</Eyebrow><h2 className={h2}>One system across web and apps.</h2>
        <p className="mt-4 max-w-2xl leading-7 text-[#5b6b82]">12 px corners on buttons and inputs, 16 to 24 px on cards. Soft shadows, 8 px spacing grid. One orange action per screen.</p>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <div className="grid content-start gap-4 rounded-2xl bg-white p-6"><h3 className="font-display font-extrabold">Buttons</h3><button className={limeButton}>Book a ride <Icon name="arrow" size={16} /></button><button className={button}>Get fare estimate</button><button className={outline}>Become a driver</button><p className="text-[12px] text-[#5b6b82]">Orange = the one primary action. Navy = standard. Outline = secondary.</p></div>
          <div className="grid content-start gap-4 rounded-2xl bg-white p-6"><h3 className="font-display font-extrabold">Booking card</h3>
            <div className="grid gap-2"><div className="flex items-center gap-3 rounded-xl bg-grey p-3 text-sm"><span className="h-2.5 w-2.5 rounded-full border-2 border-navy" />Cape Town City Centre</div><div className="flex items-center gap-3 rounded-xl bg-grey p-3 text-sm"><Icon name="pin" size={16} className="text-orange" />V&A Waterfront</div></div>
            <div className="flex items-center justify-between rounded-xl border-2 border-orange p-3"><span className="flex items-center gap-3 text-sm font-semibold"><Icon name="car" size={24} />Comfort<span className="text-[12px] font-normal text-[#5b6b82]">4 min</span></span><b>R 85</b></div>
            <button className={limeButton}>Confirm · R 85</button></div>
          <div className="grid content-start gap-4 rounded-2xl bg-white p-6"><h3 className="font-display font-extrabold">Status & feedback</h3>
            {[['Driver assigned', 'bg-[#e8f5ee] text-[#1E8E5A]'], ['Finding your driver', 'bg-orange/10 text-orange-dark'], ['Cancelled', 'bg-[#fdecec] text-[#D93636]']].map(([t, c]) => <span key={t} className={`w-fit rounded-full px-3 py-1 text-[12px] font-semibold ${c}`}>{t}</span>)}
            <div className="flex items-center gap-3 rounded-xl bg-navy p-4 text-sm text-white"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange text-navy"><Icon name="car" size={20} /></span>Thabo is 4 min away<b className="ml-auto text-orange">4′</b></div>
            <div className="flex items-center gap-3"><img src="/brand/drop-app-icon.svg" alt="Passenger app icon" className="h-16 w-16 rounded-2xl shadow" /><img src="/brand/drop-driver-app-icon.svg" alt="Driver app icon" className="h-16 w-16 rounded-2xl shadow" /><span className="text-[12px] text-[#5b6b82]">Passenger and Driver app icons</span></div></div>
        </div>
      </div>
    </section>

    <section id="apps" className="mx-auto max-w-[1320px] scroll-mt-20 px-6 py-20">
      <Eyebrow>06 · Applications</Eyebrow><h2 className={h2}>The brand in the real world.</h2>
      <p className="mt-4 max-w-2xl leading-7 text-[#5b6b82]">Ready-made artwork. Each piece downloads as a vector SVG for print, or as a PNG for screens. The orange route line is the brand's supporting graphic.</p>
      <h3 className="mt-12 font-display text-xl font-extrabold">Stationery</h3>
      <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Artwork title="Business card · front" size="85 × 55 mm" art="drop-business-card-front">{(r) => <M.BusinessCardFront ref={r} className="w-full max-w-sm rounded-xl shadow-lg" />}</Artwork>
        <Artwork title="Business card · back" size="85 × 55 mm" art="drop-business-card-back">{(r) => <M.BusinessCardBack ref={r} className="w-full max-w-sm rounded-xl shadow-lg" />}</Artwork>
        <Artwork title="Letterhead" size="A4 · 210 × 297 mm" art="drop-letterhead">{(r) => <M.Letterhead ref={r} className="h-72 w-auto shadow-lg" />}</Artwork>
      </div>
      <div className="mt-6 rounded-2xl border border-[#e3e8ef] bg-grey p-6"><h3 className="mb-5 font-display text-lg font-extrabold">Email signature</h3><Signature /></div>
      <h3 className="mt-14 font-display text-xl font-extrabold">Vehicles & uniform</h3>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><Artwork title="Vehicle livery · side view" size="White base, navy rocker panel, orange route stripe" art="drop-vehicle-livery">{(r) => <M.VehicleWrap ref={r} className="w-full" />}</Artwork></div>
        <Artwork title="Door sticker" size="600 × 400 mm · vinyl" art="drop-door-sticker">{(r) => <M.DoorSticker ref={r} className="w-full max-w-xs" />}</Artwork>
        <Artwork title="Driver polo shirt" size="Navy, orange collar trim, chest logo" art="drop-driver-uniform">{(r) => <M.Uniform ref={r} className="w-full max-w-xs" />}</Artwork>
        <Artwork title="Promotional poster" size="A1 / A2 / A3" art="drop-poster">{(r) => <M.Poster ref={r} className="h-80 w-auto shadow-lg" />}</Artwork>
        <Artwork title="Presentation title slide" size="16 : 9" art="drop-presentation-slide">{(r) => <M.PresentationSlide ref={r} className="w-full shadow-lg" />}</Artwork>
      </div>
      <h3 className="mt-14 font-display text-xl font-extrabold">Social & digital</h3>
      <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Artwork title="Profile image" size="1080 × 1080 · all platforms" art="drop-social-profile">{(r) => <M.SocialAvatar ref={r} className="w-48 rounded-full shadow-lg" />}</Artwork>
        <div className="lg:col-span-2"><Artwork title="Facebook cover" size="1640 × 624" art="drop-facebook-cover">{(r) => <M.FacebookCover ref={r} className="w-full rounded-lg shadow-lg" />}</Artwork></div>
        <Artwork title="Instagram post" size="1080 × 1350" art="drop-instagram-post">{(r) => <M.InstagramPost ref={r} className="h-80 w-auto rounded-lg shadow-lg" />}</Artwork>
        <div className="lg:col-span-2"><Artwork title="Digital advert" size="1200 × 628 · Facebook, LinkedIn, Google Display" art="drop-digital-ad">{(r) => <M.DigitalAd ref={r} className="w-full rounded-lg shadow-lg" />}</Artwork></div>
      </div>
    </section>

    <section id="voice" className="scroll-mt-20 bg-navy text-white">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-6 py-20 lg:grid-cols-2">
        <div><p className="mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[1.6px] text-orange"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-orange" />07 · Voice</p><h2 className="font-display text-3xl font-extrabold tracking-[-1px] md:text-[40px]">Clear. Confident. On your side.</h2>
          <p className="mt-4 leading-7 text-[#c9d3e3]">We talk like a capable friend who drives for a living: short sentences, plain words, real numbers. We never hide a fee or oversell.</p></div>
        <div className="grid gap-4">{[['Say', 'Your fare is R85. No passenger commission.', 'Avoid', 'Unbeatable low prices!!!'], ['Say', 'Thabo is 4 minutes away.', 'Avoid', 'Your driver will arrive shortly.'], ['Say', 'Drivers keep the fare, less one disclosed fee.', 'Avoid', 'Industry-leading driver earnings.']].map(([a, b, c, d]) => <div key={b} className="grid gap-3 rounded-2xl bg-white/5 p-5 sm:grid-cols-2"><p className="text-sm"><b className="text-orange">{a}</b><br />{b}</p><p className="text-sm text-[#8fa0b8]"><b>{c}</b><br /><s>{d}</s></p></div>)}</div>
      </div>
    </section>

    <section id="downloads" className="mx-auto max-w-[1320px] scroll-mt-20 px-6 py-20">
      <Eyebrow>08 · Downloads</Eyebrow><h2 className={h2}>The DROP brand kit.</h2>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {[['Complete brand kit', 'All logos (SVG + PNG), app icons, favicons.', '/brand/drop-brand-assets.zip', 'ZIP'], ['Favicon set', 'SVG, ICO and PNG favicons, 16 to 512 px.', '/favicon.svg', 'SVG'], ['App icons', 'Passenger and driver, 1024 px for App Store and Google Play.', '/brand/png/drop-app-icon-1024.png', 'PNG']].map(([t, d, href, kind]) => <a key={t} href={href} download className="brand-card group flex items-center justify-between gap-4 rounded-2xl border border-[#e3e8ef] p-6 hover:border-orange"><span><b className="block font-display text-lg font-extrabold">{t}</b><span className="text-sm text-[#5b6b82]">{d}</span></span><span className="rounded-lg bg-orange px-3 py-2 text-[12px] font-bold text-navy">{kind}</span></a>)}
      </div>
      <p className="mt-8 text-[13px] text-[#5b6b82]">Fonts: <a className="underline" href="https://fonts.google.com/specimen/Manrope" target="_blank" rel="noopener">Manrope</a> and <a className="underline" href="https://fonts.google.com/specimen/Inter" target="_blank" rel="noopener">Inter</a> (SIL Open Font License). Questions about using the DROP brand: {COMPANY.email}.</p>
    </section>

    <footer className="footer-dark text-white"><div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-4 px-6 py-10 text-[13px] text-[#c9d3e3]"><img src="/brand/drop-logo-horizontal-tagline-dark.svg" alt="DROP — Ride Smart. Go Further." className="h-12" /><span>DROP is a division of {COMPANY.parent}, registration number {COMPANY.registration}.</span><a href="/" className="font-semibold text-orange">Back to drop website →</a></div></footer>
  </div>;
}
