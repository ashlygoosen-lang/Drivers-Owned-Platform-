import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { api, Button, ErrorText, Field, H1, H2, Legal, P, Screen, type, useAuth, VehiclePicker, emptyVehicleChoice, vehicleChoiceBody, type User, type VehicleChoice } from '@drop/shared';

/** Driver application: account + vehicle. Documents are uploaded next, in Verification. */
export default function Apply() {
  const { user, finishMfa } = useAuth();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', city: '' });
  const [vehicle, setVehicle] = useState<VehicleChoice>(emptyVehicleChoice);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Redirect href="/verification" />;
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return <Screen>
    <H1>Drive with DROP</H1>
    <P muted>Keep 90% of every fare, earn ownership in the platform, and get a DROP Driver Card for fuel and expenses.</P>
    <View style={{ height: 12 }} />
    <Field label="Full name (as on your ID)" value={f.name} onChangeText={set('name')} autoComplete="name" />
    <Field label="Email address" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
    <Field label="Mobile number" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
    <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" hint="At least 8 characters with letters and numbers." />
    <Field label="City" value={f.city} onChangeText={set('city')} />
    <H2>Your vehicle</H2>
    <VehiclePicker value={vehicle} onChange={setVehicle} />
    <View style={{ height: 12 }} />
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }}><Switch value={consent} onValueChange={setConsent} accessibilityLabel="Accept the driver programme terms" /><Text style={[type.small, { flex: 1 }]}>I accept the DROP driver-owner programme terms and consent to background checks.</Text></View>
    <ErrorText>{error}</ErrorText>
    <Button title="Submit application" busy={busy} disabled={!consent || !f.name || !f.email || !f.password || !vehicle.type || !vehicle.year || !vehicle.plate} onPress={async () => {
      setBusy(true); setError('');
      try {
        const r = await api<{ token: string; refreshToken?: string; user: User }>('/drivers/apply', { body: { ...f, email: f.email.trim(), vehicleDetails: vehicleChoiceBody(vehicle), consent: true } });
        await finishMfa(r);
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} />
    <Legal />
  </Screen>;
}
