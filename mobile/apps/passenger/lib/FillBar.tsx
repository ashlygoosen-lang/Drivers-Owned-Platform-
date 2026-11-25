import { Text, View } from 'react-native';
import { colors, type, fillLabel } from '@drop/shared';

/** Seats paid against capacity, with a marker at the minimum needed to confirm the trip. */
export function FillBar({ paid, capacity, minimum }: { paid: number; capacity: number; minimum: number }) {
  const pct = Math.min(100, Math.round((paid / capacity) * 100));
  const min = Math.round((minimum / capacity) * 100);
  return <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: capacity, now: paid }} accessibilityLabel={fillLabel(paid, capacity, minimum)} style={{ marginVertical: 8 }}>
    <View style={{ height: 10, borderRadius: 5, backgroundColor: '#E3E8EF', overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 5, backgroundColor: paid >= minimum ? colors.success : colors.orange }} />
      <View style={{ position: 'absolute', left: `${min}%`, top: 0, bottom: 0, width: 2, backgroundColor: colors.navy }} />
    </View>
    <Text style={[type.small, { marginTop: 4 }]}>{fillLabel(paid, capacity, minimum)}</Text>
  </View>;
}
