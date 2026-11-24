import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChatMessage, type Thread } from '../lib/api';
import { useComms } from '../lib/comms';
import { Icon, Spinner } from './ui';

const QUICK = {
  passenger: ['I’m at the pickup point', 'I’ll be there in 2 minutes', 'Where are you?', 'Please call me'],
  driver: ['I’ve arrived', 'On my way, 5 minutes', 'Running a little late', 'Can’t find you, please call me'],
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

/**
 * Messages and calls between the passenger and driver on one trip. Shows for the two people on
 * the trip once a driver accepts, and for a short while after it ends.
 */
export function TripComms({ bookingId, compact = false }: { bookingId: string; compact?: boolean }) {
  const { on, startCall, watch, inCall, live } = useComms();
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [phoning, setPhoning] = useState(false);
  // A read receipt can arrive before our own send() resolves, so remember the latest one.
  const [readUpTo, setReadUpTo] = useState('');
  const list = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    try { setThread(await api<Thread>(`/bookings/${bookingId}/messages`)); setError(''); } catch (err) { setError((err as Error).message); }
  }, [bookingId]);
  const markRead = useCallback(() => { void api(`/bookings/${bookingId}/messages/read`, { body: {} }).catch(() => {}); }, [bookingId]);

  useEffect(() => { void load().then(markRead); }, [load, markRead]);
  useEffect(() => watch(bookingId), [watch, bookingId]);
  useEffect(() => on((event, d) => {
    if (d?.bookingId !== bookingId) return;
    if (event === 'message') {
      setThread((t) => t && !t.messages.some((m) => m.id === d.id) ? { ...t, messages: [...t.messages, d as ChatMessage], with: t.with && d.from !== 'system' ? { ...t.with, online: true } : t.with } : t);
      if (d.from !== 'me') markRead();
    } else if (event === 'read') {
      setReadUpTo(d.at);
      setThread((t) => t && { ...t, messages: t.messages.map((m) => m.from === 'me' && !m.readAt ? { ...m, readAt: d.at } : m) });
    } else if (event === 'trip') void load();
  }), [on, bookingId, load, markRead]);
  // Re-sync after the live connection comes back (messages may have arrived while offline).
  useEffect(() => { if (live) void load(); }, [live, load]);
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [thread?.messages.length]);

  async function send(body: string) {
    const msg = body.trim();
    if (!msg) return;
    setSending(true); setError('');
    try {
      const r = await api<{ message: ChatMessage }>(`/bookings/${bookingId}/messages`, { body: { text: msg } });
      setThread((t) => t && !t.messages.some((m) => m.id === r.message.id) ? { ...t, messages: [...t.messages, r.message] } : t);
      setText('');
    } catch (err) { setError((err as Error).message); }
    finally { setSending(false); }
  }

  async function phone() {
    setPhoning(true); setError(''); setNote('');
    try {
      const r = await api<{ mode: 'direct' | 'masked'; dial?: string; ringing?: string }>(`/bookings/${bookingId}/phone`, { body: {} });
      if (r.mode === 'direct' && r.dial) window.location.href = `tel:${r.dial}`;
      else setNote(`DROP is calling your registered number (${r.ringing}) now. Answer it and we’ll connect you to ${thread?.with?.name}. Neither of you sees the other’s number.`);
    } catch (err) { setError((err as Error).message); }
    finally { setPhoning(false); }
  }

  if (!thread) return error ? <p className="text-sm text-red-800">{error}</p> : <p className="flex items-center gap-2 text-sm text-[#505d71]"><Spinner /> Loading chat…</p>;
  if (!thread.side || !thread.with) return null;
  const peer = thread.with.name;
  const callBtn = 'motion-button inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#cbd0d7] bg-white px-3 text-sm font-semibold hover:border-orange hover:bg-[#fff4ec] disabled:opacity-50';

  return <section className="grid gap-3 rounded-2xl border border-[#d2dae4] bg-white p-4" aria-label={`Messages with ${peer}`}>
    <header className="flex items-center gap-3">
      <span className="relative grid h-10 w-10 place-items-center rounded-full bg-navy font-bold text-white">{peer.slice(0, 1)}<span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${thread.with.online ? 'bg-[#18a058]' : 'bg-[#a7b1c0]'}`} /></span>
      <div className="min-w-0 flex-1"><b className="block text-sm">{peer}</b><span className="text-[12px] text-[#505d71]">Your {thread.with.role} · {thread.with.online ? 'in the app now' : 'not in the app right now'}</span></div>
    </header>

    {thread.open && <div className="flex gap-2">
      <button className={callBtn} disabled={inCall} onClick={() => startCall(bookingId, 'audio', peer)}><Icon name="call" size={17} />Voice</button>
      <button className={callBtn} disabled={inCall} onClick={() => startCall(bookingId, 'video', peer)}><Icon name="video" size={18} />Video</button>
      {thread.phone !== 'off' && <button className={callBtn} disabled={phoning} onClick={phone} title={thread.phone === 'masked' ? 'Phone call through DROP. Numbers stay private.' : `Phone ${peer} on their registered number`}>{phoning ? <Spinner /> : <Icon name="phone" size={17} />}Phone</button>}
    </div>}
    {note && <p className="rounded-xl bg-[#e7f6ee] p-3 text-[13px] leading-5 text-[#17532f]" role="status">{note}</p>}

    <ol ref={list} className={`grid content-start gap-2 overflow-y-auto rounded-xl bg-[#f5f7fa] p-3 ${compact ? 'max-h-56' : 'max-h-72'} min-h-28`} aria-live="polite">
      {thread.messages.length === 0 && <li className="py-6 text-center text-[13px] text-[#505d71]">Say hello to {peer}. Messages stay in DROP, so you never need to share your number.</li>}
      {thread.messages.map((m) => m.kind === 'system'
        ? <li key={m.id} className="justify-self-center rounded-full bg-[#e3e8ef] px-3 py-1 text-center text-[11px] text-[#4d5b71]">{m.text} · {time(m.createdAt)}</li>
        : <li key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-5 ${m.from === 'me' ? 'justify-self-end rounded-br-md bg-navy text-white' : 'justify-self-start rounded-bl-md border border-[#dbe1ea] bg-white'}`}>
          <span className="whitespace-pre-wrap break-words">{m.text}</span>
          <span className={`mt-0.5 block text-right text-[10px] ${m.from === 'me' ? 'text-[#b9c5d8]' : 'text-[#6b7789]'}`}>{time(m.createdAt)}{m.from === 'me' && (m.readAt || (readUpTo && readUpTo >= m.createdAt) ? ' · Read' : ' · Sent')}</span>
        </li>)}
    </ol>

    {thread.open ? <>
      <div className="flex gap-2 overflow-x-auto pb-1">{QUICK[thread.side].map((q) => <button key={q} disabled={sending} onClick={() => send(q)} className="shrink-0 rounded-full border border-[#d2dae4] px-3 py-1.5 text-[12px] font-medium hover:border-orange hover:bg-[#fff4ec]">{q}</button>)}</div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label className="sr-only" htmlFor={`msg-${bookingId}`}>Message {peer}</label>
        <input id={`msg-${bookingId}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={`Message ${peer}`} autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#cbd0d7] bg-white px-4 text-sm outline-none focus:border-navy" />
        <button className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange text-navy disabled:opacity-50" disabled={sending || !text.trim()} aria-label="Send message">{sending ? <Spinner /> : <Icon name="send" size={18} />}</button>
      </form>
    </> : <p className="text-[12px] text-[#505d71]">This chat has closed. For a lost item or anything else about this trip, contact DROP support.</p>}
    {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
    <p className="text-[11px] leading-4 text-[#6b7789]">Chats and call records are kept for your safety and may be reviewed by DROP support if you report a problem. In an emergency call 10111.</p>
  </section>;
}
