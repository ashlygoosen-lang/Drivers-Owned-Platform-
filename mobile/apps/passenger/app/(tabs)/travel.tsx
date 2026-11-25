import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, colors, space, type, Button, Card, Empty, ErrorText, H1, H2, Loading, P, Pill, Row, Screen, GROUP_BOOKING_STATUS, groupBookingTone, isUpcomingBooking, money, travelDate, type GroupBooking } from '@drop/shared';
import { FillBar } from '../../lib/FillBar';

/** Group travel: join a group flight or coach trip and pay the group rate. */
export default function Travel() {
  const [list, setList] = useState<GroupBooking[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setList((await api<{ bookings: GroupBooking[] }>('/travel/my')).bookings); setError(''); } catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const upcoming = (list || []).filter((b) => isUpcomingBooking(b.status));
  const past = (list || []).filter((b) => !isUpcomingBooking(b.status));
  const card = (b: GroupBooking) => <Card key={b.id} style={{ marginBottom: space(3) }}>
    <Row icon={b.group?.type === 'flight' ? 'airplane' : 'bus'} title={`${b.group?.originName} → ${b.group?.destinationName}`}
      subtitle={`${b.group ? travelDate(b.group.departureDate) : ''} · ${b.seats} traveller${b.seats > 1 ? 's' : ''} · ${money(b.total)}`}
      right={<Pill label={GROUP_BOOKING_STATUS[b.status] || b.status} tone={groupBookingTone(b.status)} />} onPress={() => router.push(`/travel/${b.id}`)} />
    {b.group && isUpcomingBooking(b.status) && <FillBar paid={b.group.paidSeats} capacity={b.group.capacity} minimum={b.group.minimum} />}
    {b.status === 'deposit_paid' && <Text style={[type.small, { color: colors.orange }]}>Balance {money(b.balance)} due{b.balanceDueAt ? ` by ${new Date(b.balanceDueAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}</Text>}
  </Card>;
  return <Screen onRefresh={load} refreshing={refreshing}>
    <H1>Group travel</H1>
    <Card tone="navy" style={{ marginBottom: space(4) }}>
      <Text style={[type.h2, { color: colors.white }]}>Travel together, pay less</Text>
      <Text style={[type.body, { color: '#C9D3E2', marginVertical: space(2) }]}>Join a group flight or coach trip. When the group fills, everyone gets the group rate. If it doesn’t, you get your money back.</Text>
      <Button title="Find a group" icon="search" onPress={() => router.push('/travel/search')} />
    </Card>
    <ErrorText>{error}</ErrorText>
    {!list ? <Loading /> : list.length === 0 ? <Empty icon="airplane-outline" text="No group trips yet. Find a group to join." /> : <>
      {upcoming.length > 0 && <><H2>Upcoming</H2>{upcoming.map(card)}</>}
      {past.length > 0 && <View style={{ marginTop: space(2) }}>
        <Button variant="ghost" title={showPast ? 'Hide past and cancelled' : `Past and cancelled (${past.length})`} onPress={() => setShowPast(!showPast)} />
        {showPast && past.map(card)}
      </View>}
    </>}
    <P muted style={{ marginTop: space(4) }}>Prices are charged in South African rand. Passport details are encrypted and shared only with the airline or coach operator for your trip.</P>
  </Screen>;
}
