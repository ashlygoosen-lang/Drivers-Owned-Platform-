import { useMemo, useState } from 'react';
import { Linking, Pressable, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  api, colors, space, type, API_ORIGIN, Banner, Button, Card, Chips, ErrorText, Field, H2, P, Screen, Segmented,
  ageOn, isIsoDate, money, passengerProblem, sastToday, travelAmounts, type GroupBooking, type TravelPassenger, type TravelSelection,
} from '@drop/shared';
import { payGroupBooking } from '../../lib/payTravel';

const blank = (): TravelPassenger => ({ fullName: '', dateOfBirth: '', nationality: 'South African', passportNumber: '', passportExpiry: '' });
const RELATIONSHIP = ['Parent', 'Legal guardian', 'Family member with parental responsibility'] as const;

export default function JoinGroup() {
  const { sel: raw } = useLocalSearchParams<{ sel: string }>();
  const sel = useMemo(() => { try { return JSON.parse(String(raw)) as TravelSelection; } catch { return null; } }, [raw]);
  const [pax, setPax] = useState<TravelPassenger[]>(() => Array.from({ length: sel?.travellers || 1 }, blank));
  const [option, setOption] = useState<'Pay in full' | 'Pay a deposit'>('Pay in full');
  const [guardian, setGuardian] = useState({ name: '', relationship: RELATIONSHIP[0] as string, consent: false });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!sel) return <Screen><ErrorText>Something went wrong opening this group. Please search again.</ErrorText><Button title="Back to search" onPress={() => router.back()} /></Screen>;
  const deposit = sel.depositPct > 0 && sel.depositPct < 100;
  const a = travelAmounts(sel.price, pax.length, sel.depositPct, option === 'Pay a deposit' ? 'deposit' : 'full');
  const minors = pax.some((p) => isIsoDate(p.dateOfBirth) && ageOn(p.dateOfBirth, sel.departureDate) < 18);
  const setP = (i: number, patch: Partial<TravelPassenger>) => setPax((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const open = (path: string) => () => void Linking.openURL(`${API_ORIGIN}${path}`);

  async function submit() {
    setError('');
    const ctx = { international: sel!.international, departureDate: sel!.departureDate, travelUntil: sel!.returnDate || sel!.departureDate, today: sastToday() };
    const problem = pax.map((p, i) => passengerProblem(p, i, ctx)).find(Boolean);
    if (problem) { setError(problem); return; }
    if (minors && (guardian.name.trim().length < 3 || !guardian.consent)) { setError('Travellers under 18 need a parent or guardian’s name and consent.'); return; }
    if (!agree) { setError('Please accept the terms and cancellation policy.'); return; }
    setBusy(true);
    try {
      const r = await api<{ booking: GroupBooking }>('/travel/join', { body: {
        routeId: sel!.routeId, departureDate: sel!.departureDate, returnDate: sel!.returnDate || undefined, paymentOption: option === 'Pay a deposit' ? 'deposit' : 'full',
        passengers: pax.map((p) => ({ ...p, fullName: p.fullName.trim(), passportNumber: p.passportNumber?.trim() || undefined, passportExpiry: p.passportNumber?.trim() ? p.passportExpiry : undefined })),
        ...(minors && { guardian: { ...guardian, consent: true } }),
      } });
      await payGroupBooking(r.booking.id);
      router.replace(`/travel/${r.booking.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <Screen>
    <P muted>{sel.summary}</P>
    {pax.map((p, i) => {
      const minor = isIsoDate(p.dateOfBirth) && ageOn(p.dateOfBirth, sel.departureDate) < 18;
      return <Card key={i} style={{ marginTop: space(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><H2>Traveller {i + 1}</H2>{minor && <Text style={[type.small, { color: colors.orange, fontWeight: '700' }]}>Under 18</Text>}</View>
        <Field label="Full name, exactly as on passport or ID" value={p.fullName} onChangeText={(v) => setP(i, { fullName: v })} autoCapitalize="words" autoComplete={i ? 'off' : 'name'} />
        <Field label="Date of birth (YYYY-MM-DD)" value={p.dateOfBirth} onChangeText={(v) => setP(i, { dateOfBirth: v })} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="1990-04-02" />
        <Field label="Nationality" value={p.nationality} onChangeText={(v) => setP(i, { nationality: v })} />
        <Field label={sel.international ? 'Passport number' : 'Passport number (optional)'} hint="Encrypted, and shared only with the airline or coach operator for this trip." value={p.passportNumber} onChangeText={(v) => setP(i, { passportNumber: v.toUpperCase() })} autoCapitalize="characters" autoCorrect={false} autoComplete="off" />
        {(sel.international || !!p.passportNumber) && <Field label="Passport expiry (YYYY-MM-DD)" hint="Must be valid after you return; many countries need 6 months." value={p.passportExpiry} onChangeText={(v) => setP(i, { passportExpiry: v })} keyboardType="numbers-and-punctuation" maxLength={10} />}
        {pax.length > 1 && <Button variant="ghost" title="Remove traveller" onPress={() => setPax((xs) => xs.filter((_, j) => j !== i))} />}
      </Card>;
    })}
    {pax.length < 20 && <View style={{ marginTop: space(3) }}><Button variant="outline" icon="add" title="Add traveller" onPress={() => setPax((xs) => [...xs, blank()])} /></View>}

    {minors && <Card tone="orange" style={{ marginTop: space(4) }}>
      <H2>Parent or guardian consent</H2>
      <Field label="Parent or guardian full name" value={guardian.name} onChangeText={(v) => setGuardian({ ...guardian, name: v })} autoCapitalize="words" />
      <Text style={type.small}>Relationship</Text>
      <Chips label="Relationship" options={[...RELATIONSHIP] as string[]} selected={[guardian.relationship]} onToggle={(v) => setGuardian({ ...guardian, relationship: v })} />
      <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center', marginTop: space(2) }}>
        <Switch value={guardian.consent} onValueChange={(v) => setGuardian({ ...guardian, consent: v })} accessibilityLabel="Parent or guardian consent" />
        <Text style={[type.small, { flex: 1 }]}>I am the parent or legal guardian of the travellers under 18 and consent to DROP processing their information to book this trip (POPIA s 35). Travel documents and any consent affidavits for minors are my responsibility.</Text>
      </View>
    </Card>}

    <H2>Payment</H2>
    {deposit ? <Segmented label="Payment option" options={['Pay in full', 'Pay a deposit']} value={option} onChange={setOption} /> : null}
    <Card tone="soft">
      <Text style={type.body}>Total <Text style={{ fontWeight: '800' }}>{money(a.total)}</Text></Text>
      <Text style={type.body}>Pay now <Text style={{ fontWeight: '800' }}>{money(a.dueNow)}</Text></Text>
      {a.later > 0 && <Text style={type.small}>Balance of {money(a.later)} due by the group’s fill deadline. We remind you.</Text>}
    </Card>
    <Banner tone="info" icon="shield-checkmark" text="Your money is held in a separate account for this group and only paid to the airline or operator once the group is confirmed. If it doesn’t fill, you get a full refund. Cancelling is free until the fill deadline; after it the fee is 50%, and 100% once tickets are issued." />
    <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center', marginVertical: space(3) }}>
      <Switch value={agree} onValueChange={setAgree} accessibilityLabel="Accept the terms and cancellation policy" />
      <Text style={[type.small, { flex: 1 }]}>I agree to the <Text onPress={open('/legal/terms')} style={{ color: colors.navy, fontWeight: '700', textDecorationLine: 'underline' }}>Terms of Service</Text> and the <Text onPress={open('/legal/cancellations-refunds#group')} style={{ color: colors.navy, fontWeight: '700', textDecorationLine: 'underline' }}>group travel cancellation policy</Text>, and the traveller details match their passports or IDs.</Text>
    </View>
    <ErrorText>{error}</ErrorText>
    <Button title={`Hold seats and pay ${money(a.dueNow)}`} icon="card" busy={busy} onPress={() => void submit()} />
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ alignItems: 'center', padding: space(4) }}><Text style={type.small}>Back to search</Text></Pressable>
  </Screen>;
}
