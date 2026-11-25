import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  api, useAuth, colors, space, type, Banner, Button, Card, Chips, ErrorText, Field, H2, P, Screen, Segmented,
  DAY_NAMES, GRADES, HANDOVER, RELATIONSHIP, firstOfNextMonth, isTime, money, tomorrowSast, type Plan, type PlanPricing, type PlanRider, API_ORIGIN,
} from '@drop/shared';
import { payPlan } from '../../lib/payPlan';

export default function NewPlan() {
  const { user } = useAuth();
  const scholar = user?.role !== 'business';
  const [school, setSchool] = useState('');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [outTime, setOutTime] = useState(scholar ? '06:45' : '07:00');
  const [twoWay, setTwoWay] = useState(true);
  const [returnTime, setReturnTime] = useState(scholar ? '14:30' : '17:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = useState(firstOfNextMonth());
  const [category, setCategory] = useState<'Comfort' | 'XL'>('Comfort');
  const [riders, setRiders] = useState<PlanRider[]>([{ name: '', grade: scholar ? 'Grade 1' : undefined, notes: '' }]);
  const [g, setG] = useState({ relationship: RELATIONSHIP[0], emergencyName: '', emergencyPhone: '', handover: HANDOVER[0], consent: false });
  const [quote, setQuote] = useState<PlanPricing | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const max = category === 'XL' ? 6 : 4;

  const body = useMemo(() => ({ kind: scholar ? 'scholar' : 'staff', category, pickup, destination, school, outTime, returnTime: twoWay ? returnTime : undefined, days, startDate }),
    [scholar, category, pickup, destination, school, outTime, returnTime, twoWay, days, startDate]);
  useEffect(() => {
    if (pickup.trim().length < 3 || destination.trim().length < 3 || !isTime(outTime) || (twoWay && !isTime(returnTime)) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { setQuote(null); return; }
    const t = setTimeout(() => {
      api<{ pricing: PlanPricing }>('/plans/quote', { body: { ...body, riderCount: riders.length } })
        .then((r) => { setQuote(r.pricing); setQuoteError(''); }).catch((e) => { setQuote(null); setQuoteError((e as Error).message); });
    }, 450);
    return () => clearTimeout(t);
  }, [body, riders.length, pickup, destination, outTime, returnTime, twoWay, startDate]);

  const setRider = (i: number, patch: Partial<PlanRider>) => setRiders(riders.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function submit() {
    setError(''); setBusy(true);
    try {
      const r = await api<{ plan: Plan }>('/plans', { body: { ...body, riders: riders.map((x) => ({ ...x, name: x.name.trim() })), ...(scholar && { guardian: g }) } });
      if (r.plan.status === 'awaiting_payment') await payPlan(r.plan.id);
      router.replace(`/plan/${r.plan.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const legal = (path: string) => () => void Linking.openURL(`${API_ORIGIN}${path}`);

  return <Screen>
    <H2>Route</H2>
    {scholar && <Field label="School name" value={school} onChangeText={setSchool} placeholder="e.g. Sea Point Primary" />}
    <Field label={scholar ? 'Home pickup address' : 'Pickup point'} hint={scholar ? 'Shared with the driver only once they accept the plan.' : undefined} value={pickup} onChangeText={setPickup} autoComplete="street-address" />
    <Field label={scholar ? 'School address' : 'Workplace address'} value={destination} onChangeText={setDestination} />
    <Field label={scholar ? 'Morning pickup time (24-hour, e.g. 06:45)' : 'Pickup time (24-hour)'} value={outTime} onChangeText={setOutTime} keyboardType="numbers-and-punctuation" maxLength={5} error={outTime && !isTime(outTime) ? 'Use HH:MM, e.g. 06:45' : undefined} />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: space(2) }}>
      <Text style={type.body}>{scholar ? 'Afternoon trip home' : 'Return trip'}</Text><Switch value={twoWay} onValueChange={setTwoWay} accessibilityLabel="Include the return trip" />
    </View>
    {twoWay && <Field label={scholar ? 'Afternoon pickup time at school' : 'Return pickup time'} value={returnTime} onChangeText={setReturnTime} keyboardType="numbers-and-punctuation" maxLength={5} error={returnTime && !isTime(returnTime) ? 'Use HH:MM, e.g. 14:30' : undefined} />}
    <Text style={[type.body, { marginTop: space(2) }]}>Days</Text>
    <Chips label="Days of the week" options={[1, 2, 3, 4, 5, 6, 7]} selected={days} render={(d) => DAY_NAMES[d - 1]} onToggle={(d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())} />
    <Field label="Start date (YYYY-MM-DD)" hint={`Runs to the end of that month. Earliest ${tomorrowSast()}.`} value={startDate} onChangeText={setStartDate} keyboardType="numbers-and-punctuation" maxLength={10} />
    <Segmented label="Vehicle" options={['Comfort', 'XL'] as const as unknown as ('Comfort' | 'XL')[]} value={category} onChange={(v) => { setCategory(v); setRiders(riders.slice(0, v === 'XL' ? 6 : 4)); }} />
    <P muted>Comfort takes up to 4, XL up to 6.</P>

    <H2>{scholar ? 'Learners' : 'Staff members'}</H2>
    {riders.map((r, i) => <Card key={i} tone="soft">
      <Field label={scholar ? `Learner ${i + 1} first name` : `Staff member ${i + 1} name`} value={r.name} onChangeText={(v) => setRider(i, { name: v })} />
      {scholar ? <><Text style={type.small}>Grade</Text><Chips label={`Learner ${i + 1} grade`} options={GRADES} selected={[r.grade || 'Grade 1']} render={(x) => x.replace('Grade ', 'Gr ')} onToggle={(v) => setRider(i, { grade: v })} /></>
        : <Field label="Phone (optional)" value={r.phone || ''} onChangeText={(v) => setRider(i, { phone: v })} keyboardType="phone-pad" />}
      <Field label="Notes for the driver (optional)" value={r.notes || ''} onChangeText={(v) => setRider(i, { notes: v })} maxLength={200} placeholder={scholar ? 'e.g. booster seat, asthma pump in bag' : ''} />
      {riders.length > 1 && <Button title="Remove" variant="ghost" icon="trash-outline" onPress={() => setRiders(riders.filter((_, j) => j !== i))} />}
    </Card>)}
    {riders.length < max && <Button title={scholar ? 'Add learner' : 'Add staff member'} variant="outline" icon="add" onPress={() => setRiders([...riders, { name: '', grade: scholar ? 'Grade 1' : undefined, notes: '' }])} />}
    {scholar && <P muted>If a learner needs a car seat or booster, please provide it: the driver can’t take a child who needs one without it.</P>}

    {scholar && <>
      <H2>Parent or guardian</H2>
      <Text style={type.small}>Your relationship to the learner(s)</Text>
      <Chips label="Relationship" options={RELATIONSHIP} selected={[g.relationship]} onToggle={(v) => setG({ ...g, relationship: v })} />
      <Text style={type.small}>At drop-off</Text>
      <Chips label="Handover" options={HANDOVER} selected={[g.handover]} onToggle={(v) => setG({ ...g, handover: v })} />
      <Field label="Second emergency contact (name)" value={g.emergencyName} onChangeText={(v) => setG({ ...g, emergencyName: v })} />
      <Field label="Second emergency contact (phone)" value={g.emergencyPhone} onChangeText={(v) => setG({ ...g, emergencyPhone: v })} keyboardType="phone-pad" />
      <Card tone="orange">
        <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'flex-start' }}>
          <Switch value={g.consent} onValueChange={(v) => setG({ ...g, consent: v })} accessibilityLabel="Parental consent" />
          <Text style={[type.small, { flex: 1, color: colors.text }]}>I am the parent or legal guardian of the learner(s), or have parental responsibility for them. I consent to DROP processing their first names, grades, school, addresses, notes and live trip location to arrange this transport, and sharing these with the assigned driver. I can withdraw consent by cancelling the plan.</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space(4), marginTop: space(2) }}>
          <Pressable onPress={legal('/legal/privacy#children')}><Text style={[type.small, { textDecorationLine: 'underline' }]}>Privacy policy</Text></Pressable>
          <Pressable onPress={legal('/legal/scholar-transport')}><Text style={[type.small, { textDecorationLine: 'underline' }]}>Scholar transport terms</Text></Pressable>
        </View>
      </Card>
    </>}

    <Card tone="soft">
      {quote ? <>
        <Text style={type.h2}>{money(quote.total)}</Text>
        <P>{quote.trips} trips over {quote.dates.length} days · {money(quote.perDay)} a day</P>
        <P muted>{Math.round(quote.discountRate * 100)}% below on-demand fares (you save {money(quote.saving)}). Public holidays excluded. Skipped days and trips that don’t run are refunded when the month closes.</P>
      </> : <P muted>{quoteError || 'Enter the route and times to see the monthly price.'}</P>}
    </Card>
    {!scholar && <Banner text="Staff plans are added to your monthly business invoice. You pay only for trips driven." />}
    <ErrorText>{error}</ErrorText>
    <Button title={scholar ? 'Continue to payment' : 'Create plan'} icon="arrow-forward" busy={busy} disabled={!quote || (scholar && !g.consent) || riders.some((r) => r.name.trim().length < 2)} onPress={submit} />
  </Screen>;
}
