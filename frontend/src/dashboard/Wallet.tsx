import { useCallback, useEffect, useState } from 'react';
import { api, date, money, type DropCard, type Wallet as WalletData } from '../lib/api';
import { useAuth } from '../lib/auth';
import { button, outline, limeButton, input, Field, ErrorText, Icon, Spinner, StatusPill } from '../components/ui';
import { Empty, Loading, type Notify } from './common';

function CardFace({ card, programme }: { card: DropCard; programme: string }) {
  const frozen = card.status !== 'active';
  return <div className={`relative aspect-[1.586] w-full max-w-sm overflow-hidden rounded-2xl p-5 text-white shadow-xl transition ${frozen ? 'bg-[#4b5668]' : 'bg-navy'}`}>
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 340 214" preserveAspectRatio="none" aria-hidden="true"><path d="M-10 190 C 90 190 130 120 210 120 S 320 70 360 40" fill="none" stroke="#FF6B00" strokeWidth="3" opacity={frozen ? 0.4 : 0.9} /></svg>
    <div className="relative flex h-full flex-col justify-between">
      <div className="flex items-start justify-between"><img src="/brand/drop-logo-horizontal-dark.svg" alt="DROP" className="h-7" /><span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{card.type}</span></div>
      <div><p className="font-mono text-lg tracking-[3px]">{card.maskedNumber}</p><div className="mt-2 flex items-end justify-between text-[11px] text-white/70"><span>{programme}</span><span>VALID {card.validDate}</span></div></div>
    </div>
    {frozen && <span className="absolute right-4 top-12 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase text-navy">{card.status === 'frozen' ? 'Frozen' : 'Stopped'}</span>}
  </div>;
}

export function WalletPanel({ notify }: { notify: Notify }) {
  const { user } = useAuth();
  const [w, setW] = useState<WalletData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [amount, setAmount] = useState('');
  const [editBank, setEditBank] = useState(false);
  const load = useCallback(async () => { try { setW(await api<WalletData>('/wallet')); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  if (!w) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const verified = user?.verificationStatus === 'verified';
  const maxOut = Math.max(0, w.balance - w.rules.withdrawalFee);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setError('');
    try { await fn(); notify(ok); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl bg-navy p-6 text-white lg:col-span-2">
        <p className="text-[12px] font-bold uppercase tracking-[1.6px] text-orange">DROP wallet</p>
        <p className={`mt-2 font-display text-5xl font-extrabold tracking-tight ${w.balance < 0 ? 'text-[#ff9b9b]' : ''}`}>{money(w.balance)}</p>
        <p className="mt-2 text-sm text-[#c9d3e3]">{w.balance < 0 ? `You owe DROP service fees from cash trips. Card and business trips top this up automatically. Limit: ${money(w.rules.cashDebtLimit)}.` : 'Earnings from completed trips land here. Spend with your DROP card or withdraw to your bank.'}{w.pendingWithdrawals > 0 && ` ${money(w.pendingWithdrawals)} is on its way to your bank.`}</p>
        <div className="mt-5 grid grid-cols-3 gap-3 text-[13px]"><div><span className="block text-[#8fa0b8]">Card limit / purchase</span><b>{money(w.cardProgramme.limits.perTransaction)}</b></div><div><span className="block text-[#8fa0b8]">Daily card limit</span><b>{money(w.cardProgramme.limits.daily)}</b></div><div><span className="block text-[#8fa0b8]">Spent today</span><b>{money(w.cardProgramme.limits.spentToday)}</b></div></div>
      </div>
      <div className="rounded-2xl border border-[#e3e8ef] p-5">
        <h4 className="font-display font-extrabold">Withdraw to bank</h4>
        {!verified ? <p className="mt-2 text-sm text-[#5b6b82]">Complete your verification to withdraw.</p> : !w.bankAccount ? <p className="mt-2 text-sm text-[#5b6b82]">Add your bank account below to withdraw.</p> : <>
          <p className="mt-1 text-[13px] text-[#5b6b82]">To {w.bankAccount.bank} {w.bankAccount.masked}. Paid by EFT, usually within 1 working day.{w.rules.withdrawalFee > 0 && ` Fee ${money(w.rules.withdrawalFee)}.`}</p>
          <div className="mt-3 flex gap-2"><input className={input} type="number" inputMode="decimal" min={w.rules.minWithdrawal} max={maxOut} step="0.01" placeholder={`R ${w.rules.minWithdrawal} – ${maxOut.toFixed(2)}`} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Withdrawal amount" /><button className={`${button} shrink-0`} disabled={!!busy || !amount} onClick={() => act('wd', () => api('/wallet/withdrawals', { body: { amount: Number(amount) } }).then(() => setAmount('')), 'Withdrawal requested.')}>{busy === 'wd' ? <Spinner /> : 'Withdraw'}</button></div>
          <button className="mt-2 text-[12px] font-semibold underline" onClick={() => setAmount(maxOut.toFixed(2))}>Withdraw everything ({money(maxOut)})</button>
        </>}
      </div>
    </div>
    <ErrorText>{error}</ErrorText>

    <section className="grid gap-6 rounded-2xl border border-[#e3e8ef] p-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div>{w.card ? <CardFace card={w.card} programme={w.cardProgramme.name} /> : <div className="flex aspect-[1.586] w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#cbd3de] p-6 text-center text-sm text-[#5b6b82]"><Icon name="wallet" size={32} />No DROP card yet</div>}</div>
      <div className="grid content-start gap-4">
        <div><h4 className="font-display text-lg font-extrabold">{w.cardProgramme.name}</h4><p className="mt-1 text-sm leading-6 text-[#5b6b82]">A payment card issued through Paymentology that spends straight from your DROP wallet. Use it for fuel, tolls, parking, repairs and everyday expenses. Gambling and similar merchants are blocked.</p>
          {w.cardProgramme.sandbox && <p className="mt-2 rounded-lg bg-orange/10 p-3 text-[13px] text-orange-dark"><b>Sandbox mode:</b> cards are test cards and cannot be used in shops. Switch PAYMENTOLOGY_MODE to live after Paymentology onboarding.</p>}</div>
        {!w.cardProgramme.enabled ? <p className="text-sm text-[#5b6b82]">The card programme is not live yet. Your wallet and withdrawals work in the meantime.</p>
          : !w.card ? <button className={`${limeButton} w-fit`} disabled={!verified || !!busy} onClick={() => act('issue', () => api('/wallet/card', { body: {} }), 'Your DROP card is ready.')}>{busy === 'issue' ? <Spinner /> : <Icon name="plus" size={16} />}{verified ? 'Get my DROP card' : 'Verify to get a card'}</button>
          : <div className="flex flex-wrap gap-3">
            {w.card.status === 'active' && <button className={outline} disabled={!!busy} onClick={() => act('freeze', () => api('/wallet/card/freeze', { body: {} }), 'Card frozen. No payments will go through.')}>Freeze card</button>}
            {w.card.status === 'frozen' && <button className={button} disabled={!!busy} onClick={() => act('unfreeze', () => api('/wallet/card/unfreeze', { body: {} }), 'Card unfrozen.')}>Unfreeze card</button>}
            <select className={`${input} w-auto`} defaultValue="" aria-label="Report card" onChange={(e) => { const reason = e.target.value; e.target.value = ''; if (reason && window.confirm(`Stop this card permanently as ${reason}? This cannot be undone. You can order a replacement straight away.`)) void act('report', () => api('/wallet/card/report', { body: { reason } }), 'Card stopped. You can order a replacement now.'); }}><option value="" disabled>Report lost / stolen…</option><option value="lost">Lost</option><option value="stolen">Stolen</option><option value="fraud">Payment I don’t recognise</option></select>
          </div>}
        {w.declined.length > 0 && <div><p className="mb-2 text-sm font-semibold">Recent declined payments</p><ul className="grid gap-1 text-[13px]">{w.declined.slice(0, 4).map((d) => <li key={d.id} className="flex justify-between gap-3 rounded-lg bg-[#fff7f7] px-3 py-2"><span>{d.merchant} · {d.reason}</span><span>{money(d.amount)}</span></li>)}</ul></div>}
      </div>
    </section>

    <section className="rounded-2xl border border-[#e3e8ef] p-5">
      <div className="mb-3 flex items-center justify-between"><h4 className="font-display text-lg font-extrabold">Bank account</h4>{w.bankAccount && !editBank && <button className="text-sm font-semibold underline" onClick={() => setEditBank(true)}>Change</button>}</div>
      {w.bankAccount && !editBank ? <p className="text-sm">{w.bankAccount.holder} · {w.bankAccount.bank} {w.bankAccount.accountType} {w.bankAccount.masked} · branch {w.bankAccount.branchCode}</p> :
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); void act('bank', () => api('/wallet/bank-account', { method: 'PUT', body: f }).then(() => setEditBank(false)), 'Bank account saved.'); }}>
          <Field label="Account holder" hint="Must be you, as on your ID"><input name="holder" required className={input} autoComplete="name" /></Field>
          <Field label="Bank"><select name="bank" required className={input} defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...w.banks.map((b) => <option key={b}>{b}</option>)]}</select></Field>
          <Field label="Account number"><input name="accountNumber" required inputMode="numeric" className={input} autoComplete="off" /></Field>
          <Field label="Branch code" hint="Universal branch code, 6 digits"><input name="branchCode" required inputMode="numeric" maxLength={6} className={input} /></Field>
          <Field label="Account type"><select name="accountType" className={input}><option>Cheque</option><option>Savings</option><option>Transmission</option></select></Field>
          <div className="flex items-end gap-3"><button className={button} disabled={!!busy}>Save bank account</button>{editBank && <button type="button" className="text-sm underline" onClick={() => setEditBank(false)}>Cancel</button>}</div>
          <p className="text-[12px] text-[#5b6b82] md:col-span-2">Your account number is encrypted. You’ll get a notification whenever it changes.</p>
        </form>}
    </section>

    <section className="rounded-2xl border border-[#e3e8ef] p-5">
      <h4 className="mb-3 font-display text-lg font-extrabold">Wallet activity</h4>
      {!w.transactions.length ? <Empty>No activity yet. Complete a trip to see your earnings here.</Empty> : <ul className="divide-y divide-[#eef1f5]">{w.transactions.map((t) => <li key={t.id} className="flex items-center justify-between gap-4 py-3 text-sm">
        <span className="flex min-w-0 items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.amount >= 0 ? 'bg-[#e8f5ee] text-[#17744a]' : 'bg-grey text-navy'}`}><Icon name={t.type.startsWith('card') ? 'wallet' : t.type.startsWith('withdrawal') ? 'building' : 'car'} size={16} /></span><span className="min-w-0"><b className="block truncate">{t.memo}</b><span className="text-[12px] text-[#5b6b82]">{date(t.createdAt)}{t.meta?.category && t.type === 'card.purchase' ? ` · ${t.meta.category}` : ''}</span></span></span>
        <b className={t.amount >= 0 ? 'text-[#17744a]' : ''}>{t.amount >= 0 ? '+' : '−'}{money(Math.abs(t.amount))}</b></li>)}</ul>}
      {w.withdrawals.length > 0 && <><h4 className="mb-2 mt-6 text-sm font-semibold">Withdrawals</h4><ul className="grid gap-2 text-sm">{w.withdrawals.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-grey px-3 py-2"><span>{x.ref} · {money(x.amount)} to {x.bank} {x.masked}{x.bankReference && ` · ref ${x.bankReference}`}{x.reason && ` · ${x.reason}`}</span><StatusPill status={x.status === 'requested' ? 'processing' : x.status} /></li>)}</ul></>}
    </section>
  </div>;
}
