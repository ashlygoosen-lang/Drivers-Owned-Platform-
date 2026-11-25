import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { sideView } from '../lib/vehicleArt';
import { input, Field } from './ui';

/** The vehicle catalogue from /api/vehicles/catalogue (one source of truth with the server). */
export interface Catalogue {
  types: { key: string; label: string; seats: number; blurb: string; serves: { key: string; label: string; maxAge: number }[] }[];
  models: { id: string; make: string; model: string; type: string; seats: number }[];
  makes: string[];
  rules: { key: string; label: string; types: Record<string, number>; minSeats?: number }[];
  operators: { bus: string[]; flightDomestic: string[]; flightInternational: string[] };
  year: number;
}
export interface VehicleChoice { type: string; catalogueId: string; make: string; model: string; seats: number; year: string; colour: string; plate: string }
export const emptyVehicle = (): VehicleChoice => ({ type: '', catalogueId: '', make: '', model: '', seats: 0, year: '', colour: '', plate: '' });

let cached: Promise<Catalogue> | null = null;
export const loadCatalogue = () => (cached ||= api<Catalogue>('/vehicles/catalogue').catch((e) => { cached = null; throw e; }));
export function useCatalogue() {
  const [c, setC] = useState<Catalogue | null>(null);
  useEffect(() => { void loadCatalogue().then(setC).catch(() => undefined); }, []);
  return c;
}

/** What a vehicle may do, the same rules the server applies. */
export function eligible(c: Catalogue, type: string, year: number, seats: number) {
  const age = c.year - year;
  return c.rules.filter((r) => r.types[type] != null && age <= r.types[type] && (!r.minSeats || seats >= r.minSeats));
}

/** "Ride: Go, Comfort · Delivery: Documents, Bakkie" from rule keys like "Ride:Go". */
export function canDoSummary(keys: string[]) {
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const [service, category] = k.split(':');
    const g = category === 'Minibus' ? 'School and staff transport' : service;
    groups.set(g, [...(groups.get(g) || []), category === 'Bakkie' ? 'Bakkie (bulky goods)' : category]);
  }
  return [...groups].map(([g, cats]) => `${g}: ${cats.join(', ')}`).join(' · ');
}

/** The body sent to the API (catalogued model, or "other" with type/make/model/seats). */
export const vehicleBody = (v: VehicleChoice) => (v.catalogueId
  ? { catalogueId: v.catalogueId, year: Number(v.year), colour: v.colour, plate: v.plate }
  : { type: v.type, make: v.make, model: v.model, seats: v.seats, year: Number(v.year), colour: v.colour, plate: v.plate });

/** Choose a vehicle: type (with pictures) → make and model from the list, or "other" → year, colour, plate. */
export function VehiclePicker({ value, onChange }: { value: VehicleChoice; onChange: (v: VehicleChoice) => void }) {
  const c = useCatalogue();
  const set = (patch: Partial<VehicleChoice>) => onChange({ ...value, ...patch });
  const models = useMemo(() => (c ? c.models.filter((m) => m.type === value.type) : []), [c, value.type]);
  const makes = useMemo(() => [...new Set(models.map((m) => m.make))].sort(), [models]);
  const [otherMode, setOtherMode] = useState(false);
  if (!c) return <p className="text-sm text-[#536175]">Loading vehicle list…</p>;
  const type = c.types.find((t) => t.key === value.type);
  const oldest = type ? c.year - Math.max(...type.serves.map((s) => s.maxAge)) : c.year - 15;
  const years = Array.from({ length: c.year + 1 - oldest + 1 }, (_, i) => c.year + 1 - i);
  const seats = value.catalogueId ? (c.models.find((m) => m.id === value.catalogueId)?.seats || 0) : value.seats || type?.seats || 0;
  const can = type && value.year ? eligible(c, type.key, Number(value.year), seats) : [];
  return <div className="grid gap-4">
    <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold">Type of vehicle</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{c.types.map((t) => <button type="button" key={t.key} aria-pressed={value.type === t.key}
        onClick={() => { setOtherMode(false); onChange({ ...emptyVehicle(), type: t.key, year: value.year, colour: value.colour, plate: value.plate }); }}
        className={`grid justify-items-center gap-1 rounded-xl border p-3 text-center transition ${value.type === t.key ? 'border-navy bg-[#eef2f7] ring-2 ring-navy/20' : 'border-[#d2dae4] hover:border-navy'}`}>
        <span aria-hidden dangerouslySetInnerHTML={{ __html: sideView(t.key, { width: 92 }) }} />
        <span className="text-[13px] font-semibold text-navy">{t.label}</span>
        <span className="text-[11px] leading-4 text-[#5b6b82]">{t.blurb}</span>
      </button>)}</div>
    </fieldset>
    {type && <>
      {!otherMode ? <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Make"><select className={input} required value={value.make} onChange={(e) => set({ make: e.target.value, model: '', catalogueId: '' })}><option value="">Choose…</option>{makes.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Model"><select className={input} required disabled={!value.make} value={value.catalogueId} onChange={(e) => { const m = c.models.find((x) => x.id === e.target.value); set({ catalogueId: e.target.value, model: m?.model || '', seats: m?.seats || 0 }); }}>
          <option value="">Choose…</option>{models.filter((m) => m.make === value.make).map((m) => <option key={m.id} value={m.id}>{m.model}{m.type === 'minibus' || m.type === 'mpv' ? ` (${m.seats} seats)` : ''}</option>)}</select></Field>
        <button type="button" className="justify-self-start text-[13px] font-semibold text-navy underline sm:col-span-2" onClick={() => { setOtherMode(true); set({ catalogueId: '', make: '', model: '' }); }}>My vehicle isn’t listed</button>
      </div> : <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Make"><input className={input} required list="vehicle-makes" value={value.make} onChange={(e) => set({ make: e.target.value, catalogueId: '' })} placeholder="e.g. Chery" /></Field>
        <datalist id="vehicle-makes">{c.makes.map((m) => <option key={m} value={m} />)}</datalist>
        <Field label="Model"><input className={input} required value={value.model} onChange={(e) => set({ model: e.target.value })} placeholder="e.g. Tiggo 4" /></Field>
        <Field label="Passenger seats"><input className={input} type="number" min={1} max={23} value={value.seats || type.seats} onChange={(e) => set({ seats: Number(e.target.value) })} /></Field>
        <p className="text-[12px] text-[#5b6b82] sm:col-span-3">Unlisted vehicles are checked by our compliance team against the same rules before you can drive. <button type="button" className="font-semibold underline" onClick={() => { setOtherMode(false); set({ make: '', model: '' }); }}>Choose from the list instead</button></p>
      </div>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Model year"><select className={input} required value={value.year} onChange={(e) => set({ year: e.target.value })}><option value="">Choose…</option>{years.map((y) => <option key={y}>{y}</option>)}</select></Field>
        <Field label="Colour"><input className={input} required minLength={3} value={value.colour} onChange={(e) => set({ colour: e.target.value })} placeholder="White" /></Field>
        <Field label="Registration number"><input className={input} required value={value.plate} onChange={(e) => set({ plate: e.target.value.toUpperCase() })} placeholder="CA 123-456" autoComplete="off" /></Field>
      </div>
      {value.year && <div className={`rounded-xl p-4 text-sm ${can.length ? 'bg-[#e8f5ee] text-[#17744a]' : 'bg-[#fdecec] text-[#b42828]'}`} role="status">
        {can.length ? <><b>This vehicle can do:</b> {canDoSummary(can.map((r) => r.key))}</>
          : <>A {value.year} {type.label.toLowerCase()} is too old for DROP. The newest rule allows {c.year - Math.max(...type.serves.map((s) => s.maxAge))} or newer.</>}
      </div>}
    </>}
  </div>;
}
