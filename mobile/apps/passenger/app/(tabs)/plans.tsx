import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { api, useAuth, Banner, Button, Empty, ErrorText, H1, Loading, P, Pill, Row, Screen, PLAN_STATUS, daysLabel, money, planDate, type Plan } from '@drop/shared';

/** Monthly plans: scholar transport for parents and guardians, staff transport for business accounts. */
export default function Plans() {
  const { user } = useAuth();
  const kind = user?.role === 'business' ? 'staff' : 'scholar';
  const [list, setList] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setList((await api<{ plans: Plan[] }>('/plans')).plans.filter((p) => p.kind === kind)); setError(''); } catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const tone = (s: string) => (s === 'active' ? 'good' : s === 'cancelled' || s === 'expired' ? 'bad' : s === 'completed' ? 'neutral' : 'warn');
  return <Screen onRefresh={load} refreshing={refreshing}>
    <H1>{kind === 'scholar' ? 'School transport' : 'Staff transport'}</H1>
    <P muted>{kind === 'scholar'
      ? 'One vetted driver for the school run, booked by the month. Scholar drivers hold a police clearance, a child-protection clearance and a learner-transport licence, checked by our compliance team.'
      : 'Daily commutes for your team on one monthly plan, invoiced with your business trips. You pay only for trips driven.'}</P>
    {user?.verificationStatus !== 'verified' && user?.verificationStatus !== 'submitted' && <Banner tone="warn" icon="shield" text="Verify your identity before booking a plan." />}
    <Button title={kind === 'scholar' ? 'New school transport plan' : 'New staff transport plan'} icon="add" onPress={() => router.push('/plan/new')} />
    <ErrorText>{error}</ErrorText>
    {!list ? <Loading /> : list.length === 0 ? <Empty icon="school-outline" text={kind === 'scholar' ? 'No school transport plans yet.' : 'No staff transport plans yet.'} />
      : list.map((p) => <Row key={p.id} icon={kind === 'scholar' ? 'school' : 'business'} title={kind === 'scholar' ? p.school : p.destination}
        subtitle={`${planDate(p.startDate)} – ${planDate(p.endDate)} · ${daysLabel(p.days)} · ${money(p.pricing.total)}`}
        right={<Pill label={PLAN_STATUS[p.status] || p.status} tone={tone(p.status)} />} onPress={() => router.push(`/plan/${p.id}`)} />)}
  </Screen>;
}
