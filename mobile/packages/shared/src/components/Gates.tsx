import { useEffect, useState } from 'react';
import { Image, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { rawApi } from '../lib/api';
import { APP, VERSION } from '../lib/config';
import { useAppLock, useDeviceRisk } from '../lib/security';
import { colors } from '../theme';
import { Banner, Button } from './ui';

/** Blocks the app when this version is too old (force update) or DROP is in maintenance. */
export function UpdateGate({ children, logo }: { children: React.ReactNode; logo?: number }) {
  const [cfg, setCfg] = useState<{ forceUpdate: boolean; updateAvailable: boolean; storeUrl: string; maintenance: boolean } | null>(null);
  useEffect(() => { rawApi<typeof cfg>(`/app/config?app=${APP}&platform=${Platform.OS}&version=${VERSION}`).then(setCfg).catch(() => setCfg(null)); }, []);
  if (cfg?.forceUpdate) return <Blocker logo={logo} title="Please update DROP" text="This version is no longer supported. Update to keep riding safely." action={{ title: 'Update now', onPress: () => Linking.openURL(cfg.storeUrl) }} />;
  if (cfg?.maintenance) return <Blocker logo={logo} title="Back shortly" text="DROP is down for a short maintenance break. Please try again in a few minutes." />;
  return <>{children}{cfg?.updateAvailable && <View style={{ position: 'absolute', bottom: 90, left: 16, right: 16 }}><Banner tone="info" text="A new version of DROP is available in the store." /></View>}</>;
}

/** Biometric lock screen after time away (when the user switched it on). */
export function AppLock({ children }: { children: React.ReactNode }) {
  const { locked, unlock } = useAppLock();
  useEffect(() => { if (locked) void unlock(); }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children}{locked && <View style={[StyleSheet.absoluteFill, st.lock]}><Text style={st.title}>DROP is locked</Text><Button title="Unlock" icon="finger-print" onPress={unlock} /></View>}</>;
}

/** Warning on rooted/jailbroken devices. Money actions check `useDeviceRisk()` too. */
export function RiskBanner() {
  const risky = useDeviceRisk();
  return risky ? <Banner tone="warn" icon="warning" text="This phone appears to be rooted or jailbroken, which makes it easier for malware to steal data. Some money features are limited on this device." /> : null;
}

function Blocker({ title, text, action, logo }: { title: string; text: string; action?: { title: string; onPress: () => void }; logo?: number }) {
  return <View style={st.block}>{logo ? <Image source={logo} style={{ width: 96, height: 96, marginBottom: 20 }} accessibilityIgnoresInvertColors /> : null}<Text style={st.title} accessibilityRole="header">{title}</Text><Text style={st.text}>{text}</Text>{action && <Button title={action.title} onPress={action.onPress} />}</View>;
}
const st = StyleSheet.create({
  block: { flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lock: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 100 },
  title: { color: colors.white, fontSize: 26, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  text: { color: '#C9D3E3', fontSize: 15, textAlign: 'center', marginBottom: 20, lineHeight: 22 },
});
