import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { sideArt, topArt, VEHICLE_LABEL } from '../lib/vehicleImages';
import { colors, radius, space, type } from '../theme';

interface PlanMapData { pickup: { lat: number; lng: number; label: string } | null; destination: { lat: number; lng: number; label: string } | null; vehicleType: string; vehicle: string; live: { lat: number; lng: number; heading: number; bookingId: string; status: string } | null }

/** A monthly plan's route with its vehicle: the real vehicle type, moving live while a trip on the plan is under way. */
export function PlanMap({ planId, scholar, height = 220 }: { planId: string; scholar: boolean; height?: number }) {
  const { on } = useLive();
  const [d, setD] = useState<PlanMapData | null>(null);
  const [artReady, setArtReady] = useState(false);
  const map = useRef<MapView>(null);
  const load = useCallback(async () => { setD(await api<PlanMapData>(`/plans/${planId}/map`).catch(() => null)); }, [planId]);
  useEffect(() => { void load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  useEffect(() => on((event, x) => {
    if (!d?.live || x?.bookingId !== d.live.bookingId) return;
    if (event === 'location' && x.driver) setD((c) => c && c.live ? { ...c, live: { ...c.live, lat: x.driver.lat, lng: x.driver.lng, heading: x.driver.heading ?? c.live.heading } } : c);
    if (event === 'trip') void load();
  }), [on, d?.live, load]);
  useEffect(() => {
    if (!d) return;
    const pts = [d.pickup, d.destination, d.live].filter(Boolean).map((p) => ({ latitude: p!.lat, longitude: p!.lng }));
    if (pts.length) setTimeout(() => map.current?.fitToCoordinates(pts, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false }), 300);
  }, [d?.pickup, d?.destination, Boolean(d?.live)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || (!d.pickup && !d.destination)) return null;
  const top = topArt(d.vehicleType); const side = sideArt(d.vehicleType);
  return <View style={st.wrap}>
    <View style={{ height }}>
      <MapView ref={map} style={StyleSheet.absoluteFill} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} toolbarEnabled={false} accessibilityLabel="Plan route map"
        initialRegion={{ latitude: d.pickup?.lat ?? -33.9249, longitude: d.pickup?.lng ?? 18.4241, latitudeDelta: 0.1, longitudeDelta: 0.1 }}>
        {d.pickup && <Marker coordinate={{ latitude: d.pickup.lat, longitude: d.pickup.lng }} title={scholar ? 'Home pickup' : 'Pickup'} pinColor={colors.navy} />}
        {d.destination && <Marker coordinate={{ latitude: d.destination.lat, longitude: d.destination.lng }} title={scholar ? 'School' : 'Work'} pinColor={colors.orange} />}
        {d.pickup && d.destination && <Polyline coordinates={[{ latitude: d.pickup.lat, longitude: d.pickup.lng }, { latitude: d.destination.lat, longitude: d.destination.lng }]} strokeColor={colors.navy} strokeWidth={3} lineDashPattern={[8, 8]} />}
        {d.live && <Marker coordinate={{ latitude: d.live.lat, longitude: d.live.lng }} anchor={{ x: 0.5, y: 0.5 }} flat rotation={d.live.heading} title={d.vehicle || VEHICLE_LABEL[d.vehicleType]} tracksViewChanges={!artReady}>
          <Image source={top.image} style={{ width: top.width, height: top.height }} onLoad={() => setArtReady(true)} />
        </Marker>}
      </MapView>
      {d.live && <Text style={st.live}>● Live now</Text>}
    </View>
    <View style={st.foot}>
      <Image source={side.image} style={{ width: 92, height: (92 * side.height) / side.width }} accessibilityIgnoresInvertColors />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: '700' }]}>{VEHICLE_LABEL[d.vehicleType] || 'Vehicle'}{d.vehicle ? ` · ${d.vehicle}` : ''}</Text>
        <Text style={type.small}>{d.live ? 'On the way now. The map shows the vehicle as it moves.' : 'The vehicle appears on the map, live, whenever a trip on this plan is under way.'}</Text>
      </View>
    </View>
  </View>;
}

const st = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, marginBottom: space(4) },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3) },
  live: { position: 'absolute', top: 10, left: 10, backgroundColor: colors.success, color: colors.white, fontWeight: '700', fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
});
