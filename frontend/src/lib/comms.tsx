/**
 * Live trip communication: one Server-Sent Events stream per signed-in tab, plus in-app voice and
 * video calls over WebRTC (peer-to-peer; the DROP server only relays the call setup).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, BASE, token, type ChatMessage } from './api';
import { useAuth } from './auth';
import { Icon } from '../components/ui';

type Handler = (event: string, data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
export type CallKind = 'audio' | 'video';
interface CallState {
  id: string; bookingId: string; kind: CallKind; peer: string; role: 'caller' | 'callee';
  status: 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended'; note?: string; startedAt?: number;
}
interface CommsValue {
  live: boolean;
  on: (fn: Handler) => () => void;
  startCall: (bookingId: string, kind: CallKind, peer: string) => Promise<void>;
  inCall: boolean;
  /** Chat panels register the trip they show, so new-message toasts only appear for other trips. */
  watch: (bookingId: string) => () => void;
}

const Ctx = createContext<CommsValue | null>(null);
export const useComms = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useComms must be used inside CommsProvider');
  return c;
};

const EVENTS = ['message', 'read', 'trip', 'call:ring', 'call:accepted', 'call:ended', 'call:signal'];

/** Ringtone (incoming) and ringback (outgoing) with WebAudio, so no audio files are needed. */
function useTone(kind: 'ring' | 'ringback' | null) {
  useEffect(() => {
    if (!kind) return;
    let ctx: AudioContext | null = null;
    try { ctx = new AudioContext(); } catch { return; }
    const beep = () => {
      if (!ctx) return;
      const tones = kind === 'ring' ? [[880, 0], [660, 0.18], [880, 0.36], [660, 0.54]] : [[425, 0], [425, 0.45]];
      for (const [f, t] of tones) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; g.gain.value = kind === 'ring' ? 0.08 : 0.04;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + (kind === 'ring' ? 0.16 : 0.4));
      }
    };
    beep();
    const timer = setInterval(beep, kind === 'ring' ? 1800 : 3000);
    if (kind === 'ring' && 'vibrate' in navigator) navigator.vibrate?.([300, 200, 300]);
    return () => { clearInterval(timer); void ctx?.close(); };
  }, [kind]);
}

export function CommsProvider({ children, onOpenTrip }: { children: React.ReactNode; onOpenTrip: (bookingId: string) => void }) {
  const { user } = useAuth();
  const [live, setLive] = useState(false);
  const handlers = useRef(new Set<Handler>());
  const watched = useRef(new Map<string, number>());
  const [toast, setToast] = useState<ChatMessage | null>(null);

  // ---- event stream ----
  useEffect(() => {
    if (!user) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>('/comms/ticket', { body: {} });
        if (stopped) return;
        es = new EventSource(`${BASE}/comms/stream?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener('ready', () => setLive(true));
        for (const name of EVENTS) es.addEventListener(name, (e) => {
          let data: unknown; try { data = JSON.parse((e as MessageEvent).data); } catch { return; }
          handlers.current.forEach((h) => h(name, data));
        });
        // Tickets are single-use, so reconnect with a fresh one rather than the browser's auto-retry.
        es.onerror = () => { es?.close(); setLive(false); if (!stopped) retry = setTimeout(connect, 3000); };
      } catch { if (!stopped) retry = setTimeout(connect, 8000); }
    };
    void connect();
    return () => { stopped = true; clearTimeout(retry); es?.close(); setLive(false); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const on = useCallback((fn: Handler) => { handlers.current.add(fn); return () => { handlers.current.delete(fn); }; }, []);
  const watch = useCallback((bookingId: string) => {
    watched.current.set(bookingId, (watched.current.get(bookingId) || 0) + 1);
    return () => { const n = (watched.current.get(bookingId) || 1) - 1; if (n) watched.current.set(bookingId, n); else watched.current.delete(bookingId); };
  }, []);

  // ---- calls ----
  const [call, setCall] = useState<CallState | null>(null);
  const callRef = useRef<CallState | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [localView, setLocalView] = useState<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const ice = useRef<RTCIceServer[] | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const update = (c: CallState | null) => { callRef.current = c; setCall(c); };

  const cleanup = useCallback((note?: string) => {
    pc.current?.close(); pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null;
    pendingIce.current = [];
    setRemote(null); setLocalView(null); setMuted(false); setCamOff(false);
    const c = callRef.current;
    if (!c) return;
    update({ ...c, status: 'ended', note: note || 'Call ended' });
    setTimeout(() => { if (callRef.current?.status === 'ended') update(null); }, 2600);
  }, []);

  const signal = (body: unknown) => { const c = callRef.current; if (c?.id) void api(`/calls/${c.id}/signal`, { body: { signal: body } }).catch(() => {}); };

  async function media(kind: CallKind) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot make calls. Try Chrome, Safari or Firefox on a secure (https) connection.');
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === 'video' ? { facingMode: 'user', width: { ideal: 1280 } } : false });
      setLocalView(local.current);
    } catch (err) {
      const name = (err as DOMException).name;
      throw new Error(name === 'NotAllowedError' ? `Allow ${kind === 'video' ? 'camera and microphone' : 'microphone'} access in your browser to make calls.` : `We couldn't find a ${kind === 'video' ? 'camera or microphone' : 'microphone'} on this device.`);
    }
  }

  async function peer() {
    if (!ice.current) {
      try { ice.current = (await api<{ iceServers: RTCIceServer[] }>('/comms/config')).iceServers; } catch { ice.current = [{ urls: 'stun:stun.l.google.com:19302' }]; }
    }
    const conn = new RTCPeerConnection({ iceServers: ice.current });
    pc.current = conn;
    local.current?.getTracks().forEach((t) => conn.addTrack(t, local.current!));
    conn.onicecandidate = (e) => { if (e.candidate) signal({ type: 'ice', candidate: e.candidate.toJSON() }); };
    conn.ontrack = (e) => setRemote(e.streams[0] || new MediaStream([e.track]));
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'connected' && callRef.current && callRef.current.status !== 'connected') update({ ...callRef.current, status: 'connected', startedAt: Date.now() });
      if (conn.connectionState === 'failed') void hangup('The connection dropped. Check your signal and try again.');
    };
    return conn;
  }

  async function flushIce() {
    for (const c of pendingIce.current.splice(0)) await pc.current?.addIceCandidate(c).catch(() => {});
  }

  const startCall = useCallback(async (bookingId: string, kind: CallKind, peerName: string) => {
    if (callRef.current && callRef.current.status !== 'ended') return;
    update({ id: '', bookingId, kind, peer: peerName, role: 'caller', status: 'outgoing' });
    try {
      await media(kind);
      const r = await api<{ call: { id: string } }>(`/bookings/${bookingId}/calls`, { body: { kind } });
      if (!callRef.current || callRef.current.status === 'ended') { void api(`/calls/${r.call.id}/end`, { body: {} }); return; }
      update({ ...callRef.current, id: r.call.id });
    } catch (err) { cleanup((err as Error).message); }
  }, [cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  async function accept() {
    const c = callRef.current;
    if (!c) return;
    update({ ...c, status: 'connecting' });
    try {
      await media(c.kind);
      await peer();
      await api(`/calls/${c.id}/accept`, { body: {} });
    } catch (err) { void api(`/calls/${c.id}/decline`, { body: {} }).catch(() => {}); cleanup((err as Error).message); }
  }

  async function decline() {
    const c = callRef.current;
    if (c?.id) void api(`/calls/${c.id}/decline`, { body: {} }).catch(() => {});
    cleanup('Call declined');
  }

  async function hangup(note?: string) {
    const c = callRef.current;
    if (c?.id && c.status !== 'ended') void api(`/calls/${c.id}/end`, { body: {} }).catch(() => {});
    cleanup(note);
  }

  // Signalling events
  useEffect(() => on(async (event, d) => {
    const c = callRef.current;
    if (event === 'call:ring') {
      if (c && c.status !== 'ended') { void api(`/calls/${d.callId}/decline`, { body: {} }).catch(() => {}); return; } // busy
      update({ id: d.callId, bookingId: d.bookingId, kind: d.kind, peer: d.from, role: 'callee', status: 'incoming' });
      return;
    }
    if (!c || d.callId !== c.id) {
      if (event === 'message' && d.from !== 'me' && d.kind === 'text' && !watched.current.has(d.bookingId)) setToast(d);
      return;
    }
    if (event === 'call:accepted' && c.role === 'caller') {
      update({ ...c, status: 'connecting' });
      const conn = await peer();
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      signal({ type: 'offer', sdp: offer.sdp });
    } else if (event === 'call:signal') {
      const s = d.signal;
      if (s.type === 'offer' && pc.current) {
        await pc.current.setRemoteDescription({ type: 'offer', sdp: s.sdp });
        const answer = await pc.current.createAnswer();
        await pc.current.setLocalDescription(answer);
        signal({ type: 'answer', sdp: answer.sdp });
        await flushIce();
      } else if (s.type === 'answer' && pc.current) {
        await pc.current.setRemoteDescription({ type: 'answer', sdp: s.sdp });
        await flushIce();
      } else if (s.type === 'ice' && s.candidate) {
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(s.candidate).catch(() => {});
        else pendingIce.current.push(s.candidate);
      }
    } else if (event === 'call:ended') {
      const note = d.by === 'me' ? 'Call ended' : ({ declined: `${c.peer} is busy right now`, missed: c.role === 'caller' ? 'No answer' : 'Missed call', cancelled: 'Call cancelled', completed: 'Call ended' } as Record<string, string>)[d.status] || 'Call ended';
      cleanup(note);
    }
  }), [on, cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  // End the call if the tab closes.
  useEffect(() => {
    const bye = () => { const c = callRef.current; if (c?.id && c.status !== 'ended') void fetch(`${BASE}/calls/${c.id}/end`, { method: 'POST', keepalive: true, headers: { authorization: `Bearer ${token.get()}` } }).catch(() => {}); };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);
  useEffect(() => { if (!user && callRef.current) void hangup(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);

  useTone(call?.status === 'incoming' ? 'ring' : call?.status === 'outgoing' && call.id ? 'ringback' : null);

  const value = useMemo<CommsValue>(() => ({ live, on, startCall, watch, inCall: Boolean(call && call.status !== 'ended') }), [live, on, startCall, watch, call]);

  return <Ctx.Provider value={value}>
    {children}
    {call && <CallScreen call={call} remote={remote} local={localView} muted={muted} camOff={camOff}
      onAccept={accept} onDecline={decline} onHangup={() => hangup()}
      onMute={() => { const m = !muted; local.current?.getAudioTracks().forEach((t) => { t.enabled = !m; }); setMuted(m); }}
      onCamera={() => { const off = !camOff; local.current?.getVideoTracks().forEach((t) => { t.enabled = !off; }); setCamOff(off); }} />}
    {toast && !call && <button onClick={() => { setToast(null); onOpenTrip(toast.bookingId); }} className="toast fixed inset-x-0 bottom-5 z-[70] mx-auto flex w-[min(92vw,380px)] items-start gap-3 rounded-2xl bg-navy p-4 text-left text-white shadow-2xl" role="status">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange text-navy"><Icon name="chat" size={19} /></span>
      <span className="min-w-0 text-sm"><b className="block">{toast.senderName} sent a message</b><span className="line-clamp-2 text-[#c9d3e3]">{toast.text}</span><span className="mt-1 block text-[12px] font-semibold text-orange">Open chat</span></span>
    </button>}
  </Ctx.Provider>;
}

function Clock({ from }: { from?: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (!from) return null;
  const s = Math.floor((Date.now() - from) / 1000);
  return <>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</>;
}

function Media({ stream, muted, className, video }: { stream: MediaStream | null; muted?: boolean; className?: string; video: boolean }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return video ? <video ref={ref} autoPlay playsInline muted={muted} className={className} /> : <audio ref={ref} autoPlay />;
}

function CallScreen({ call, remote, local, muted, camOff, onAccept, onDecline, onHangup, onMute, onCamera }: {
  call: CallState; remote: MediaStream | null; local: MediaStream | null; muted: boolean; camOff: boolean;
  onAccept: () => void; onDecline: () => void; onHangup: () => void; onMute: () => void; onCamera: () => void;
}) {
  const video = call.kind === 'video';
  const status = { outgoing: call.id ? 'Ringing…' : 'Calling…', incoming: `Incoming ${video ? 'video' : 'voice'} call`, connecting: 'Connecting…', connected: '', ended: call.note || 'Call ended' }[call.status];
  const round = 'grid h-14 w-14 place-items-center rounded-full transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  const showRemoteVideo = video && remote && call.status === 'connected';
  return <div className="fixed inset-0 z-[80] grid bg-[#050f22]/95 text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${video ? 'Video' : 'Voice'} call with ${call.peer}`}>
    {video && <Media stream={remote} video className={`absolute inset-0 h-full w-full object-cover ${showRemoteVideo ? 'opacity-100' : 'opacity-0'}`} />}
    {!video && <Media stream={remote} video={false} />}
    {video && local && !camOff && call.status !== 'ended' && <Media stream={local} video muted className="absolute right-4 top-4 z-10 aspect-[3/4] w-28 rounded-2xl border-2 border-white/70 object-cover shadow-xl [transform:scaleX(-1)] sm:w-40" />}
    <div className={`relative z-10 flex flex-col items-center justify-between px-6 py-12 ${showRemoteVideo ? 'bg-gradient-to-b from-black/50 via-transparent to-black/60' : ''}`}>
      <div className="grid justify-items-center gap-3 text-center">
        {!showRemoteVideo && <span className={`mt-10 grid h-28 w-28 place-items-center rounded-full bg-orange font-display text-4xl font-extrabold text-navy ${['incoming', 'outgoing'].includes(call.status) ? 'call-ring' : ''}`}>{call.peer.slice(0, 1).toUpperCase()}</span>}
        <h2 className="font-display text-3xl font-extrabold">{call.peer}</h2>
        <p className="text-sm text-[#c9d3e3]" aria-live="polite">{call.status === 'connected' ? <Clock from={call.startedAt} /> : status}</p>
        <p className="text-[12px] text-[#8fa0ba]">DROP {video ? 'video' : 'voice'} call · your phone number is not shared</p>
      </div>
      {call.status === 'incoming' ? <div className="flex gap-16">
        <button className={`${round} bg-[#d7263d]`} onClick={onDecline} aria-label="Decline"><Icon name="hangup" size={26} /></button>
        <button className={`${round} bg-[#18a058]`} onClick={onAccept} aria-label="Answer"><Icon name={video ? 'video' : 'call'} size={24} /></button>
      </div> : call.status !== 'ended' && <div className="flex gap-5">
        <button className={`${round} ${muted ? 'bg-white text-navy' : 'bg-white/15'}`} onClick={onMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'}><Icon name={muted ? 'micOff' : 'mic'} size={22} /></button>
        {video && <button className={`${round} ${camOff ? 'bg-white text-navy' : 'bg-white/15'}`} onClick={onCamera} aria-pressed={camOff} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'}><Icon name={camOff ? 'camOff' : 'video'} size={22} /></button>}
        <button className={`${round} bg-[#d7263d]`} onClick={onHangup} aria-label="End call"><Icon name="hangup" size={26} /></button>
      </div>}
    </div>
  </div>;
}
