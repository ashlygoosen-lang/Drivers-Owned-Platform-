import { useState } from 'react';
import { Redirect } from 'expo-router';
import { Button, ErrorText, Field, H1, Legal, P, Screen, Segmented, useAuth } from '@drop/shared';

export default function Register() {
  const { user, register } = useAuth();
  const [kind, setKind] = useState<'Personal' | 'Business'>('Personal');
  const [f, setF] = useState({ name: '', company: '', phone: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Redirect href="/verification" />;
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return <Screen>
    <H1>Create your account</H1>
    <P muted>Upfront fares, zero passenger commission, and drivers who own the platform.</P>
    <Segmented label="Account type" options={['Personal', 'Business']} value={kind} onChange={setKind} />
    <Field label="Full name" value={f.name} onChangeText={set('name')} autoComplete="name" textContentType="name" />
    {kind === 'Business' && <Field label="Company name" value={f.company} onChangeText={set('company')} />}
    <Field label="Mobile number" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" placeholder="+27 82 000 0000" />
    <Field label="Email address" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" />
    <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters with letters and numbers." />
    <ErrorText>{error}</ErrorText>
    <Button title="Create my account" busy={busy} disabled={!f.name || !f.email || !f.password} onPress={async () => {
      setBusy(true); setError('');
      try { await register({ ...f, email: f.email.trim(), role: kind === 'Business' ? 'business' : 'passenger' }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} />
    <Legal />
  </Screen>;
}
