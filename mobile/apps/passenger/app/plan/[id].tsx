import { useCallback, useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  api, space, type, Banner, Button, Card, Chips, ErrorText, H1, H2, Loading, P, Pill, Row, Screen,
  PLAN_STATUS, STATUS_LABEL, daysLabel, money, planDate, planIsLive, skippableDates, type Plan, type PlanTrip, type BookingStatus,
} from '@drop/shared';
import { payPlan } from '../../lib/payPlan';

export default function PlanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [trips, setTrips] = useState<PlanTrip[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [skip, setSkip] = useState<string[]>([]);
  const load = useCallback(async () => {
    try { const r = await api<{ plan: Plan; trips: PlanTrip[] }>(`/plans/${id}`); setPlan(r.plan); setTrips(r.trips); setError(''); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setError('');
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  if (!plan) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  const p = plan;
  const live = planIsLive(p);
  const canSkip = live ? skippableDates(p) : [];
  const upcomingSkips = p.skipDates.filter((d) => canSkip.includes(d) || Date.parse(`${d}T${p.legs[0].time}:00+02:00`) - Date.now() >= 12 * 3_600_000);
  const confirmCancel = () => Alert.alert('Cancel this plan?', p.status === 'awaiting_payment' ? 'Nothing has been charged.' : 'Trips stop 24 hours from now. Every trip that doesn’t run is refunded when the period closes.', [
    { text: 'Keep plan', style: 'cancel' },
    { text: 'Cancel plan', style: 'destructive', onPress: () => void run('cancel', () => api(`/plans/${p.id}/cancel`, { body: {} })) },
  ]);
  return <Screen onRefresh={load}>
    <Text style={type.small}>{p.ref} · {p.kindLabel}</Text>
    <H1>{p.kind === 'scholar' ? p.school : p.destination}</H1>
    <View style={{ flexDirection: 'row', gap: space(2), marginBottom: space(3) }}><Pill label={PLAN_STATUS[p.status] || p.status} tone={p.status === 'active' ? 'good' : live ? 'warn' : 'neutral'} /><Pill label={p.payment === 'Card' ? `Card · ${p.paymentStatus.replace(/_/g, ' ')}` : 'Invoiced'} /></View>
    <Card>
      <Row icon="calendar" title={`${planDate(p.startDate)} – ${planDate(p.endDate)}`} subtitle={`${daysLabel(p.days)} · ${p.category}`} />
      {p.legs.map((l) => <Row key={l.key} icon="time" title={`${l.time} · ${l.label}`} subtitle={`${l.from} → ${l.to}`} />)}
      <Row icon="people" title={p.kind === 'scholar' ? 'Learners' : 'Staff'} subtitle={(p.riders || []).map((r) => (r.grade ? `${r.name} (${r.grade})` : r.name)).join(', ')} />
      <Row icon="car" title="Driver" subtitle={p.driver ? `${p.driver.name}${p.driver.vehicle ? ` · ${p.driver.vehicle}` : ''}${p.driver.rating ? ` · ★ ${p.driver.rating}` : ''}` : 'Not confirmed yet. Each trip is offered to the nearest vetted driver until one accepts the month.'} />
      <Row icon="cash" title={money(p.pricing.total)} subtitle={`${p.pricing.trips} trips · ${money(p.pricing.perDay)} a day`} />
    </Card>
    {p.refundedAmount > 0 && <Banner tone="success" text={`${money(p.refundedAmount)} refunded to your card for unused trips.`} />}
    {p.cancelEffective && <Banner tone="warn" text={`Cancelled: no trips after ${new Date(p.cancelEffective).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Unused trips are refunded when the period closes.`} />}
    <ErrorText>{error}</ErrorText>
    {p.status === 'awaiting_payment' && <Button title={`Pay ${money(p.pricing.total)}`} icon="card" busy={busy === 'pay'} onPress={() => run('pay', () => payPlan(p.id))} />}

    {live && <>
      <H2>Skip days</H2>
      <P muted>Absent, or a school holiday? Skip a day at least 12 hours before the first pickup and it’s refunded.</P>
      {canSkip.length ? <>
        <Chips label="Days to skip" options={canSkip.slice(0, 31)} selected={skip} render={planDate} onToggle={(d) => setSkip(skip.includes(d) ? skip.filter((x) => x !== d) : [...skip, d])} />
        <Button title={skip.length ? `Skip ${skip.length} day${skip.length > 1 ? 's' : ''}` : 'Choose days to skip'} variant="outline" disabled={!skip.length} busy={busy === 'skip'}
          onPress={() => run('skip', async () => { for (const d of skip) await api(`/plans/${p.id}/skip`, { body: { date: d } }); setSkip([]); })} />
      </> : <P muted>No more days can be skipped in this period.</P>}
      {upcomingSkips.length > 0 && <>
        <Text style={[type.body, { marginTop: space(2) }]}>Skipped</Text>
        <Chips label="Skipped days, tap to restore" options={upcomingSkips} selected={upcomingSkips} render={planDate} onToggle={(d) => void run('undo', () => api(`/plans/${p.id}/skip`, { body: { date: d, undo: true } }))} />
      </>}
    </>}

    {p.status === 'active' && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: space(3) }}>
      <Text style={type.body}>Renew next month</Text>
      <Switch value={p.autoRenew} disabled={busy === 'renew'} onValueChange={(v) => void run('renew', () => api(`/plans/${p.id}/auto-renew`, { body: { autoRenew: v } }))} accessibilityLabel="Renew next month" />
    </View>}

    <H2>Trips</H2>
    {!trips.length ? <P muted>Each trip appears here 45 minutes before pickup, and you can follow it live.</P>
      : trips.slice().reverse().map((t) => <Row key={t.id} icon={t.leg === 'out' ? 'sunny' : 'moon'} title={`${planDate(t.date)} · ${t.leg === 'out' ? p.legs[0].label : p.legs[1]?.label || ''}`}
        subtitle={`${STATUS_LABEL[t.status as BookingStatus] || t.status} · ${t.ref}`} onPress={() => router.push(`/trip/${t.id}`)} />)}

    {live && <Button title="Cancel plan" variant="danger" busy={busy === 'cancel'} onPress={confirmCancel} />}
  </Screen>;
}
