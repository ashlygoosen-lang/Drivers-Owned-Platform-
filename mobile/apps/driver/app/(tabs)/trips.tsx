import { useCallback, useEffect, useState } from 'react';
import { api, Empty, H1, Loading, Row, Screen, STATUS_LABEL, date, money, type Booking } from '@drop/shared';

export default function Trips() {
  const [list, setList] = useState<Booking[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { setRefreshing(true); try { setList((await api<{ bookings: Booking[] }>('/bookings')).bookings); } finally { setRefreshing(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <Screen onRefresh={load} refreshing={refreshing}>
    <H1>Trip history</H1>
    {!list ? <Loading /> : list.length === 0 ? <Empty text="Your completed trips will appear here." icon="car-outline" /> :
      list.map((b) => <Row key={b.id} icon={b.service === 'Delivery' ? 'cube' : 'car'} title={`${b.pickup} → ${b.destination}`} subtitle={`${STATUS_LABEL[b.status]} · you keep ${money(b.driverEarnings)} · ${date(b.createdAt)}`} />)}
  </Screen>;
}
