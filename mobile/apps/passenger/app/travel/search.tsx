import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, colors, space, type, Button, Card, Empty, ErrorText, Field, H2, Loading, P, Pill, Screen, Segmented, isIsoDate, money, sastToday, travelDate, type TravelResult, type TravelSelection } from '@drop/shared';
import { FillBar } from '../../lib/FillBar';

type Mode = 'Any' | 'Flight' | 'Bus';
interface Place { code: string; name: string }

function Suggest({ value, places, onPick }: { value: string; places: Place[]; onPick: (v: string) => void }) {
  const q = value.trim().toLowerCase();
  const hits = q.length < 1 ? [] : places.filter((p) => (p.name.toLowerCase().includes(q) || p.code.toLowerCase() === q) && p.name.toLowerCase() !== q).slice(0, 4);
  if (!hits.length) return null;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: -space(1), marginBottom: space(3) }}>
    {hits.map((p) => <Pressable key={p.code} accessibilityRole="button" onPress={() => onPick(p.name)} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}><Text style={type.small}>{p.name} ({p.code})</Text></Pressable>)}
  </View>;
}

export default function TravelSearch() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [mode, setMode] = useState<Mode>('Any');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDeparture] = useState('');
  const [returnDate, setReturn] = useState('');
  const [oneWay, setOneWay] = useState(false);
  const [travellers, setTravellers] = useState('1');
  const [results, setResults] = useState<TravelResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState<'idle' | 'sent'>('idle');
  useEffect(() => { api<{ places: Place[] }>('/travel/places').then((r) => setPlaces(r.places)).catch(() => undefined); }, []);
  const count = Math.max(1, Math.min(20, Number(travellers) || 1));

  async function search(dep = departureDate) {
    setError(''); setInterest('idle');
    if (origin.trim().length < 2 || destination.trim().length < 2) { setError('Enter where you’re travelling from and to.'); return; }
    if (!isIsoDate(dep) || dep <= sastToday()) { setError('Enter a departure date in the future, as YYYY-MM-DD.'); return; }
    if (!oneWay && returnDate && (!isIsoDate(returnDate) || returnDate <= dep)) { setError('The return date must be after the departure date (YYYY-MM-DD).'); return; }
    setBusy(true);
    try {
      const p = new URLSearchParams({ origin, destination, departureDate: dep, travellers: String(count) });
      if (mode !== 'Any') p.set('type', mode === 'Flight' ? 'flight' : 'bus');
      if (!oneWay && returnDate) p.set('returnDate', returnDate);
      setResults((await api<{ results: TravelResult[] }>(`/travel/search?${p}`)).results);
    } catch (e) { setError((e as Error).message); setResults(null); } finally { setBusy(false); }
  }
  async function notifyMe() {
    try { await api('/travel/interest', { body: { type: mode === 'Bus' ? 'bus' : 'flight', origin, destination, departureDate, returnDate: oneWay ? undefined : returnDate || undefined, travellers: count } }); setInterest('sent'); }
    catch (e) { setError((e as Error).message); }
  }
  const join = (r: TravelResult) => {
    const g = r.group; const n = r.newGroup;
    const sel: TravelSelection = {
      routeId: r.route.id, departureDate, returnDate: oneWay ? '' : returnDate, travellers: count, international: r.route.international,
      price: g?.pricePerPerson ?? n?.pricePerPerson ?? 0, depositPct: g?.depositPct ?? n?.depositPct ?? 0,
      summary: `${r.route.typeLabel} · ${r.route.originName} → ${r.route.destinationName} · ${travelDate(departureDate)}${!oneWay && returnDate ? ` – ${travelDate(returnDate)}` : ''}`,
    };
    router.push({ pathname: '/travel/join', params: { sel: JSON.stringify(sel) } });
  };

  return <Screen>
    <Segmented label="Travel by" options={['Any', 'Flight', 'Bus'] as Mode[]} value={mode} onChange={setMode} />
    <Field label="From" value={origin} onChangeText={setOrigin} placeholder="City or airport" autoCapitalize="words" />
    <Suggest value={origin} places={places} onPick={setOrigin} />
    <Field label="To" value={destination} onChangeText={setDestination} placeholder="City or airport" autoCapitalize="words" />
    <Suggest value={destination} places={places} onPick={setDestination} />
    <Field label="Departure date (YYYY-MM-DD)" value={departureDate} onChangeText={setDeparture} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2027-01-12" />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(2) }}><Text style={type.body}>One way</Text><Switch value={oneWay} onValueChange={setOneWay} accessibilityLabel="One way" /></View>
    {!oneWay && <Field label="Return date (YYYY-MM-DD)" value={returnDate} onChangeText={setReturn} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2027-01-19" />}
    <Field label="Travellers" value={travellers} onChangeText={setTravellers} keyboardType="number-pad" maxLength={2} />
    <ErrorText>{error}</ErrorText>
    <Button title="Find groups" icon="search" busy={busy} onPress={() => void search()} />

    {busy && !results && <Loading label="Searching…" />}
    {results && results.length === 0 && <Card tone="soft" style={{ marginTop: space(4) }}>
      <P>We don’t run group trips on this route yet. Tell us you’re interested and we’ll let you know when a group opens.</P>
      {interest === 'sent' ? <Text style={[type.body, { color: colors.success, fontWeight: '700', marginTop: space(2) }]}>Thanks, we’ve noted your interest.</Text> : <Button variant="outline" title="Notify me when a group opens" onPress={() => void notifyMe()} />}
    </Card>}
    {results?.map((r) => {
      const g = r.group; const n = r.newGroup;
      const price = g?.pricePerPerson ?? n?.pricePerPerson ?? 0;
      const usd = g?.pricePerPersonUsd ?? n?.pricePerPersonUsd ?? null;
      const canJoin = (g ? g.joinable && g.seatsLeft >= count : !!n) && r.fits;
      return <Card key={r.route.id} style={{ marginTop: space(4) }}>
        <Text style={[type.small, { fontWeight: '700', textTransform: 'uppercase' }]}>{r.route.typeLabel} · {r.route.partner}{r.route.international ? ' · International' : ''}</Text>
        <H2>{r.route.originName} → {r.route.destinationName}</H2>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2) }}><Text style={[type.h1, { fontSize: 24 }]}>{money(price)}</Text><Text style={type.small}>per person{usd ? ` (≈ US$${usd})` : ''}</Text></View>
        {g ? <FillBar paid={g.paidSeats} capacity={g.capacity} minimum={g.minimum} />
          : n && <P muted style={{ marginVertical: space(2) }}>No group on this date yet. Be the first: a group of {n.capacity} opens when you join, and goes ahead once {n.minimum} travellers have paid.</P>}
        <P muted>{r.tooLate ? 'Too close to departure to fill a group.' : `Fills by ${new Date((g?.deadline || n?.deadline) as string).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} · ${g?.daysLeft ?? n?.daysLeft} days left · ${g?.depositPct ?? n?.depositPct}% deposit option`}{!r.fits ? ' · not enough seats for your party' : ''}</P>
        <View style={{ marginTop: space(3) }}><Button title="Join this group" disabled={!canJoin} onPress={() => join(r)} /></View>
        {r.alternatives.length > 0 && <View style={{ marginTop: space(3) }}>
          <Text style={[type.small, { fontWeight: '700' }]}>Other dates on this route</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(2) }}>{r.alternatives.map((a) => <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Search ${travelDate(a.departureDate)}`} onPress={() => { setDeparture(a.departureDate); setReturn(a.returnDate || ''); setOneWay(!a.returnDate); void search(a.departureDate); }}>
            <Pill label={`${travelDate(a.departureDate)} · ${a.paidSeats}/${a.capacity}`} tone="brand" /></Pressable>)}</View>
        </View>}
      </Card>;
    })}
    {results && results.length > 0 && <Empty icon="shield-checkmark-outline" text="Your money is held in a separate account for the group until it’s confirmed. No group, no charge." />}
  </Screen>;
}
