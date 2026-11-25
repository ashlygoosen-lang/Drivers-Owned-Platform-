import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { APP, PRIVACY_URL, TERMS_URL } from '../lib/config';
import type { User } from '../types';
import { Banner, Button, ErrorText, Field, H1, P, Screen } from '../components/ui';
import { colors, type } from '../theme';

/** Sign in, including the authenticator-app step when two-step sign-in is on. */
export function SignInScreen({ onForgot, onCreate, createLabel }: { onForgot: () => void; onCreate: () => void; createLabel: string }) {
  const { signIn, finishMfa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState<{ mfaToken: string; kind: 'verify' | 'setup' } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError('');
    try { const r = await signIn(email.trim(), password); if ('mfa' in r) setMfa({ mfaToken: r.mfaToken, kind: r.mfa }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    if (!mfa) return;
    setBusy(true); setError('');
    try { await finishMfa(await api<{ token: string; refreshToken?: string; user: User }>('/auth/mfa/verify', { body: { mfaToken: mfa.mfaToken, ...(recovery ? { recoveryCode: code } : { code }) } })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (mfa?.kind === 'setup') return <Screen><H1>Two-step sign-in</H1><Banner tone="warn" text="This account needs two-step sign-in. Please set it up on the DROP website first, then sign in here." /><Button title="Back" variant="outline" onPress={() => setMfa(null)} /></Screen>;
  if (mfa) return <Screen>
    <H1>Enter your code</H1>
    <P muted>{recovery ? 'Enter one of the recovery codes you saved.' : 'Open your authenticator app and enter the 6-digit code for DROP.'}</P>
    <View style={{ height: 16 }} />
    <Field label={recovery ? 'Recovery code' : '6-digit code'} value={code} onChangeText={setCode} keyboardType={recovery ? 'default' : 'number-pad'} autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={recovery ? 11 : 6} autoFocus />
    <ErrorText>{error}</ErrorText>
    <Button title="Verify and sign in" onPress={verify} busy={busy} disabled={!code} />
    <Button title={recovery ? 'Use my authenticator app' : 'Lost your phone? Use a recovery code'} variant="ghost" onPress={() => { setRecovery(!recovery); setCode(''); }} />
  </Screen>;

  return <Screen>
    <H1>{APP === 'driver' ? 'DROP Driver' : 'Welcome to DROP'}</H1>
    <P muted>{APP === 'driver' ? 'Sign in to go online, take trips and manage your earnings.' : 'Ride smart. Go further.'}</P>
    <View style={{ height: 20 }} />
    <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" />
    <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
    <ErrorText>{error}</ErrorText>
    <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
    <Button title="Forgot your password?" variant="ghost" onPress={onForgot} />
    <View style={{ height: 12 }} />
    <Button title={createLabel} variant="outline" onPress={onCreate} />
    <Legal />
  </Screen>;
}

export function Legal() {
  return <Text style={[type.small, { textAlign: 'center', marginTop: 16 }]}>By continuing you agree to the <Text style={{ color: colors.navy, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(TERMS_URL)}>terms</Text> and <Text style={{ color: colors.navy, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(PRIVACY_URL)}>privacy policy</Text>. DROP is a division of VINK Group (Pty) Ltd.</Text>;
}

export function ForgotScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Screen>
    <H1>Reset your password</H1>
    {sent ? <><Banner tone="success" icon="mail" text={sent} /><Button title="Back to sign in" onPress={onBack} /></> : <>
      <P muted>Enter the email you use for DROP. We’ll send a link to choose a new password.</P>
      <View style={{ height: 16 }} />
      <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <ErrorText>{error}</ErrorText>
      <Button title="Send reset link" busy={busy} disabled={!email} onPress={async () => { setBusy(true); setError(''); try { setSent((await api<{ message: string }>('/auth/password/forgot', { body: { email: email.trim() } })).message); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />
      <Button title="Back" variant="ghost" onPress={onBack} />
    </>}
  </Screen>;
}

/** Opened from the email link (universal link / app link). */
export function ResetScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Screen>
    <H1>Choose a new password</H1>
    {done ? <><Banner tone="success" icon="checkmark-circle" text={done} /><Button title="Sign in" onPress={onDone} /></> : <>
      <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters with letters and numbers." />
      <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      <ErrorText>{error}</ErrorText>
      <Button title="Save new password" busy={busy} disabled={!pw || !confirm} onPress={async () => {
        if (pw !== confirm) { setError('The two passwords don’t match.'); return; }
        setBusy(true); setError('');
        try { setDone((await api<{ message: string }>('/auth/password/reset', { body: { token, newPassword: pw } })).message); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }} />
    </>}
  </Screen>;
}
