import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PRIVACY_URL, TERMS_URL, VERSION } from '../lib/config';
import { secure, KEYS } from '../lib/secureStore';
import { confirmWithBiometrics } from '../lib/security';
import type { Notice, Ticket, User } from '../types';
import { date } from '../types';
import { Banner, Button, Card, Empty, ErrorText, Field, H1, H2, Loading, P, Row, Screen, Segmented } from '../components/ui';
import { type } from '../theme';

/** Profile, password, two-step sign-in, app lock, sign out everywhere, delete account, legal. */
export function AccountScreen({ onVerification, onSupport, extraRows }: { onVerification: () => void; onSupport: () => void; extraRows?: React.ReactNode }) {
  const { user, setUser, signOut } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [bio, setBio] = useState(false);
  const [mfa, setMfa] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [del, setDel] = useState({ password: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { secure.get(KEYS.biometric).then((v) => setBio(v === 'on')); }, []);
  if (!user) return null;

  const run = async (fn: () => Promise<unknown>, ok: string) => { setError(''); setMsg(''); try { await fn(); setMsg(ok); } catch (e) { setError((e as Error).message); } };
  return <Screen>
    <H1>Account</H1>
    {msg ? <Banner tone="success" icon="checkmark-circle" text={msg} /> : null}
    <ErrorText>{error}</ErrorText>
    <Card>
      <Row icon="shield-checkmark" title="Identity verification" subtitle={user.verificationStatus === 'verified' ? 'Verified' : 'Upload your ID and proof of address'} onPress={onVerification} />
      <Row icon="help-buoy" title="Help and support" subtitle="Report a problem, lost item or safety concern" onPress={onSupport} />
      {extraRows}
    </Card>
    <Card>
      <H2>Your details</H2>
      <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" hint="Used for calls on your trips. DROP can hide it from drivers." />
      <Text style={[type.small, { marginBottom: 8 }]}>{user.email}</Text>
      <Button title="Save details" variant="navy" onPress={() => run(async () => setUser((await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { name, phone } })).user), 'Saved.')} />
    </Card>
    <Card>
      <H2>Change password</H2>
      <Field label="Current password" value={cur} onChangeText={setCur} secureTextEntry autoComplete="password" />
      <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" hint="This signs you out on your other devices." />
      <Button title="Change password" variant="outline" disabled={!cur || !next} onPress={() => run(async () => { await api('/auth/me', { method: 'PATCH', body: { currentPassword: cur, newPassword: next } }); setCur(''); setNext(''); await signOut(); }, 'Password changed. Please sign in again.')} />
    </Card>
    <Card>
      <H2>Sign-in security</H2>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Text style={[type.body, { flex: 1 }]}>Lock DROP with Face ID / fingerprint after 5 minutes away</Text>
        <Switch value={bio} accessibilityLabel="Biometric app lock" onValueChange={async (on) => { if (on && !(await confirmWithBiometrics('Turn on app lock'))) return; await secure.set(KEYS.biometric, on ? 'on' : null); setBio(on); }} />
      </View>
      {user.mfaEnabled ? <P muted>Two-step sign-in is on.</P> : codes ? <>
        <Banner tone="success" text="Two-step sign-in is on. Save these recovery codes somewhere safe. They won’t be shown again." />
        <Text selectable style={{ fontFamily: 'Courier', fontSize: 15, lineHeight: 24 }}>{codes.join('\n')}</Text>
        <Button title="Copy codes" variant="outline" onPress={() => Clipboard.setStringAsync(codes.join('\n'))} />
      </> : mfa ? <>
        <P muted>Add DROP to your authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then enter the 6-digit code.</P>
        <Button title="Open authenticator app" icon="key" variant="outline" onPress={() => Linking.openURL(mfa.otpauthUrl).catch(() => setError('No authenticator app found. Copy the key instead.'))} />
        <Text selectable style={[type.small, { marginVertical: 8 }]}>Key: {mfa.secret.match(/.{1,4}/g)?.join(' ')}</Text>
        <Button title="Copy key" variant="ghost" onPress={() => Clipboard.setStringAsync(mfa.secret)} />
        <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
        <Button title="Turn on" disabled={code.length !== 6} onPress={() => run(async () => { const r = await api<{ recoveryCodes: string[]; user: User }>('/auth/mfa/confirm', { body: { code } }); setCodes(r.recoveryCodes); setUser(r.user); setMfa(null); }, 'Two-step sign-in is on.')} />
      </> : <Button title="Turn on two-step sign-in" variant="outline" icon="lock-closed" onPress={() => run(async () => setMfa(await api('/auth/mfa/setup', { body: {} })), '')} />}
      <Button title="Sign out everywhere" variant="ghost" onPress={() => Alert.alert('Sign out everywhere?', 'This signs you out on every phone and browser, including this one.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void run(async () => { await api('/auth/logout-all', { body: {} }); await signOut(); }, '') }])} />
    </Card>
    <Button title="Sign out" variant="navy" icon="log-out" onPress={() => void signOut()} />
    <Card style={{ marginTop: 16 }}>
      <H2>Delete account</H2>
      <P muted>Removes your name, contact details, saved places, bank account and devices. Trip and payment records are kept as tax law requires; identity documents are kept for the legal period (5 years) and then erased.</P>
      <Field label="Password" value={del.password} onChangeText={(x) => setDel((d) => ({ ...d, password: x }))} secureTextEntry />
      <Field label="Type DELETE to confirm" value={del.confirm} onChangeText={(x) => setDel((d) => ({ ...d, confirm: x }))} autoCapitalize="characters" />
      <Button title="Delete my account" variant="danger" disabled={!del.password || del.confirm.toUpperCase() !== 'DELETE'} onPress={() => run(async () => { await api('/auth/delete-account', { body: del }); await signOut(); }, 'Your account has been deleted.')} />
    </Card>
    <Row icon="document-text" title="Privacy policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
    <Row icon="reader" title="Terms of use" onPress={() => Linking.openURL(TERMS_URL)} />
    <Text style={[type.small, { textAlign: 'center', marginTop: 16 }]}>Version {VERSION} · DROP, a division of VINK Group (Pty) Ltd · 2018/079316/07</Text>
  </Screen>;
}

export function NotificationsScreen({ onOpen }: { onOpen: (link: string) => void }) {
  const [data, setData] = useState<{ notifications: Notice[]; unread: number } | null>(null);
  const load = useCallback(async () => setData(await api('/notifications')), []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Screen><Loading /></Screen>;
  return <Screen onRefresh={() => void load()}>
    <H1>Notifications</H1>
    {data.unread > 0 && <Button title="Mark all as read" variant="ghost" onPress={async () => { await api('/notifications/read', { body: {} }); void load(); }} />}
    {data.notifications.length === 0 ? <Empty text="No notifications yet." icon="notifications-outline" /> : data.notifications.map((n) => <Row key={n.id} icon={n.read ? 'mail-open-outline' : 'mail-unread'} title={n.title} subtitle={`${n.body} · ${date(n.createdAt)}`} onPress={() => onOpen(n.link)} />)}
  </Screen>;
}

const TICKET_TYPES = ['Trip problem', 'Lost item', 'Payment or fee dispute', 'Safety concern', 'Account or verification', 'Other'];
export function SupportScreen() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [kind, setKind] = useState(TICKET_TYPES[0]);
  const [ref, setRef] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setTickets((await api<{ tickets: Ticket[] }>('/support/tickets')).tickets), []);
  useEffect(() => { void load(); }, [load]);
  return <Screen onRefresh={() => void load()}>
    <H1>Help and support</H1>
    <Banner tone="danger" icon="warning" text="In an emergency call SAPS on 10111, or 112 from a mobile phone." />
    <Button title="Call 10111" variant="danger" icon="call" onPress={() => Linking.openURL('tel:10111')} />
    <Card>
      <H2>Contact DROP</H2>
      <Segmented label="Type" options={['Trip problem', 'Lost item', 'Safety concern']} value={(['Trip problem', 'Lost item', 'Safety concern'].includes(kind) ? kind : 'Trip problem') as 'Trip problem'} onChange={setKind} />
      <Field label="Trip reference (optional)" value={ref} onChangeText={setRef} placeholder="DRP-1001" autoCapitalize="characters" />
      <Field label="What happened?" value={message} onChangeText={setMessage} multiline style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }} maxLength={2000} />
      <ErrorText>{error}</ErrorText>
      <Button title="Send to support" busy={busy} disabled={message.trim().length < 10} onPress={async () => { setBusy(true); setError(''); try { await api('/support/tickets', { body: { type: kind, priority: kind === 'Safety concern' ? 'urgent' : 'normal', bookingRef: ref, message } }); setMessage(''); setRef(''); void load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />
    </Card>
    <H2>Your requests</H2>
    {!tickets ? <Loading /> : tickets.length === 0 ? <Empty text="No support requests yet." /> : tickets.map((t) => <Card key={t.id}><Text style={[type.body, { fontWeight: '700' }]}>{t.ref} · {t.type}</Text><Text style={type.small}>{t.status} · {date(t.createdAt)}</Text><P style={{ marginTop: 6 }}>{t.message}</P>{t.replies.map((r, i) => <Text key={i} style={[type.small, { marginTop: 6 }]}>↳ {r.by}: {r.message}</Text>)}</Card>)}
  </Screen>;
}
