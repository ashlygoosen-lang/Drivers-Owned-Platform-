import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  api, colors, space, type, Banner, Button, Card, Empty, ErrorText, Field, H1, H2, Loading, P, Pill, Screen,
  PLAN_STATUS, daysLabel, money, planDate, type Plan,
} from '@drop/shared';

interface Feed { eligibility: { scholar: boolean; missing: string[] }; offers: Plan[]; mine: Plan[] }

/** Monthly scholar and staff transport plans: take a month of trips, see who and where, release if you must. */
export default function DriverPlans() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState<{ id: string; reason: string } | null>(null);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setFeed(await api<Feed>('/drivers/plans')); setError(''); } catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const act = async (id: string, path: string, body: object) => {
    setBusy(id); setError('');
    try { await api(path, { body }); setReleasing(null); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  if (!feed) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  return <Screen onRefresh={load} refreshing={refreshing}>
    <H1>Monthly plans</H1>
    <P muted>Take a month of school runs or staff commutes. Each trip appears in Drive 45 minutes before pickup and pays out like any trip.</P>
    {!feed.eligibility.scholar && <Pressable onPress={() => router.push('/verification')}>
      <Banner tone="warn" icon="school" text={`To see school transport plans, upload and get approved: ${feed.eligibility.missing.map((m) => m.replace(/_/g, ' ')).join(', ')}. Tap to open Verification.`} />
    </Pressable>}
    <ErrorText>{error}</ErrorText>

    <H2>My plans</H2>
    {!feed.mine.length ? <Empty icon="calendar-outline" text="You have no monthly plans yet." /> : feed.mine.map((p) => <Card key={p.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
        <Text style={[type.body, { fontWeight: '700', flex: 1 }]}>{p.kindLabel}{p.owner ? ` · ${p.owner.name}` : ''}</Text>
        <Pill label={PLAN_STATUS[p.status] || p.status} tone={p.status === 'active' ? 'good' : 'warn'} />
      </View>
      <P muted>{p.ref} · {planDate(p.startDate)} – {planDate(p.endDate)} · {daysLabel(p.days)}</P>
      {p.legs.map((l) => <Text key={l.key} style={[type.body, { marginTop: space(1) }]}><Text style={{ fontWeight: '700' }}>{l.time}</Text> {l.label}{l.from ? `\n${l.from} → ${l.to}` : ''}</Text>)}
      <Text style={[type.body, { marginTop: space(2) }]}><Text style={{ fontWeight: '700' }}>{p.kind === 'scholar' ? 'Learners: ' : 'Passengers: '}</Text>{(p.riders || []).map((r) => `${r.name}${r.grade ? ` (${r.grade})` : ''}${r.notes ? ` — ${r.notes}` : ''}`).join('; ')}</Text>
      {p.guardian?.handover && <Text style={[type.body, { marginTop: space(1) }]}><Text style={{ fontWeight: '700' }}>Drop-off: </Text>{p.guardian.handover}</Text>}
      {p.guardian?.emergencyName && <Text style={type.small}>Emergency contact: {p.guardian.emergencyName} · {p.guardian.emergencyPhone}</Text>}
      {p.skipDates.length > 0 && <Text style={[type.small, { marginTop: space(1) }]}>No trips on: {p.skipDates.map(planDate).join(', ')}</Text>}
      {p.kind === 'scholar' && <Banner tone="info" icon="shield-checkmark" text="Never leave a learner alone where a handover is required. If no one is there, call the parent and the emergency contact and wait somewhere safe." />}
      {releasing?.id === p.id ? <>
        <Field label="Why can’t you continue? The customer is told we’re finding a new driver." value={releasing.reason} onChangeText={(reason) => setReleasing({ id: p.id, reason })} multiline />
        <Button title="Release plan" variant="danger" busy={busy === p.id} disabled={releasing.reason.trim().length < 3} onPress={() => act(p.id, `/drivers/plans/${p.id}/release`, { reason: releasing.reason.trim() })} />
        <Button title="Keep plan" variant="ghost" onPress={() => setReleasing(null)} />
      </> : <Button title="I can’t continue with this plan" variant="ghost" onPress={() => setReleasing({ id: p.id, reason: '' })} />}
    </Card>)}

    <H2>Looking for a driver</H2>
    {!feed.offers.length ? <Empty icon="search-outline" text="No plans near you right now. New plans also arrive in your inbox." /> : feed.offers.map((p) => <Card key={p.id} tone="soft">
      <Text style={[type.body, { fontWeight: '700' }]}>{p.kindLabel} · {p.riderCount} {p.kind === 'scholar' ? 'learner(s)' : 'passenger(s)'} · {p.category}</Text>
      {p.legs.map((l) => <Text key={l.key} style={type.body}><Text style={{ fontWeight: '700' }}>{l.time}</Text> {l.label}</Text>)}
      <P muted>{daysLabel(p.days)} · {planDate(p.startDate)} – {planDate(p.endDate)} · to {p.kind === 'scholar' ? p.school : p.destination}{p.distanceKm != null ? ` · pickup ${p.distanceKm} km away` : ''}</P>
      <Text style={[type.h2, { color: colors.navy }]}>{money(p.earnings || 0)}</Text>
      <P muted>your earnings for {p.pricing.trips} trips. Names and the home address are shown once you accept.</P>
      {p.clash && <Banner tone="danger" text="Overlaps the times of a plan you already drive." />}
      <Button title="Accept the month" icon="checkmark" busy={busy === p.id} disabled={p.clash} onPress={() => act(p.id, `/drivers/plans/${p.id}/accept`, {})} />
    </Card>)}
  </Screen>;
}
