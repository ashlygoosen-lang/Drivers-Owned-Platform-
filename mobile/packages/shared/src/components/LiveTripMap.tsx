import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { decodePolyline, fmtDist, fmtEta } from '../lib/geo';
import type { Tracking } from '../types';
import { colors, radius } from '../theme';
import { Icon } from './ui';
import { topArt } from '../lib/vehicleImages';

/** Live map of a trip: the car moving in real time, the road route and the ETA (Google Maps). */
export function LiveTripMap({ bookingId, viewer, height = 300, selfLocation, vehicleType }: { bookingId: string; viewer: 'passenger' | 'driver'; height?: number; selfLocation?: { latitude: number; longitude: number } | null; vehicleType?: string }) {
  const { on, connected } = useLive();
  const [t, setT] = useState<Tracking | null>(null);
  const map = useRef<MapView>(null);
  const [artReady, setArtReady] = useState(false); // Android: keep redrawing the marker until its picture has loaded
  const load = useCallback(async () => { setT(await api<Tracking>(`/bookings/${bookingId}/tracking`).catch(() => null)); }, [bookingId]);
  useEffect(() => { void load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  useEffect(() => { if (connected) void load(); }, [connected, load]);
  useEffect(() => on((event, d) => {
    if (d?.bookingId !== bookingId) return;
    if (event === 'location') setT((c) => c && { ...c, driver: { ...c.driver, ...d.driver, stale: false }, eta: d.eta, stage: d.stage, route: d.route || (d.stage === c.stage ? c.route : null) });
    if (event === 'passenger-location') setT((c) => c && { ...c, passenger: d.passenger });
    if (event === 'trip') void load();
  }), [on, bookingId, load]);

  const route = useMemo(() => (t?.route?.polyline ? decodePolyline(t.route.polyline) : null), [t?.route?.polyline]);
  const target = t && (t.stage === 'to_pickup' ? t.pickup : t.stage === 'to_destination' ? t.destination : null);
  const car = t?.driver ? { latitude: t.driver.lat, longitude: t.driver.lng } : viewer === 'driver' ? selfLocation : null;

  const fitted = useRef('');
  useEffect(() => {
    const key = `${t?.stage}:${Boolean(car)}`;
    if (!t || fitted.current === key) return;
    const pts = [car, t.pickup && t.stage !== 'to_destination' ? { latitude: t.pickup.lat, longitude: t.pickup.lng } : null, t.destination ? { latitude: t.destination.lat, longitude: t.destination.lng } : null].filter(Boolean) as { latitude: number; longitude: number }[];
    if (pts.length) { fitted.current = key; setTimeout(() => map.current?.fitToCoordinates(pts, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }), 300); }
  }, [t, car]);

  const arrived = t?.stage === 'to_pickup' && t.eta && t.eta.distanceM < 120;
  const who = viewer === 'driver' ? 'You are' : `${t?.driver?.name || 'Your driver'} is`;
  const headline = !t ? 'Loading map…' : !t.driver ? (t.status === 'requested' ? 'Finding a driver near you…' : 'Waiting for the driver’s location…')
    : arrived ? (viewer === 'driver' ? 'You’ve arrived at the pickup' : `${t.driver.name || 'Your driver'} has arrived`)
      : t.eta ? `${who} ${fmtEta(t.eta.durationSec)} ${t.stage === 'to_pickup' ? 'from the pickup' : 'from the destination'}` : 'Live location';

  return <View style={{ marginBottom: 16 }}>
    <View style={[st.map, { height }]}>
      <MapView ref={map} style={StyleSheet.absoluteFill} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: -33.9249, longitude: 18.4241, latitudeDelta: 0.12, longitudeDelta: 0.12 }} showsUserLocation={viewer === 'passenger'} showsMyLocationButton={false} toolbarEnabled={false} accessibilityLabel="Live trip map">
        {t?.pickup && t.stage !== 'to_destination' && <Marker coordinate={{ latitude: t.pickup.lat, longitude: t.pickup.lng }} title="Pickup" description={t.pickup.label} pinColor={colors.navy} />}
        {t?.destination && <Marker coordinate={{ latitude: t.destination.lat, longitude: t.destination.lng }} title="Destination" description={t.destination.label} pinColor={colors.orange} />}
        {t?.passenger && <Marker coordinate={{ latitude: t.passenger.lat, longitude: t.passenger.lng }} title="Passenger" pinColor={colors.blue} />}
        {car && <Marker coordinate={car} anchor={{ x: 0.5, y: 0.5 }} flat rotation={t?.driver?.heading || 0} title={t?.driver?.vehicle || 'DROP car'} tracksViewChanges={!artReady}>
          {(() => { const a = topArt(t?.driver?.vehicleType || vehicleType); return <Image source={a.image} style={{ width: a.width, height: a.height }} onLoad={() => setArtReady(true)} accessibilityLabel={t?.driver?.vehicle || 'DROP vehicle'} />; })()}
        </Marker>}
        {car && target && (route ? <Polyline coordinates={route} strokeColor={colors.navy} strokeWidth={5} /> : <Polyline coordinates={[car, { latitude: target.lat, longitude: target.lng }]} strokeColor={colors.navy} strokeWidth={3} lineDashPattern={[8, 8]} />)}
        {t && t.trail.length > 1 && <Polyline coordinates={t.trail.map(([la, ln]) => ({ latitude: la, longitude: ln }))} strokeColor={colors.orange} strokeWidth={4} />}
      </MapView>
      {t?.driver && !t.driver.stale && <View style={st.live}><View style={st.liveDot} /><Text style={{ fontSize: 12, fontWeight: '700' }}>Live</Text></View>}
    </View>
    <View style={st.eta} accessibilityLiveRegion="polite">
      <Icon name={arrived ? 'location' : 'car'} color={colors.orange} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.white, fontWeight: '700' }}>{headline}</Text>
        {t?.driver && t.eta && !arrived && <Text style={{ color: '#C9D3E3', fontSize: 12 }}>{fmtDist(t.eta.distanceM)} away{t.eta.estimated ? ' · estimated' : ' · live traffic'}</Text>}
        {t?.driver?.stale && <Text style={{ color: '#FFB27A', fontSize: 12 }}>Location not updated for a few minutes (poor signal?).</Text>}
      </View>
    </View>
  </View>;
}

const st = StyleSheet.create({
  map: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#E6EBF1' },
  live: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#17744A' },
  eta: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navy, borderRadius: radius.md, padding: 12, marginTop: 8 },
});
