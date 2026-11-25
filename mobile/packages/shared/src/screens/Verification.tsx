import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { api, upload } from '../lib/api';
import type { Verification, VerificationProfile, Requirement, VerificationDoc } from '../types';
import { VERIFICATION_LABEL } from '../types';
import { Banner, Button, Card, ErrorText, Field, H1, H2, Loading, P, Pill, Screen, Segmented } from '../components/ui';
import { colors, type } from '../theme';

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
const docTone = (s?: string) => (s === 'approved' ? 'good' : s === 'rejected' || s === 'expired' ? 'bad' : s ? 'warn' : 'neutral') as 'good' | 'bad' | 'warn' | 'neutral';

/** Identity verification: personal details, ID and proof of address (plus driver documents), camera uploads. */
export function VerificationScreen() {
  const [v, setV] = useState<Verification | null>(null);
  const [p, setP] = useState<VerificationProfile>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [consent, setConsent] = useState(false);
  const [dates, setDates] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await api<{ verification: Verification }>('/verification'); setV(r.verification); setP({ ...r.verification.profile, idNumber: '' }); }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  if (!v) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  const locked = v.status === 'submitted' || v.status === 'verified';
  const set = (k: keyof VerificationProfile) => (val: string) => setP((x) => ({ ...x, [k]: val }));

  async function saveProfile() {
    setBusy('profile'); setError('');
    try { const r = await api<{ verification: Verification }>('/verification/profile', { method: 'PUT', body: p }); setV(r.verification); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function pick(req: Requirement, source: 'camera' | 'file') {
    setError('');
    let asset: { uri: string; name: string; mime: string } | null = null;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError('Allow camera access in Settings to take a photo.'); return; }
      const r = await ImagePicker.launchCameraAsync({ quality: 0.7, cameraType: req.type === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back, exif: false });
      if (!r.canceled) asset = { uri: r.assets[0].uri, name: `${req.type}.jpg`, mime: 'image/jpeg' };
    } else {
      const r = await DocumentPicker.getDocumentAsync({ type: req.imageOnly ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
      if (!r.canceled) asset = { uri: r.assets[0].uri, name: r.assets[0].name, mime: r.assets[0].mimeType || 'application/pdf' };
    }
    if (!asset) return;
    const form = new FormData();
    form.append('type', req.type);
    if (req.maxAgeDays) form.append('issuedAt', new Date().toISOString().slice(0, 10)); // proof of address: date issued (edit on the website if older)
    if (req.expires) form.append('expiresAt', dates[req.type] || '');
    form.append('file', { uri: asset.uri, name: asset.name, type: asset.mime } as unknown as Blob);
    setBusy(req.type);
    try { await upload('/verification/documents', form); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const current = (type: string): VerificationDoc | undefined => v.documents.filter((d) => d.type === type && !d.archived).at(-1);

  return <Screen onRefresh={() => void load()}>
    <H1>Verify your identity</H1>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><Pill label={VERIFICATION_LABEL[v.status]} tone={v.status === 'verified' ? 'good' : v.status === 'action_required' ? 'bad' : 'warn'} />{v.decisionNote ? <Text style={type.small}>{v.decisionNote}</Text> : null}</View>
    {v.status === 'verified' ? <Banner tone="success" icon="shield-checkmark" text="You’re verified. Thank you for helping keep DROP safe." />
      : <P muted>DROP checks every passenger and driver. You’ll need your ID (or passport) and a proof of address from the last 3 months. Your documents are encrypted and only seen by our compliance team.</P>}
    <View style={{ height: 12 }} />
    <Card>
      <H2>Your details</H2>
      <Field label="Full legal name (as on your ID)" value={p.legalName || ''} onChangeText={set('legalName')} editable={!locked} autoComplete="name" />
      <Segmented label="Identity document" options={['SA ID', 'Passport']} value={p.idType === 'passport' ? 'Passport' : 'SA ID'} onChange={(o) => !locked && setP((x) => ({ ...x, idType: o === 'Passport' ? 'passport' : 'sa_id' }))} />
      <Field label={p.idType === 'passport' ? 'Passport number' : 'SA ID number'} value={p.idNumber || ''} onChangeText={set('idNumber')} editable={!locked} keyboardType={p.idType === 'passport' ? 'default' : 'number-pad'} hint={v.profile.idNumber ? `Saved: ${v.profile.idNumber}. Leave blank to keep it.` : undefined} autoCapitalize="characters" />
      {p.idType === 'passport' && <Field label="Date of birth (YYYY-MM-DD)" value={p.dateOfBirth || ''} onChangeText={set('dateOfBirth')} editable={!locked} keyboardType="numbers-and-punctuation" />}
      <Field label="Nationality" value={p.nationality || ''} onChangeText={set('nationality')} editable={!locked} />
      <Field label="Street address" value={p.addressLine1 || ''} onChangeText={set('addressLine1')} editable={!locked} autoComplete="street-address" />
      <Field label="Suburb" value={p.suburb || ''} onChangeText={set('suburb')} editable={!locked} />
      <Field label="City or town" value={p.city || ''} onChangeText={set('city')} editable={!locked} />
      <Text style={type.label}>Province</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>{PROVINCES.map((pr) => <Pressable key={pr} accessibilityRole="radio" accessibilityState={{ checked: p.province === pr }} disabled={locked} onPress={() => setP((x) => ({ ...x, province: pr }))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: p.province === pr ? colors.navy : colors.line, backgroundColor: p.province === pr ? colors.navy : colors.white }}><Text style={{ color: p.province === pr ? colors.white : colors.navy, fontSize: 13 }}>{pr}</Text></Pressable>)}</View>
      <Field label="Postal code" value={p.postalCode || ''} onChangeText={set('postalCode')} editable={!locked} keyboardType="number-pad" maxLength={4} />
      {v.role === 'driver' && <><Field label="Emergency contact name" value={p.emergencyName || ''} onChangeText={set('emergencyName')} editable={!locked} /><Field label="Emergency contact number" value={p.emergencyPhone || ''} onChangeText={set('emergencyPhone')} editable={!locked} keyboardType="phone-pad" /></>}
      {v.role === 'business' && <><Field label="Registered company name" value={p.companyName || ''} onChangeText={set('companyName')} editable={!locked} /><Field label="Company registration number" value={p.registrationNumber || ''} onChangeText={set('registrationNumber')} editable={!locked} hint="e.g. 2018/079316/07" /></>}
      {!locked && <Button title="Save details" variant="navy" busy={busy === 'profile'} onPress={saveProfile} />}
    </Card>
    <H2>Documents</H2>
    {v.requirements.map((req) => {
      const d = current(req.type);
      return <Card key={req.type}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={[type.body, { fontWeight: '700', flex: 1 }]}>{req.label}{req.required ? '' : ' (optional)'}</Text><Pill label={d ? d.status : 'Not uploaded'} tone={docTone(d?.status)} /></View>
        <Text style={[type.small, { marginVertical: 6 }]}>{req.hint}</Text>
        {d?.reason ? <Banner tone="danger" text={d.reason} /> : null}
        {req.expires && !locked && <Field label="Expiry date (YYYY-MM-DD)" value={dates[req.type] || ''} onChangeText={(x) => setDates((o) => ({ ...o, [req.type]: x }))} keyboardType="numbers-and-punctuation" />}
        {!locked && <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Take photo" icon="camera" variant="outline" busy={busy === req.type} onPress={() => pick(req, 'camera')} /></View>
          {!req.imageOnly && <View style={{ flex: 1 }}><Button title="Choose file" icon="document" variant="outline" onPress={() => pick(req, 'file')} /></View>}
        </View>}
      </Card>;
    })}
    <ErrorText>{error}</ErrorText>
    {!locked && <Card tone="soft">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Switch value={consent} onValueChange={setConsent} accessibilityLabel="I consent to DROP verifying my identity" /><Text style={[type.small, { flex: 1 }]}>I confirm these documents are mine and consent to DROP verifying them (POPIA).</Text></View>
      <Button title="Submit for review" busy={busy === 'submit'} disabled={!consent} onPress={async () => { setBusy('submit'); setError(''); try { const r = await api<{ verification: Verification }>('/verification/submit', { body: { consent: true } }); setV(r.verification); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }} />
    </Card>}
  </Screen>;
}
