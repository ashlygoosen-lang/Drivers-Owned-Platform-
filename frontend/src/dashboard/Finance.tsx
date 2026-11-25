import { useStepUp, downloadProtected } from '../lib/stepUp';
import { useState } from 'react';
import { api, date, money, token, type FinanceOverview, type Withdrawal } from '../lib/api';
import { button, outline, input, ErrorText, Icon, StatusPill } from '../components/ui';
import { Empty, Loading, Table, useLoad, type Notify } from './common';

const ACCOUNT_LABEL: Record<string, string> = { pool: 'Pool bank account', escrow: 'Held for open trips', fees: 'DROP service fees', card_settlement: 'Card spend owed to scheme', payouts_pending: 'Withdrawals to pay', 'receivable:business': 'Business accounts owing' };

async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${token.get()}` } });
  if (!res.ok) throw new Error('Download failed.');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function FinanceOverviewPanel({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad<FinanceOverview>('/finance/overview');
  const [error, setError] = useState('');
  if (!data) return <Loading />;
  const tiles: [string, number, string][] = [
    ['Pool account (ledger)', data.pool, 'Should match the pool bank statement'], ['Owed to drivers', data.driverWallets, `${data.driversInDebt} driver(s) owe cash fees`],
    ['Held for open trips', data.escrow, 'Paid, trip not finished'], ['Withdrawals to pay', data.payoutsPending, `${data.withdrawalsRequested} request(s)`],
    ['Card spend owed', data.cardSettlement, 'Settle to the scheme from the pool'], ['DROP fees earned', data.fees, 'Revenue'],
  ];
  return <div className="grid gap-6">
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 text-sm ${data.balanced ? 'bg-[#e8f5ee] text-[#17744a]' : 'bg-[#fdecec] text-[#b42828]'}`}><span className="flex items-center gap-2 font-semibold"><Icon name={data.balanced ? 'check' : 'shield'} size={18} />{data.balanced ? 'Books balance: every debit has a matching credit.' : 'The ledger does not balance. Contact the technical team.'}</span>
      <span className="text-[13px]">Paystack: <b>{data.providers.paystack}</b> · Paymentology: <b>{data.providers.paymentology}</b></span></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tiles.map(([l, v, hint]) => <div key={l} className="rounded-xl bg-grey p-4"><p className="text-[12px] text-[#5b6b82]">{l}</p><p className="mt-1 font-display text-2xl font-extrabold">{money(v)}</p><p className="mt-1 text-[12px] text-[#8a97a8]">{hint}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="grid gap-3 rounded-2xl border border-[#e3e8ef] p-5" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; try { await api('/finance/reconcile', { body: Object.fromEntries(new FormData(form)) }); form.reset(); setError(''); notify('Recorded.'); void reload(); } catch (err) { setError((err as Error).message); } }}>
        <h4 className="font-display font-extrabold">Record a bank movement</h4>
        <p className="text-[13px] text-[#5b6b82]">Use this when money moves in the pool bank account outside DROP, so the ledger matches the statement.</p>
        <select name="kind" className={input}><option value="card_settlement_paid">Card scheme settlement paid from pool</option><option value="business_payment_received">Business account payment received</option></select>
        <div className="grid grid-cols-2 gap-3"><input name="amount" type="number" step="0.01" min="0.01" required placeholder="Amount (R)" className={input} /><input name="reference" required placeholder="Bank reference" className={input} /></div>
        <ErrorText>{error}</ErrorText>
        <button className={`${button} w-fit`}>Record</button>
      </form>
      <div className="rounded-2xl border border-[#e3e8ef] p-5"><h4 className="mb-3 font-display font-extrabold">Accounts</h4>
        <ul className="grid gap-2 text-sm">{data.accounts.map((a) => <li key={a.account} className="flex justify-between gap-3"><span>{ACCOUNT_LABEL[a.account] || a.account}</span><b>{money(a.balance)}</b></li>)}</ul>
        <button className={`${outline} mt-4`} onClick={() => download('/finance/journal.csv', 'drop-journal.csv').catch((e) => notify(e.message))}><Icon name="file" size={16} />Export full journal (CSV)</button></div>
    </div>
  </div>;
}

export function Payouts({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState('requested');
  const { data, reload } = useLoad<{ withdrawals: Withdrawal[] }>(`/finance/withdrawals?status=${status}`);
  const stepUp = useStepUp();
  const act = async (w: Withdrawal, action: 'paid' | 'reject') => {
    const value = window.prompt(action === 'paid' ? `Bank payment reference for ${w.ref} (${money(w.amount)} to ${w.holder})` : `Reason for returning ${w.ref} to the driver's wallet`);
    if (!value) return;
    try { await api(`/finance/withdrawals/${w.id}/${action}`, { body: action === 'paid' ? { bankReference: value } : { reason: value } }); notify(action === 'paid' ? `${w.ref} marked paid.` : `${w.ref} returned to the wallet.`); void reload(); } catch (e) { notify((e as Error).message); }
  };
  return <div className="grid gap-4">
    {stepUp.dialog}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">{[['requested', 'To pay'], ['paid', 'Paid'], ['rejected', 'Returned']].map(([s, l]) => <button key={s} onClick={() => setStatus(s)} className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${status === s ? 'bg-navy text-white' : 'bg-grey'}`}>{l}</button>)}</div>
      {status === 'requested' && <button className={outline} onClick={() => stepUp.guard(() => downloadProtected('/finance/withdrawals.csv', `drop-payouts-${new Date().toISOString().slice(0, 10)}.csv`)).catch((e) => notify(e.message))}><Icon name="file" size={16} />Bank payment file (CSV)</button>}</div>
    {status === 'requested' && <p className="text-[13px] text-[#5b6b82]">Download the payment file, load it in the pool account’s banking platform, then mark each withdrawal paid with the bank reference. The file contains full account numbers; every download is logged.</p>}
    {!data ? <Loading /> : !data.withdrawals.length ? <Empty>Nothing here.</Empty> : <Table head={['Ref', 'Driver', 'Amount', 'To', 'Requested', '']} rows={data.withdrawals.map((w) => [w.ref, w.driver, <b key="a">{money(w.amount)}</b>, `${w.holder} · ${w.bank} ${w.masked}`, date(w.createdAt),
      w.status === 'requested' ? <span key="x" className="flex gap-2"><button className={`${button} min-h-9 px-4`} onClick={() => act(w, 'paid')}>Mark paid</button><button className="text-[13px] underline" onClick={() => act(w, 'reject')}>Return</button></span> : <span key="x" className="text-[13px]"><StatusPill status={w.status} />{w.bankReference && ` ${w.bankReference}`}{w.reason && ` ${w.reason}`}</span>])} />}
  </div>;
}

export function CardsAdmin({ notify }: { notify: Notify }) {
  const cards = useLoad<{ cards: (import('../lib/api').DropCard & { driver: string; balance: number })[] }>('/finance/cards');
  const events = useLoad<{ events: { id: string; method: string; driver: string; merchant: string; category: string; mcc: string; amount: number; reversed: number; resultCode: number; approved: boolean | null; reason: string; createdAt: string }[] }>('/finance/card-transactions');
  const overview = useLoad<FinanceOverview>('/finance/overview');
  const [sim, setSim] = useState<{ response: { resultCode: number; balanceAmount?: number }; explanation: string; request: string } | null>(null);
  const sandbox = overview.data?.providers.paymentology === 'sandbox';
  return <div className="grid gap-6">
    {!cards.data ? <Loading /> : !cards.data.cards.length ? <Empty>No cards issued yet. Verified drivers order cards from their Wallet tab.</Empty> :
      <Table head={['Card', 'Driver', 'Wallet', 'Issued', 'Status', '']} rows={cards.data.cards.map((c) => [<span key="n" className="font-mono">{c.maskedNumber}</span>, c.driver, money(c.balance), date(c.issuedAt), <StatusPill key="s" status={c.status} />,
        c.status === 'active' || c.status === 'frozen' ? <button key="b" className="text-[13px] text-[#b42828] underline" onClick={async () => { const note = window.prompt('Reason for stopping this card (suspected fraud):'); if (!note) return; try { await api(`/finance/cards/${c.id}/stop`, { body: { note } }); notify('Card stopped.'); void cards.reload(); } catch (e) { notify((e as Error).message); } }}>Stop card</button> : ''])} />}
    {sandbox && cards.data?.cards.some((c) => c.status === 'active') && <form className="grid gap-3 rounded-2xl bg-orange/5 p-5 ring-1 ring-orange/30" onSubmit={async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); try { setSim(await api('/finance/simulate-card', { body: f })); void events.reload(); void cards.reload(); } catch (err) { notify((err as Error).message); } }}>
      <h4 className="font-display font-extrabold">Sandbox: simulate a card payment</h4>
      <p className="text-[13px] text-[#5b6b82]">Sends a signed Remote API “Deduct” message through the same code path Paymentology uses in production.</p>
      <div className="grid gap-3 md:grid-cols-4">
        <select name="cardId" className={input}>{cards.data!.cards.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.maskedNumber} · {c.driver}</option>)}</select>
        <input name="amount" type="number" step="0.01" defaultValue="350" className={input} aria-label="Amount (R)" />
        <input name="merchant" defaultValue="ENGEN CAPE TOWN CBD      ZA" className={input} aria-label="Merchant" />
        <select name="mcc" className={input} defaultValue="5541"><option value="5541">5541 · Fuel</option><option value="7523">7523 · Parking</option><option value="7538">7538 · Car repairs</option><option value="5411">5411 · Groceries</option><option value="7995">7995 · Gambling (blocked)</option></select>
      </div>
      <button className={`${button} w-fit`}>Send card payment</button>
      {sim && <p className={`rounded-lg p-3 text-sm ${sim.response.resultCode === 1 ? 'bg-[#e8f5ee] text-[#17744a]' : 'bg-[#fdecec] text-[#b42828]'}`}>Result {sim.response.resultCode}: {sim.explanation}{sim.response.balanceAmount !== undefined && ` · wallet now ${money(sim.response.balanceAmount / 100)}`}</p>}
    </form>}
    <div><h4 className="mb-3 font-display font-extrabold">Card transactions</h4>
      {!events.data ? <Loading /> : !events.data.events.length ? <Empty>No card activity yet.</Empty> : <Table head={['When', 'Driver', 'Merchant', 'Category', 'Amount', 'Result']} rows={events.data.events.map((e) => [date(e.createdAt), e.driver, `${e.merchant}${e.mcc ? ` · MCC ${e.mcc}` : ''}`, e.category, <span key="a">{e.method === 'DeductReversal' ? '↩ ' : ''}{money(e.amount)}{e.reversed > 0 && <span className="block text-[12px] text-[#5b6b82]">reversed {money(e.reversed)}</span>}</span>,
        <StatusPill key="r" status={e.method !== 'Deduct' ? e.method.replace('Deduct', '').toLowerCase() || 'ok' : e.approved ? 'approved' : `declined · ${e.reason}`} />])} />}</div>
  </div>;
}

export function Ledger() {
  const [account, setAccount] = useState('pool');
  const { data } = useLoad<{ balance: number; entries: { id: string; type: string; memo: string; amount: number; createdAt: string }[] }>(`/finance/ledger?account=${encodeURIComponent(account)}`);
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center gap-3"><select className={`${input} max-w-xs`} value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">{Object.entries(ACCOUNT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{data && <b className="text-lg">{money(data.balance)}</b>}</div>
    {!data ? <Loading /> : !data.entries.length ? <Empty>No entries.</Empty> : <Table head={['When', 'Type', 'Description', 'Amount']} rows={data.entries.map((e) => [date(e.createdAt), e.type, e.memo, <b key="a" className={e.amount >= 0 ? 'text-[#17744a]' : ''}>{e.amount >= 0 ? '+' : '−'}{money(Math.abs(e.amount))}</b>])} />}
  </div>;
}
