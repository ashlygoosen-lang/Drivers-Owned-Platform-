import { useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { api, colors, space, type, Banner, Button, Card, ErrorText, H2, Loading, P, Screen, VehiclePicker, emptyVehicleChoice, sideArt, useAuth, useVehicleCatalogue, vehicleChoiceBody, VEHICLE_LABEL, type VehicleChoice, type VehicleProfile } from '@drop/shared';

function VehicleCard({ v, title, pending }: { v: VehicleProfile; title: string; pending?: boolean }) {
  const c = useVehicleCatalogue();
  const a = sideArt(v.type);
  return <Card tone={pending ? 'orange' : 'white'} style={{ marginBottom: space(3) }}>
    <Text style={[type.small, { fontWeight: '700', textTransform: 'uppercase' }]}>{title}</Text>
    <Image source={a.image} style={{ width: 180, height: (180 * a.height) / a.width, alignSelf: 'center', marginVertical: space(2) }} accessibilityIgnoresInvertColors />
    <H2>{v.make} {v.model}</H2>
    <P muted>{VEHICLE_LABEL[v.type]} · {v.year} · {v.colour} · {v.plate} · {v.seats} seat{v.seats === 1 ? '' : 's'}</P>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(2) }}>{v.categories.map((k) => <Text key={k} style={[type.small, { backgroundColor: '#EEF2F7', color: colors.navy, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }]}>{c?.rules.find((r) => r.key === k)?.label || k}</Text>)}</View>
    {pending && <P muted style={{ marginTop: space(2) }}>Waiting for compliance to check the new vehicle’s papers. You keep driving your current vehicle until then.</P>}
  </Card>;
}

/** The driver's vehicle, what it can do, and a change request. */
export default function MyVehicle() {
  const { user } = useAuth();
  const [data, setData] = useState<{ vehicle: VehicleProfile | null; legacy: string | null; pending: VehicleProfile | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<VehicleChoice>(emptyVehicleChoice);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const load = useCallback(async () => { try { setData(await api('/drivers/vehicle')); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  const approved = user?.driverStatus === 'approved';
  return <Screen onRefresh={load}>
    {done ? <Banner tone="success" text={done} /> : null}
    {data.vehicle ? <VehicleCard v={data.vehicle} title="Your vehicle" /> : <Card style={{ marginBottom: space(3) }}><P>{data.legacy ? `On file: ${data.legacy}` : 'No vehicle on file yet.'}</P><P muted>Choose your vehicle from the list so you get the trips it qualifies for, and riders see the right vehicle on the map.</P></Card>}
    {data.pending && <VehicleCard v={data.pending} title="New vehicle, waiting for approval" pending />}
    {!editing ? <Button variant="outline" title={data.vehicle || data.legacy ? 'Change vehicle' : 'Add your vehicle'} onPress={() => setEditing(true)} /> : <>
      <VehiclePicker value={v} onChange={setV} />
      {approved && <P muted style={{ marginTop: space(2) }}>You’re already approved, so compliance checks a new vehicle before it’s used. Upload its registration and insurance in Verification.</P>}
      <ErrorText>{error}</ErrorText>
      <Button title={approved ? 'Send for approval' : 'Save vehicle'} busy={busy} disabled={!v.type || !v.year || !v.plate} onPress={async () => {
        setBusy(true); setError('');
        try { const r = await api<{ pending: VehicleProfile | null }>('/drivers/vehicle', { method: 'PUT', body: vehicleChoiceBody(v) }); setDone(r.pending ? 'Sent to compliance for approval.' : 'Vehicle saved.'); setEditing(false); setV(emptyVehicleChoice()); await load(); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }} />
      <View style={{ height: space(2) }} /><Button variant="ghost" title="Cancel" onPress={() => setEditing(false)} />
    </>}
  </Screen>;
}
