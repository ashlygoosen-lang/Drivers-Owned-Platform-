import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 20, color = colors.navy }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

/** Every screen: safe area, keyboard avoidance, scroll and optional pull-to-refresh. */
export function Screen({ children, scroll = true, onRefresh, refreshing = false, padded = true, style }: { children: React.ReactNode; scroll?: boolean; onRefresh?: () => void; refreshing?: boolean; padded?: boolean; style?: ViewStyle }) {
  const body = scroll
    ? <ScrollView contentContainerStyle={[padded && s.pad, style]} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} /> : undefined}>{children}</ScrollView>
    : <View style={[{ flex: 1 }, padded && s.pad, style]}>{children}</View>;
  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{body}</KeyboardAvoidingView></SafeAreaView>;
}

export const H1 = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={[type.h1, { marginBottom: space(2) }]}>{children}</Text>;
export const H2 = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={[type.h2, { marginBottom: space(2) }]}>{children}</Text>;
export const P = ({ children, muted = false, style }: { children: React.ReactNode; muted?: boolean; style?: object }) => <Text style={[muted ? type.small : type.body, style]}>{children}</Text>;

type Variant = 'primary' | 'navy' | 'outline' | 'danger' | 'ghost';
export function Button({ title, onPress, variant = 'primary', busy = false, disabled = false, icon, accessibilityHint }: { title: string; onPress: () => void; variant?: Variant; busy?: boolean; disabled?: boolean; icon?: IconName; accessibilityHint?: string }) {
  const bg = { primary: colors.orange, navy: colors.navy, outline: colors.white, danger: colors.danger, ghost: 'transparent' }[variant];
  const fg = { primary: colors.navy, navy: colors.white, outline: colors.navy, danger: colors.white, ghost: colors.navy }[variant];
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === 'outline' && { borderWidth: 1, borderColor: colors.line }]}>
    {busy ? <ActivityIndicator color={fg} /> : <>{icon && <Icon name={icon} color={fg} size={18} />}<Text style={[s.btnText, { color: fg }]} maxFontSizeMultiplier={1.6}>{title}</Text></>}
  </Pressable>;
}

export function Field({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return <View style={{ marginBottom: space(4) }}>
    <Text style={type.label}>{label}</Text>
    <TextInput accessibilityLabel={label} accessibilityHint={hint} placeholderTextColor="#8A97A8" style={[s.input, error && { borderColor: colors.danger }, style]} {...props} />
    {hint && !error && <Text style={[type.small, { marginTop: 4 }]}>{hint}</Text>}
    {error && <Text style={[type.small, { color: colors.danger, marginTop: 4 }]} accessibilityLiveRegion="polite">{error}</Text>}
  </View>;
}

export const Card = ({ children, style, tone = 'white' }: { children: React.ReactNode; style?: ViewStyle; tone?: 'white' | 'navy' | 'soft' | 'orange' }) =>
  <View style={[s.card, { backgroundColor: { white: colors.white, navy: colors.navy, soft: '#E6ECF3', orange: colors.orangeSoft }[tone] }, style]}>{children}</View>;

export const ErrorText = ({ children }: { children?: string }) => (children ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.small, { color: colors.danger, marginVertical: space(2) }]}>{children}</Text> : null);

export function Banner({ text, tone = 'info', icon = 'information-circle' }: { text: string; tone?: 'info' | 'warn' | 'success' | 'danger'; icon?: IconName }) {
  const t = { info: ['#E6ECF3', colors.navy], warn: [colors.orangeSoft, '#8A3A00'], success: [colors.successSoft, colors.success], danger: [colors.dangerSoft, colors.danger] }[tone];
  return <View accessibilityRole="alert" style={[s.banner, { backgroundColor: t[0] }]}><Icon name={icon} color={t[1]} /><Text style={[type.small, { color: t[1], flex: 1 }]}>{text}</Text></View>;
}

export const Loading = ({ label = 'Loading…' }: { label?: string }) => <View style={s.center} accessibilityLabel={label}><ActivityIndicator color={colors.orange} size="large" /><Text style={[type.small, { marginTop: 8 }]}>{label}</Text></View>;
export const Empty = ({ text, icon = 'file-tray-outline' }: { text: string; icon?: IconName }) => <View style={[s.center, s.empty]}><Icon name={icon} size={30} color={colors.muted} /><Text style={[type.small, { textAlign: 'center', marginTop: 8 }]}>{text}</Text></View>;

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }) {
  const t = { neutral: ['#EEF1F5', colors.muted], good: [colors.successSoft, colors.success], warn: [colors.orangeSoft, '#8A3A00'], bad: [colors.dangerSoft, colors.danger], brand: [colors.navy, colors.white] }[tone];
  return <View style={[s.pill, { backgroundColor: t[0] }]}><Text style={{ color: t[1], fontSize: 12, fontWeight: '700' }}>{label}</Text></View>;
}

export function Row({ icon, title, subtitle, onPress, right }: { icon?: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.grey }]}>
    {icon && <View style={s.rowIcon}><Icon name={icon} /></View>}
    <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: '600' }]}>{title}</Text>{subtitle ? <Text style={type.small}>{subtitle}</Text> : null}</View>
    {right ?? (onPress ? <Icon name="chevron-forward" color={colors.muted} /> : null)}
  </Pressable>;
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: T[]; value: T; onChange: (v: T) => void; label: string }) {
  return <View accessibilityRole="tablist" accessibilityLabel={label} style={s.seg}>{options.map((o) => <Pressable key={o} accessibilityRole="tab" accessibilityState={{ selected: o === value }} onPress={() => onChange(o)} style={[s.segItem, o === value && { backgroundColor: colors.navy }]}><Text style={{ fontWeight: '600', color: o === value ? colors.white : colors.muted }}>{o}</Text></Pressable>)}</View>;
}

/** Wrapping choice chips (single or multiple selection). */
export function Chips<T extends string | number>({ options, selected, onToggle, label, render }: { options: T[]; selected: T[]; onToggle: (v: T) => void; label: string; render?: (v: T) => string }) {
  return <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginVertical: space(2) }}>{options.map((o) => {
    const on = selected.includes(o);
    return <Pressable key={String(o)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onToggle(o)} style={{ minHeight: 40, paddingHorizontal: space(3), borderRadius: radius.sm, borderWidth: 1, borderColor: on ? colors.navy : colors.line, backgroundColor: on ? colors.navy : colors.white, justifyContent: 'center' }}>
      <Text style={{ fontWeight: '600', color: on ? colors.white : colors.text }}>{render ? render(o) : String(o)}</Text></Pressable>;
  })}</View>;
}

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.grey },
  pad: { padding: space(5), paddingBottom: space(12) },
  btn: { minHeight: 52, borderRadius: radius.md, paddingHorizontal: space(5), alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space(2), marginVertical: space(1.5) },
  btnText: { fontSize: 16, fontWeight: '700' },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: space(4), fontSize: 16, color: colors.text, backgroundColor: colors.white, marginTop: 6 },
  card: { borderRadius: radius.lg, padding: space(4), marginBottom: space(4), shadowColor: '#071B3A', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  banner: { flexDirection: 'row', gap: space(2), alignItems: 'center', padding: space(3), borderRadius: radius.md, marginBottom: space(3) },
  center: { alignItems: 'center', justifyContent: 'center', padding: space(8) },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3.5), paddingHorizontal: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, minHeight: 56 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', backgroundColor: '#E9EDF2', borderRadius: radius.md, padding: 4, marginBottom: space(4) },
  segItem: { flex: 1, minHeight: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
