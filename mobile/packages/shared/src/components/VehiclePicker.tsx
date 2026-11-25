import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { api } from '../lib/api';
import { canDoSummary, eligibleRules, oldestYear, type VehicleCatalogue, type VehicleChoice } from '../lib/vehicles';
import { sideArt } from '../lib/vehicleImages';
import { colors, radius, space, type } from '../theme';
import { Chips, Field } from './ui';

let cached: Promise<VehicleCatalogue> | null = null;
export const loadVehicleCatalogue = () => (cached ||= api<VehicleCatalogue>('/vehicles/catalogue').catch((e) => { cached = null; throw e; }));
export function useVehicleCatalogue() {
  const [c, setC] = useState<VehicleCatalogue | null>(null);
  useEffect(() => { void loadVehicleCatalogue().then(setC).catch(() => undefined); }, []);
  return c;
}

/** Choose a vehicle: type with pictures, make and model from the South African list (or "not listed"), year, colour, plate. */
export function VehiclePicker({ value, onChange }: { value: VehicleChoice; onChange: (v: VehicleChoice) => void }) {
  const c = useVehicleCatalogue();
  const [other, setOther] = useState(false);
  const set = (patch: Partial<VehicleChoice>) => onChange({ ...value, ...patch });
  const models = useMemo(() => (c ? c.models.filter((m) => m.type === value.type) : []), [c, value.type]);
  if (!c) return <Text style={type.small}>Loading the vehicle list…</Text>;
  const t = c.types.find((x) => x.key === value.type);
  const makes = [...new Set(models.map((m) => m.make))].sort();
  const seats = value.catalogueId ? (c.models.find((m) => m.id === value.catalogueId)?.seats || 0) : value.seats || t?.seats || 0;
  const year = Number(value.year);
  const can = t && /^\d{4}$/.test(value.year) ? eligibleRules(c, t.key, year, seats) : null;
  return <View>
    <Text style={[type.body, { fontWeight: '700', marginBottom: space(2) }]}>Type of vehicle</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>{c.types.map((x) => {
      const on = x.key === value.type; const a = sideArt(x.key);
      return <Pressable key={x.key} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={x.label}
        onPress={() => { setOther(false); onChange({ type: x.key, catalogueId: '', make: '', model: '', seats: 0, year: value.year, colour: value.colour, plate: value.plate }); }}
        style={{ width: '48%', alignItems: 'center', padding: space(2), borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.navy : colors.line, backgroundColor: on ? '#EEF2F7' : colors.white }}>
        <Image source={a.image} style={{ width: 96, height: (96 * a.height) / a.width }} accessibilityIgnoresInvertColors />
        <Text style={[type.small, { color: colors.navy, fontWeight: '700', textAlign: 'center' }]}>{x.label}</Text>
      </Pressable>;
    })}</View>
    {t && <View style={{ marginTop: space(4) }}>
      <Text style={[type.small, { marginBottom: space(2) }]}>{t.blurb}</Text>
      {!other ? <>
        <Text style={[type.body, { fontWeight: '700' }]}>Make</Text>
        <Chips label="Make" options={makes} selected={value.make ? [value.make] : []} onToggle={(m) => set({ make: m, model: '', catalogueId: '' })} />
        {value.make ? <>
          <Text style={[type.body, { fontWeight: '700' }]}>Model</Text>
          <Chips label="Model" options={models.filter((m) => m.make === value.make).map((m) => m.id)} selected={value.catalogueId ? [value.catalogueId] : []}
            render={(id) => { const m = c.models.find((x) => x.id === id)!; return m.type === 'minibus' || m.type === 'mpv' ? `${m.model} (${m.seats})` : m.model; }}
            onToggle={(id) => { const m = c.models.find((x) => x.id === id)!; set({ catalogueId: id, model: m.model, seats: m.seats }); }} />
        </> : null}
        <Pressable accessibilityRole="button" onPress={() => { setOther(true); set({ catalogueId: '', make: '', model: '' }); }}><Text style={[type.small, { color: colors.navy, fontWeight: '700', textDecorationLine: 'underline', marginBottom: space(3) }]}>My vehicle isn’t listed</Text></Pressable>
      </> : <>
        <Field label="Make" value={value.make} onChangeText={(v) => set({ make: v })} autoCapitalize="words" />
        <Field label="Model" value={value.model} onChangeText={(v) => set({ model: v })} autoCapitalize="words" />
        <Field label="Passenger seats" value={String(value.seats || t.seats)} onChangeText={(v) => set({ seats: Number(v.replace(/\D/g, '')) || 0 })} keyboardType="number-pad" maxLength={2} hint="Unlisted vehicles are checked by compliance before you can drive." />
        <Pressable accessibilityRole="button" onPress={() => { setOther(false); set({ make: '', model: '' }); }}><Text style={[type.small, { color: colors.navy, fontWeight: '700', textDecorationLine: 'underline', marginBottom: space(3) }]}>Choose from the list instead</Text></Pressable>
      </>}
      <Field label={`Model year (${oldestYear(c, t.key)} or newer)`} value={value.year} onChangeText={(v) => set({ year: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={4} placeholder={String(c.year - 2)} />
      <Field label="Colour" value={value.colour} onChangeText={(v) => set({ colour: v })} autoCapitalize="words" />
      <Field label="Registration number" value={value.plate} onChangeText={(v) => set({ plate: v.toUpperCase() })} autoCapitalize="characters" autoCorrect={false} placeholder="CA 123-456" />
      {can && <View accessibilityLiveRegion="polite" style={{ padding: space(3), borderRadius: radius.md, backgroundColor: can.length ? colors.successSoft : colors.dangerSoft, marginTop: space(2) }}>
        <Text style={[type.small, { color: can.length ? colors.success : colors.danger, fontWeight: '600' }]}>{can.length ? `This vehicle can do: ${canDoSummary(can.map((r) => r.key))}` : `A ${year} ${t.label.toLowerCase()} is too old for DROP. ${oldestYear(c, t.key)} or newer is accepted.`}</Text>
      </View>}
    </View>}
  </View>;
}
