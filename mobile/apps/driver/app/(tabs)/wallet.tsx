import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { api, Banner, Button, Card, confirmWithBiometrics, Empty, ErrorText, Field, H1, H2, Loading, P, Pill, Row, Screen, Segmented, colors, date, money, type, useAuth, useDeviceRisk, type Wallet } from '@drop/shared';

/** Earnings wallet, withdrawals, bank account and DROP Driver Card. Screenshots are blocked here. */
export default function WalletScreen() {
  usePreventScreenCapture();
  const { user } = useAuth();
  const risky = useDeviceRisk();
  const [w, setW] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState({ holder: '', bank: '', accountNumber: '', branchCode: '', accountType: 'Cheque', currentPassword: '' });
  const [editBank, setEditBank] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setW(await api<Wallet>('/wallet')); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!w) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Loading />}</Screen>;
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); setError(''); setMsg(''); try { await fn(); setMsg(ok); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  const max = Math.max(0, w.balance - w.rules.withdrawalFee);
  const held = w.bankAccount?.holdUntil && Date.parse(w.bankAccount.holdUntil) > Date.now();

  return <Screen onRefresh={load}>
    <H1>Earnings</H1>
    {msg ? <Banner tone="success" icon="checkmark-circle" text={msg} /> : null}
    <ErrorText>{error}</ErrorText>
    <Card tone="navy">
      <Text style={{ color: '#C9D3E3', fontSize: 13 }}>Available balance</Text>
      <Text style={{ color: colors.white, fontSize: 36, fontWeight: '800', marginVertical: 4 }}>{money(w.balance)}</Text>
      <Text style={{ color: '#C9D3E3', fontSize: 12 }}>{w.pendingWithdrawals ? `${money(w.pendingWithdrawals)} on its way to your bank` : 'Withdraw any time after a trip'}</Text>
    </Card>
    {risky ? <Banner tone="warn" icon="warning" text="Withdrawals and bank changes are disabled on rooted or jailbroken phones. Use the DROP website or another phone." /> : <Card>
      <H2>Withdraw to your bank</H2>
      {!w.bankAccount ? <P muted>Add your bank account below first.</P> : held ? <Banner tone="warn" text={`New bank account: withdrawals open ${new Date(w.bankAccount.holdUntil!).toLocaleString('en-ZA')}.`} /> : <>
        <Field label={`Amount (R ${w.rules.minWithdrawal} – ${max.toFixed(2)})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Button title="Withdraw" busy={busy === 'wd'} disabled={!amount} onPress={async () => {
          if (!(await confirmWithBiometrics(`Withdraw R ${amount} to ${w.bankAccount!.bank} ${w.bankAccount!.masked}`))) return;
          void run('wd', async () => { await api('/wallet/withdrawals', { body: { amount: Number(amount) } }); setAmount(''); }, 'Withdrawal requested.');
        }} />
        <P muted>Fee R {w.rules.withdrawalFee}. Paid by EFT to {w.bankAccount.bank} {w.bankAccount.masked}.</P>
      </>}
    </Card>}
    <Card>
      <H2>Bank account</H2>
      {w.bankAccount && !editBank ? <><P>{w.bankAccount.holder} · {w.bankAccount.bank} {w.bankAccount.accountType} {w.bankAccount.masked}</P>{!risky && <Button title="Change bank account" variant="outline" onPress={() => setEditBank(true)} />}</> : !risky && <>
        <Field label="Account holder (must be you)" value={bank.holder} onChangeText={(v) => setBank((b) => ({ ...b, holder: v }))} autoComplete="name" />
        <Text style={type.label}>Bank</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>{w.banks.map((b) => <Pressable key={b} accessibilityRole="radio" accessibilityState={{ checked: bank.bank === b }} onPress={() => setBank((x) => ({ ...x, bank: b }))}><Pill label={b} tone={bank.bank === b ? 'brand' : 'neutral'} /></Pressable>)}</View>
        <Field label="Account number" value={bank.accountNumber} onChangeText={(v) => setBank((b) => ({ ...b, accountNumber: v }))} keyboardType="number-pad" />
        <Field label="Branch code" value={bank.branchCode} onChangeText={(v) => setBank((b) => ({ ...b, branchCode: v }))} keyboardType="number-pad" maxLength={6} />
        <Segmented label="Account type" options={['Cheque', 'Savings', 'Transmission']} value={bank.accountType} onChange={(v) => setBank((b) => ({ ...b, accountType: v }))} />
        {!user?.demo && <Field label="Your DROP password" value={bank.currentPassword} onChangeText={(v) => setBank((b) => ({ ...b, currentPassword: v }))} secureTextEntry hint="Confirms it’s really you. Withdrawals to a changed account start after 24 hours." />}
        <Button title="Save bank account" busy={busy === 'bank'} onPress={() => run('bank', async () => { await api('/wallet/bank-account', { method: 'PUT', body: bank }); setEditBank(false); setBank((b) => ({ ...b, accountNumber: '', currentPassword: '' })); }, 'Bank account saved.')} />
      </>}
    </Card>
    <Card>
      <H2>{w.cardProgramme.name}</H2>
      {w.card ? <>
        <Text style={[type.body, { fontWeight: '700', letterSpacing: 1 }]}>{w.card.maskedNumber}  ·  {w.card.validDate}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}><Pill label={w.card.status} tone={w.card.status === 'active' ? 'good' : 'warn'} />{w.card.sandbox && <Pill label="Sandbox" />}</View>
        <P muted>Spend on fuel and expenses from your balance. Limit R {w.cardProgramme.limits.perTransaction} per purchase, R {w.cardProgramme.limits.daily} per day (R {w.cardProgramme.limits.spentToday} used today).</P>
        {w.card.status === 'active' && <Button title="Freeze card" variant="outline" onPress={() => run('card', () => api('/wallet/card/freeze', { body: {} }), 'Card frozen.')} />}
        {w.card.status === 'frozen' && <Button title="Unfreeze card" onPress={() => run('card', () => api('/wallet/card/unfreeze', { body: {} }), 'Card active again.')} />}
        {['active', 'frozen'].includes(w.card.status) && <Button title="Report lost or stolen" variant="ghost" onPress={() => Alert.alert('Report your card?', 'The card is blocked permanently and can’t be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Lost', onPress: () => void run('card', () => api('/wallet/card/lost', { body: {} }), 'Card blocked.') }, { text: 'Stolen', style: 'destructive', onPress: () => void run('card', () => api('/wallet/card/stolen', { body: {} }), 'Card blocked.') }])} />}
      </> : w.cardProgramme.enabled ? <Button title="Get my DROP card" busy={busy === 'issue'} onPress={() => run('issue', () => api('/wallet/card', { body: {} }), 'Your virtual card is ready.')} /> : <P muted>The DROP card programme is coming soon.</P>}
    </Card>
    <H2>Activity</H2>
    {w.transactions.length === 0 ? <Empty text="No earnings yet." /> : w.transactions.slice(0, 30).map((t) => <Row key={t.id} icon={t.amount >= 0 ? 'arrow-down-circle' : 'arrow-up-circle'} title={t.memo} subtitle={date(t.createdAt)} right={<Text style={{ fontWeight: '700', color: t.amount >= 0 ? colors.success : colors.text }}>{t.amount >= 0 ? '+' : ''}{money(t.amount)}</Text>} />)}
  </Screen>;
}
