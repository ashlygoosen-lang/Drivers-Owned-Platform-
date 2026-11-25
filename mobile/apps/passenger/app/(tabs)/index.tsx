import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, ApiError, Banner, Button, Card, ErrorText, Field, H1, H2, Icon, P, RiskBanner, Screen, Segmented, colors, money, type, useAuth, type Booking, type Quote, type Service } from '@drop/shared';

/** Book a ride, delivery or premium drive: upfront fare, category, payment, confirm. */
export default function Book() {
  const { user } = useAuth();
  const [service, setService] = useState<Service>('Ride');
  const [pickup, setPickup] = useState(user?.savedPlaces?.home || '');
  const [destination, setDestination] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const [focus, setFocus] = useState<'pickup' | 'destination' | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [category, setCategory] = useState('');
  const [payment, setPayment] = useState<'Cash' | 'Card' | 'Business account'>('Cash');
  const [cardOn, setCardOn] = useState(false);
  const [parcel, setParcel] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ places: string[] }>('/places').then((r) => setPlaces(r.places)).catch(() => undefined);
    api<{ card: boolean }>('/payments/config').then((r) => { setCardOn(r.card); if (r.card && user?.paymentPreference === 'Card') setPayment('Card'); }).catch(() => undefined);
  }, [user?.paymentPreference]);

  async function estimate() {
    setBusy(true); setError(''); setQuote(null);
    try { const q = await api<Quote>('/fares/estimate', { body: { service, pickup, destination } }); setQuote(q); setCategory(q.options[0].category); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError(''); setNeedsVerify(false);
    try {
      const { booking } = await api<{ booking: Booking }>('/bookings', { body: { service, category, pickup, destination, passengers: 1, parcel, notes, payment } });
      if (booking.status === 'awaiting_payment') {
        // Paystack's secure checkout in an in-app browser; the payment is confirmed server-to-server afterwards.
        const co = await api<{ authorizationUrl: string; reference: string }>(`/payments/bookings/${booking.id}/checkout`, { body: {} });
        await WebBrowser.openBrowserAsync(co.authorizationUrl, { dismissButtonStyle: 'close', presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
        await api(`/payments/verify/${encodeURIComponent(co.reference)}`).catch(() => undefined);
      }
      setQuote(null); setDestination('');
      router.push(`/trip/${booking.id}`);
    } catch (e) { setError((e as Error).message); setNeedsVerify((e as ApiError).code === 'verification_required'); }
    finally { setBusy(false); }
  }

  const suggestions = focus ? places.filter((p) => p.toLowerCase().includes((focus === 'pickup' ? pickup : destination).toLowerCase())).slice(0, 5) : [];
  const selected = quote?.options.find((o) => o.category === category);
  return <Screen>
    <H1>Where to, {user?.name.split(' ')[0]}?</H1>
    <RiskBanner />
    {user?.verificationStatus !== 'verified' && user?.verificationStatus !== 'submitted' && <Pressable onPress={() => router.push('/verification')}><Banner tone="warn" icon="shield" text="Verify your identity before your first trip. It takes about 3 minutes. Tap to start." /></Pressable>}
    <Segmented label="Service" options={['Ride', 'Delivery', 'Premium Drive'] as Service[]} value={service} onChange={(v) => { setService(v); setQuote(null); }} />
    <Field label={service === 'Delivery' ? 'Collection address' : 'Pickup'} value={pickup} onChangeText={(v) => { setPickup(v); setQuote(null); }} onFocus={() => setFocus('pickup')} onBlur={() => setTimeout(() => setFocus(null), 150)} placeholder="Where from?" />
    {focus === 'pickup' && suggestions.map((p) => <Pressable key={p} onPress={() => { setPickup(p); setFocus(null); }} style={{ paddingVertical: 10 }}><Text style={type.body}>📍 {p}</Text></Pressable>)}
    <Field label={service === 'Delivery' ? 'Drop-off address' : 'Destination'} value={destination} onChangeText={(v) => { setDestination(v); setQuote(null); }} onFocus={() => setFocus('destination')} onBlur={() => setTimeout(() => setFocus(null), 150)} placeholder="Where to?" />
    {focus === 'destination' && suggestions.map((p) => <Pressable key={p} onPress={() => { setDestination(p); setFocus(null); }} style={{ paddingVertical: 10 }}><Text style={type.body}>📍 {p}</Text></Pressable>)}
    {service === 'Delivery' && <Field label="What are we delivering?" value={parcel} onChangeText={setParcel} placeholder="e.g. Signed contract, one envelope" />}
    {!quote && <Button title="See fares" icon="pricetag" busy={busy} disabled={pickup.trim().length < 3 || destination.trim().length < 3} onPress={estimate} />}
    {quote && <>
      <P muted>{quote.distanceKm} km · about {quote.durationMin} min{quote.approximate ? ' · approximate, confirmed by your driver' : ''}</P>
      {quote.options.map((o) => <Pressable key={o.category} accessibilityRole="radio" accessibilityState={{ checked: category === o.category }} onPress={() => setCategory(o.category)}>
        <Card style={{ borderWidth: 2, borderColor: category === o.category ? colors.orange : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name={service === 'Delivery' ? 'cube' : 'car-sport'} size={28} />
          <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: '700' }]}>{o.category}</Text><Text style={type.small}>{o.description}{o.seats ? ` · up to ${o.seats}` : ''}</Text></View>
          <Text style={[type.h2, { marginBottom: 0 }]}>{money(o.fare)}</Text>
        </Card>
      </Pressable>)}
      <Field label="Note for your driver (optional)" value={notes} onChangeText={setNotes} placeholder="Gate code, landmark, luggage…" maxLength={300} />
      <H2>Payment</H2>
      <Segmented label="Payment method" options={[...(cardOn ? ['Card'] : []), 'Cash', ...(user?.role === 'business' ? ['Business account'] : [])] as ('Card' | 'Cash' | 'Business account')[]} value={payment} onChange={setPayment} />
      {selected && <Card tone="soft"><P>Passenger commission: R 0 · Your driver keeps {money(selected.driverEarnings)} after the disclosed {Math.round(quote.serviceFeeRate * 100)}% DROP fee.</P></Card>}
      {needsVerify ? <><Banner tone="warn" icon="shield" text={error} /><Button title="Verify my identity" onPress={() => router.push('/verification')} /></> : <ErrorText>{error}</ErrorText>}
      <Button title={`Confirm${selected ? ` · ${money(selected.fare)}` : ''}`} busy={busy} disabled={!selected} onPress={confirm} />
      <Button title="Edit trip" variant="ghost" onPress={() => setQuote(null)} />
    </>}
    {!quote && error ? <ErrorText>{error}</ErrorText> : null}
  </Screen>;
}
