import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { api } from './api';
import { useLive } from './live';
import { onPushTap } from './push';

/**
 * In-app voice and video calls (WebRTC, peer to peer). The DROP server only relays call set-up, the
 * same protocol as the website, so app ↔ website calls work too. Phone numbers are never used.
 */
export type CallKind = 'audio' | 'video';
export interface CallState { id: string; bookingId: string; kind: CallKind; peer: string; role: 'caller' | 'callee'; status: 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended'; note?: string; startedAt?: number }
interface CallsValue {
  call: CallState | null; local: MediaStream | null; remote: MediaStream | null; muted: boolean; camOff: boolean;
  start: (bookingId: string, kind: CallKind, peer: string) => Promise<void>;
  accept: () => Promise<void>; decline: () => void; hangup: (note?: string) => void; toggleMute: () => void; toggleCamera: () => void; switchCamera: () => void;
}
const Ctx = createContext<CallsValue | null>(null);
export const useCalls = () => { const c = useContext(Ctx); if (!c) throw new Error('useCalls outside CallsProvider'); return c; };

export function CallsProvider({ children }: { children: React.ReactNode }) {
  const { on } = useLive();
  const [call, setCall] = useState<CallState | null>(null);
  const ref = useRef<CallState | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const pending = useRef<RTCIceCandidate[]>([]);
  const ice = useRef<RTCIceServer[] | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const update = (c: CallState | null) => { ref.current = c; setCall(c); };

  const cleanup = useCallback((note?: string) => {
    Vibration.cancel();
    pc.current?.close(); pc.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop()); localRef.current = null;
    pending.current = [];
    setLocal(null); setRemote(null); setMuted(false); setCamOff(false);
    if (!ref.current) return;
    update({ ...ref.current, status: 'ended', note: note || 'Call ended' });
    setTimeout(() => { if (ref.current?.status === 'ended') update(null); }, 2500);
  }, []);

  const signal = (body: unknown) => { const c = ref.current; if (c?.id) void api(`/calls/${c.id}/signal`, { body: { signal: body } }).catch(() => undefined); };

  async function media(kind: CallKind) {
    const s = await mediaDevices.getUserMedia({ audio: true, video: kind === 'video' ? { facingMode: 'user', width: 1280, height: 720, frameRate: 30 } : false });
    localRef.current = s as MediaStream; setLocal(s as MediaStream);
  }
  async function peer() {
    if (!ice.current) ice.current = (await api<{ iceServers: RTCIceServer[] }>('/comms/config').catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }))).iceServers;
    const conn = new RTCPeerConnection({ iceServers: ice.current });
    pc.current = conn;
    localRef.current?.getTracks().forEach((t) => conn.addTrack(t, localRef.current!));
    // react-native-webrtc event handlers
    (conn as any).addEventListener('icecandidate', (e: any) => { if (e.candidate) signal({ type: 'ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    (conn as any).addEventListener('track', (e: any) => { if (e.streams?.[0]) setRemote(e.streams[0]); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    (conn as any).addEventListener('connectionstatechange', () => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (conn.connectionState === 'connected' && ref.current && ref.current.status !== 'connected') update({ ...ref.current, status: 'connected', startedAt: Date.now() });
      if (conn.connectionState === 'failed') hangup('The connection dropped. Check your signal and try again.');
    });
    return conn;
  }
  async function flush() { for (const c of pending.current.splice(0)) await pc.current?.addIceCandidate(c).catch(() => undefined); }

  const start = useCallback(async (bookingId: string, kind: CallKind, peerName: string) => {
    if (ref.current && ref.current.status !== 'ended') return;
    update({ id: '', bookingId, kind, peer: peerName, role: 'caller', status: 'outgoing' });
    try {
      await media(kind);
      const r = await api<{ call: { id: string } }>(`/bookings/${bookingId}/calls`, { body: { kind } });
      if (!ref.current || ref.current.status === 'ended') { void api(`/calls/${r.call.id}/end`, { body: {} }); return; }
      update({ ...ref.current, id: r.call.id });
    } catch (err) { cleanup((err as Error).message || 'Could not start the call. Allow microphone and camera access in Settings.'); }
  }, [cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  async function accept() {
    const c = ref.current; if (!c) return;
    Vibration.cancel();
    update({ ...c, status: 'connecting' });
    try { await media(c.kind); await peer(); await api(`/calls/${c.id}/accept`, { body: {} }); }
    catch (err) { void api(`/calls/${c.id}/decline`, { body: {} }).catch(() => undefined); cleanup((err as Error).message); }
  }
  function decline() { const c = ref.current; if (c?.id) void api(`/calls/${c.id}/decline`, { body: {} }).catch(() => undefined); cleanup('Call declined'); }
  function hangup(note?: string) { const c = ref.current; if (c?.id && c.status !== 'ended') void api(`/calls/${c.id}/end`, { body: {} }).catch(() => undefined); cleanup(note); }

  function ring(d: { callId: string; bookingId: string; kind: CallKind; from: string }) {
    if (ref.current && ref.current.status !== 'ended') { void api(`/calls/${d.callId}/decline`, { body: {} }).catch(() => undefined); return; }
    update({ id: d.callId, bookingId: d.bookingId, kind: d.kind, peer: d.from, role: 'callee', status: 'incoming' });
    Vibration.vibrate([0, 800, 600], true);
  }

  useEffect(() => on(async (event, d) => {
    const c = ref.current;
    if (event === 'call:ring') { ring(d); return; }
    if (!c || d?.callId !== c.id) return;
    if (event === 'call:accepted' && c.role === 'caller') {
      update({ ...c, status: 'connecting' });
      const conn = await peer();
      const offer = await conn.createOffer({});
      await conn.setLocalDescription(offer);
      signal({ type: 'offer', sdp: offer.sdp });
    } else if (event === 'call:signal') {
      const s = d.signal;
      if (s.type === 'offer' && pc.current) {
        await pc.current.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: s.sdp }));
        const answer = await pc.current.createAnswer();
        await pc.current.setLocalDescription(answer);
        signal({ type: 'answer', sdp: answer.sdp });
        await flush();
      } else if (s.type === 'answer' && pc.current) {
        await pc.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: s.sdp }));
        await flush();
      } else if (s.type === 'ice' && s.candidate) {
        const cand = new RTCIceCandidate(s.candidate);
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(cand).catch(() => undefined); else pending.current.push(cand);
      }
    } else if (event === 'call:ended') {
      cleanup(d.by === 'me' ? 'Call ended' : ({ declined: `${c.peer} is busy right now`, missed: c.role === 'caller' ? 'No answer' : 'Missed call', cancelled: 'Call cancelled' } as Record<string, string>)[d.status] || 'Call ended');
    }
  }), [on, cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a "calling" push notification: show the incoming call if it's still ringing.
  useEffect(() => onPushTap(async (data) => {
    if (data.type !== 'call' || !data.callId) return;
    const r = await api<{ call: { id: string; bookingId: string; kind: CallKind; status: string; from: string; incoming: boolean } }>(`/calls/${data.callId}`).catch(() => null);
    if (r?.call.incoming && r.call.status === 'ringing') ring({ callId: r.call.id, bookingId: r.call.bookingId, kind: r.call.kind, from: r.call.from });
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => { const m = !muted; localRef.current?.getAudioTracks().forEach((t) => { t.enabled = !m; }); setMuted(m); };
  const toggleCamera = () => { const off = !camOff; localRef.current?.getVideoTracks().forEach((t) => { t.enabled = !off; }); setCamOff(off); };
  const switchCamera = () => { localRef.current?.getVideoTracks().forEach((t) => (t as unknown as { _switchCamera?: () => void })._switchCamera?.()); };

  return <Ctx.Provider value={{ call, local, remote, muted, camOff, start, accept, decline, hangup, toggleMute, toggleCamera, switchCamera }}>{children}</Ctx.Provider>;
}
