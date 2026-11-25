import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Modal, Platform, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { api, Banner, Button, Card, Empty, ErrorText, H1, H2, LiveTripMap, P, Pill, RiskBanner, Screen, TripChat, STATUS_LABEL, colors, date, money, secure, KEYS, type, useAuth, useLive, type Booking, type User } from '@drop/shared';
import { startTracking, stopTracking } from '../../tasks/location';

const NEXT: Record<string, string> = { accepted: 'I’m on my way to the pickup', arriving: 'Passenger collected · start trip', in_progress: 'Complete trip' };

function navigate(to: string) {
  const q = encodeURIComponent(to);
  const url = Platform.OS === 'ios' ? `maps://?daddr=${q}` : `google.navigation:q=${q}`;
  void Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`));
}

/** Go online, receive and accept requests, run the active trip (map, chat, calls, navigation). */
export default function Drive() {
  const { user, setUser } = useAuth();
  const { on } = useLive();
  const [state, setState] = useState<{ requests: Booking[]; active: Booking | null } | null>(null);
  const [error, setError] = useState('');
  const [disclose, setDisclose] = useState(false);
  const [busy, setBusy] = useState('');
  const [trackingNote, setTrackingNote] = useState('');
  useKeepAwake();
  const load = useCallback(async () => { try { setState(await api('/drivers/requests')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  useEffect(() => on((event) => { if (event === 'trip') void load(); }), [on, load]);
  // Keep background GPS in step with the online switch (also after an app restart).
  useEffect(() => { if (user?.online && !user.demo) void startTracking(); }, [user?.online, user?.demo]);
  if (!user) return null;
  const approved = user.driverStatus === 'approved' && user.verificationStatus === 'verified';
  const a = state?.active;

  async function setOnline(online: boolean) {
    setError('');
    if (online && !user!.demo) {
      // Prominent disclosure before asking for background location (Google Play policy).
      if ((await secure.get(KEYS.disclosure)) !== 'yes') { setDisclose(true); return; }
      const ok = await startTracking();
      if (!ok) { setError('DROP Driver needs location access to go online. Allow it in Settings.'); return; }
      setTrackingNote(ok === 'foreground-only' ? 'Location is only shared while the app is open. Choose “Allow all the time” in Settings so passengers can track you with the screen off.' : '');
    }
    if (!online) await stopTracking();
    try { setUser((await api<{ user: User }>('/drivers/online', { body: { online } })).user); setTimeout(load, 100); } catch (e) { setError((e as Error).message); await stopTracking(); }
  }
  const act = async (path: string, key: string) => { setBusy(key); try { await api(path, { body: {} }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };

  return <Screen onRefresh={load}>
    <H1>Hi {user.name.split(' ')[0]}</H1>
    <RiskBanner />
    {!approved && <Card tone="orange"><P>{user.verificationStatus === 'submitted' ? 'Your documents are being reviewed. You can go online as soon as they are approved.' : 'Complete your verification to go online and accept trips.'}</P>{user.verificationStatus !== 'submitted' && <Button title="Upload my documents" onPress={() => router.push('/verification')} />}</Card>}
    <Card tone={user.online ? 'navy' : 'white'} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}><Text style={[type.h2, { marginBottom: 0, color: user.online ? colors.white : colors.navy }]}>{user.online ? 'You’re online' : 'You’re offline'}</Text><Text style={[type.small, { color: user.online ? '#C9D3E3' : colors.muted }]}>{user.online ? (user.demo ? 'Demo: location is simulated' : 'Sharing your location with DROP') : 'Go online to receive requests'}</Text></View>
      <Switch value={!!user.online} disabled={!approved} onValueChange={setOnline} accessibilityLabel="Online" trackColor={{ true: colors.orange }} />
    </Card>
    {trackingNote ? <Banner tone="warn" text={trackingNote} /> : null}
    <ErrorText>{error}</ErrorText>
    {a && <>
      <Card tone="soft">
        <Pill label={STATUS_LABEL[a.status]} tone="brand" />
        <Text style={[type.h2, { marginTop: 8 }]}>{a.pickup} → {a.destination}</Text>
        <P>{a.passenger?.name} · {money(a.fare)} fare · you keep {money(a.driverEarnings)} · {a.payment}</P>
        {a.notes ? <P muted>Note: {a.notes}</P> : null}
        {a.parcel ? <P muted>Parcel: {a.parcel}</P> : null}
        <Button title={NEXT[a.status]} busy={busy === 'adv'} onPress={() => (a.status === 'in_progress' ? Alert.alert('Complete trip?', `Collect ${a.payment === 'Cash' ? money(a.fare) + ' in cash' : 'nothing (paid in app)'}.`, [{ text: 'Not yet', style: 'cancel' }, { text: 'Complete', onPress: () => act(`/drivers/bookings/${a.id}/advance`, 'adv') }]) : act(`/drivers/bookings/${a.id}/advance`, 'adv'))} />
        <Button title={`Navigate to ${a.status === 'in_progress' ? 'destination' : 'pickup'}`} icon="navigate" variant="outline" onPress={() => navigate(a.status === 'in_progress' ? a.destination : a.pickup)} />
        {a.status !== 'in_progress' && <Button title="Release trip" variant="ghost" onPress={() => act(`/bookings/${a.id}/cancel`, 'rel')} />}
      </Card>
      <LiveTripMap bookingId={a.id} viewer="driver" vehicleType={user?.vehicleProfile?.type} />
      <TripChat bookingId={a.id} />
    </>}
    {!a && user.online && <>
      <H2>Requests near you</H2>
      {!state ? null : state.requests.length === 0 ? <Empty text="No open requests right now. This list refreshes automatically." icon="radio-outline" /> :
        state.requests.map((b) => <Card key={b.id}>
          <Text style={[type.body, { fontWeight: '700' }]}>{b.pickup} → {b.destination}</Text>
          <P muted>{b.service} · {b.category} · {b.distanceKm} km · fare {money(b.fare)} · you keep {money(b.driverEarnings)}{b.scheduledFor ? ` · ${date(b.scheduledFor)}` : ''}</P>
          <Button title="Accept request" busy={busy === b.id} onPress={() => act(`/drivers/bookings/${b.id}/accept`, b.id)} />
        </Card>)}
    </>}
    <Modal visible={disclose} transparent animationType="slide" onRequestClose={() => setDisclose(false)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(7,27,58,.5)' }}>
        <View style={{ backgroundColor: colors.white, padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <H2>Location while you drive</H2>
          <P>DROP Driver collects your location to show passengers where you are, calculate arrival times and record trip routes for safety, <Text style={{ fontWeight: '700' }}>even when the app is closed or not in use</Text>, for as long as you are online.</P>
          <P muted style={{ marginTop: 8 }}>Location sharing stops when you go offline. It is shared only with your passenger during a trip and with DROP safety staff.</P>
          <Button title="I understand, continue" onPress={async () => { await secure.set(KEYS.disclosure, 'yes'); setDisclose(false); void setOnline(true); }} />
          <Button title="Not now" variant="ghost" onPress={() => setDisclose(false)} />
        </View>
      </View>
    </Modal>
  </Screen>;
}
