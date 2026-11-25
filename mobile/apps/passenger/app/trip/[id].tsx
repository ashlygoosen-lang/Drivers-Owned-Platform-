import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Share, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { api, Banner, Button, Card, ErrorText, Field, H2, Loading, LiveTripMap, P, Pill, Screen, TripChat, STATUS_LABEL, colors, money, type, useLive, type Booking } from '@drop/shared';

const ACTIVE = ['accepted', 'arriving', 'in_progress'];

/** Live trip: status, Google map with the moving car, chat and calls, share location, cancel, rate, SOS. */
export default function Trip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { on } = useLive();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [share, setShare] = useState(false);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const load = useCallback(async () => { try { setB((await api<{ booking: Booking }>(`/bookings/${id}`)).booking); } catch (e) { setError((e as Error).message); } }, [id]);
  useEffect(() => { void load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  useEffect(() => on((event, d) => { if (event === 'trip' && d.bookingId === id) void load(); }), [on, id, load]);

  // Optional: share the passenger's location with the driver until pickup.
  useEffect(() => {
    if (!share || !b || !['accepted', 'arriving'].includes(b.status)) return;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) { setShare(false); setError('Allow location access to share where you are.'); return; }
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 }, (p) => {
        void api(`/bookings/${b.id}/my-location`, { body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }).catch(() => undefined);
      });
    })();
    return () => { sub?.remove(); void api(`/bookings/${b.id}/my-location`, { body: { stop: true } }).catch(() => undefined); };
  }, [share, b?.status, b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  const active = ACTIVE.includes(b.status);
  return <Screen onRefresh={load}>
    <Card tone="soft">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[type.small, { fontWeight: '700', color: colors.navy }]}>{b.ref}</Text><Pill label={STATUS_LABEL[b.status]} tone={b.status === 'completed' ? 'good' : b.status === 'cancelled' ? 'bad' : 'brand'} /></View>
      <Text style={[type.h2, { marginTop: 8 }]}>{b.driver ? `${b.driver.name} is your driver` : b.status === 'cancelled' ? 'This trip was cancelled' : 'Finding your driver…'}</Text>
      {b.driver && <P muted>{b.driver.vehicle}{b.driver.rating ? ` · ★ ${b.driver.rating}` : ''}</P>}
      <P style={{ marginTop: 8 }}>○ {b.pickup}{'\n'}● {b.destination}</P>
      <P muted>{b.category} · {money(b.fare)} · {b.payment}{b.paymentStatus === 'paid' ? ' · paid' : ''}</P>
    </Card>
    {b.status === 'awaiting_payment' && <Banner tone="warn" text="Complete the card payment to request a driver." />}
    {(active || b.status === 'requested' || b.status === 'completed') && <LiveTripMap bookingId={b.id} viewer="passenger" />}
    {['accepted', 'arriving'].includes(b.status) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}><Switch value={share} onValueChange={setShare} accessibilityLabel="Share my location with my driver" /><Text style={[type.body, { flex: 1 }]}>Share my location with my driver until pickup</Text></View>}
    {b.driver && b.comms && <TripChat bookingId={b.id} />}
    {active && <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1 }}><Button title="Share trip" icon="share-social" variant="outline" onPress={() => Share.share({ message: `I'm on a DROP trip (${b.ref}) from ${b.pickup} to ${b.destination}${b.driver ? ` with ${b.driver.name}, ${b.driver.vehicle}` : ''}.` })} /></View>
      <View style={{ flex: 1 }}><Button title="SOS 10111" icon="warning" variant="danger" onPress={() => Linking.openURL('tel:10111')} /></View>
    </View>}
    {['awaiting_payment', 'requested', 'accepted', 'arriving'].includes(b.status) && <Button title="Cancel trip" variant="ghost" onPress={() => Alert.alert('Cancel this trip?', b.paymentStatus === 'paid' ? 'Your card payment will be refunded.' : undefined, [{ text: 'Keep trip', style: 'cancel' }, { text: 'Cancel trip', style: 'destructive', onPress: async () => { try { setB((await api<{ booking: Booking }>(`/bookings/${b.id}/cancel`, { body: {} })).booking); } catch (e) { setError((e as Error).message); } } }])} />}
    {b.status === 'completed' && !b.rating && <Card>
      <H2>How was your trip?</H2>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>{[1, 2, 3, 4, 5].map((n) => <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} stars`} onPress={() => setRating(n)}><Text style={{ fontSize: 34, color: n <= rating ? colors.orange : colors.line }}>★</Text></Pressable>)}</View>
      <Field label="Feedback (optional)" value={feedback} onChangeText={setFeedback} multiline maxLength={600} />
      <Button title="Submit rating" onPress={async () => { try { setB((await api<{ booking: Booking }>(`/bookings/${b.id}/rate`, { body: { rating, feedback } })).booking); } catch (e) { setError((e as Error).message); } }} />
    </Card>}
    <ErrorText>{error}</ErrorText>
  </Screen>;
}
