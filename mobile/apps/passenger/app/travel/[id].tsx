import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, colors, space, type, Banner, Button, Card, ErrorText, H1, H2, Loading, P, Pill, Row, Screen, GROUP_BOOKING_STATUS, groupBookingTone, money, travelDate, type GroupBooking, type TravelGroup } from '@drop/shared';
import { FillBar } from '../../lib/FillBar';
import { payGroupBooking } from '../../lib/payTravel';

function useCountdown(until: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!until) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  if (!until) return '';
  const ms = Date.parse(until) - now;
  return ms <= 0 ? 'expired' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}

export default function GroupTrip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<{ booking: GroupBooking; cancellation: { feePct: number }; alternatives: TravelGroup[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setData(await api(`/travel/my/${id}`)); setError(''); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const countdown = useCountdown(data?.booking.status === 'held' ? data.booking.holdExpiresAt : undefined);
  const run = async (what: string, fn: () => Promise<unknown>) => { setBusy(what); setError(''); try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  if (!data) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  const b = data.booking; const g = b.group!;
  const left = Math.round((b.paid - b.refunded) * 100) / 100;
  const fee = Math.round(left * data.cancellation.feePct) / 100;
  const canCancel = ['held', 'deposit_paid', 'paid', 'ticketed'].includes(b.status);
  const confirmCancel = () => Alert.alert('Cancel this booking?', b.status === 'held' ? 'Your held seats will be released. Nothing has been charged.' : `Cancelling now costs ${data.cancellation.feePct}% (${money(fee)}). You get ${money(left - fee)} back to your card.`, [
    { text: 'Keep booking', style: 'cancel' },
    { text: 'Cancel booking', style: 'destructive', onPress: () => void run('cancel', () => api(`/travel/my/${b.id}/cancel`, { body: {} })) },
  ]);
  const confirmRefund = () => Alert.alert('Take a refund?', `We refund ${money(left)} in full to your card.`, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Refund me', onPress: () => void run('refund', () => api(`/travel/my/${b.id}/decline-transfer`, { body: {} })) },
  ]);
  return <Screen onRefresh={load}>
    <Text style={type.small}>{b.ref} · group {g.ref} · {g.typeLabel}</Text>
    <H1>{g.originName} → {g.destinationName}</H1>
    <View style={{ flexDirection: 'row', gap: space(2), marginBottom: space(3) }}><Pill label={GROUP_BOOKING_STATUS[b.status] || b.status} tone={groupBookingTone(b.status)} />{g.international && <Pill label="International" />}</View>

    {b.status === 'held' && <Card tone="orange" style={{ marginBottom: space(3) }}>
      <P>Your seats are held for <Text style={{ fontWeight: '800' }}>{countdown}</Text>. Pay to keep them.</P>
      <View style={{ marginTop: space(2) }}><Button title={`Pay ${money(b.depositDue)}`} icon="card" busy={busy === 'pay'} disabled={countdown === 'expired'} onPress={() => run('pay', () => payGroupBooking(b.id))} /></View>
    </Card>}
    {b.status === 'deposit_paid' && <Card tone="orange" style={{ marginBottom: space(3) }}>
      <P>Balance of <Text style={{ fontWeight: '800' }}>{money(b.balance)}</Text> due by <Text style={{ fontWeight: '800' }}>{b.balanceDueAt ? new Date(b.balanceDueAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' }) : 'the fill deadline'}</Text>.</P>
      <View style={{ marginTop: space(2) }}><Button title="Pay balance" icon="card" busy={busy === 'pay'} onPress={() => run('pay', () => payGroupBooking(b.id))} /></View>
    </Card>}
    {b.status === 'transfer_offered' && <Card tone="orange" style={{ marginBottom: space(3) }}>
      <P>This group didn’t reach its minimum. Move to another group on this route at no extra cost, or take a full refund of {money(left)}.{b.transferOfferExpiresAt ? ` If you don’t choose by ${new Date(b.transferOfferExpiresAt).toLocaleDateString('en-ZA')}, we refund you automatically.` : ''}</P>
      {data.alternatives.length === 0 ? <P muted>No other groups with space right now.</P> : data.alternatives.map((a) => <View key={a.id} style={{ marginTop: space(2) }}>
        <Button variant="outline" title={`Move to ${travelDate(a.departureDate)} (${a.paidSeats}/${a.capacity})`} busy={busy === a.id} onPress={() => run(a.id, () => api(`/travel/my/${b.id}/transfer`, { body: { groupId: a.id } }))} /></View>)}
      <View style={{ marginTop: space(2) }}><Button variant="ghost" title="Refund me instead" busy={busy === 'refund'} onPress={confirmRefund} /></View>
    </Card>}

    <Card>
      <Row icon="calendar" title={`${travelDate(g.departureDate)}${g.returnDate ? ` – ${travelDate(g.returnDate)}` : ''}`} subtitle={g.returnDate ? 'Return trip' : 'One way'} />
      {g.partnerReference ? <Row icon="ticket" title={`Booking reference ${g.partnerReference}`} subtitle={g.partner?.name || 'Airline or operator'} /> : <Row icon="business" title={g.partner?.name || 'Partner'} subtitle="Confirmed with the partner once the group fills" />}
      <FillBar paid={g.paidSeats} capacity={g.capacity} minimum={g.minimum} />
    </Card>

    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginVertical: space(3) }}>
      {[['Total', b.total], ['Paid', b.paid], ['Balance', b.balance], ['Refunded', b.refunded]].map(([k, v]) => <View key={k as string} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: space(3) }}>
        <Text style={type.small}>{k}</Text><Text style={[type.body, { fontWeight: '800' }]}>{money(v as number)}</Text></View>)}
    </View>
    {b.refundPending > 0 && <Banner tone="warn" text={`A refund of ${money(b.refundPending)} is being processed.`} />}

    <H2>Travellers</H2>
    <Card>{b.passengers.map((p, i) => <Row key={p.id || i} icon="person" title={`${p.fullName}${p.minor ? ' · under 18' : ''}`}
      subtitle={`${p.nationality}${p.passport ? ` · passport ${p.passport}` : ''}${p.ticketNumber ? ` · ticket ${p.ticketNumber}${p.seat ? `, seat ${p.seat}` : ''}` : ' · ticket to follow'}`} />)}</Card>

    <H2>History</H2>
    <Card>{b.history.map((h, i) => <Text key={i} style={[type.small, { marginBottom: 4 }]}>{new Date(h.at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {GROUP_BOOKING_STATUS[h.status] || h.status}{h.note ? ` · ${h.note}` : ''}</Text>)}</Card>
    <ErrorText>{error}</ErrorText>
    {canCancel && <View style={{ marginTop: space(3) }}><Button variant="danger" title="Cancel booking" busy={busy === 'cancel'} onPress={confirmCancel} /></View>}
  </Screen>;
}
