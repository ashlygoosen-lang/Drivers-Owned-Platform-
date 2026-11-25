import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { useCalls } from '../lib/calls';
import type { ChatMessage, Thread } from '../types';
import { colors, radius, space, type } from '../theme';
import { Button, ErrorText, Icon } from './ui';

const QUICK = {
  passenger: ['I’m at the pickup point', 'I’ll be there in 2 minutes', 'Where are you?', 'Please call me'],
  driver: ['I’ve arrived', 'On my way, 5 minutes', 'Running a little late', 'Can’t find you, please call'],
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

/** Chat, in-app voice/video and phone calls with the other person on the trip. */
export function TripChat({ bookingId }: { bookingId: string }) {
  const { on, connected } = useLive();
  const calls = useCalls();
  const [t, setT] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const load = useCallback(async () => { try { setT(await api<Thread>(`/bookings/${bookingId}/messages`)); } catch (e) { setError((e as Error).message); } }, [bookingId]);
  const markRead = useCallback(() => { void api(`/bookings/${bookingId}/messages/read`, { body: {} }).catch(() => undefined); }, [bookingId]);
  useEffect(() => { void load().then(markRead); }, [load, markRead]);
  useEffect(() => { if (connected) void load(); }, [connected, load]);
  useEffect(() => on((event, d) => {
    if (d?.bookingId !== bookingId) return;
    if (event === 'message') { setT((x) => x && !x.messages.some((m) => m.id === d.id) ? { ...x, messages: [...x.messages, d] } : x); if (d.from !== 'me') markRead(); }
    if (event === 'read') setT((x) => x && { ...x, messages: x.messages.map((m) => (m.from === 'me' && !m.readAt ? { ...m, readAt: d.at } : m)) });
    if (event === 'trip') void load();
  }), [on, bookingId, load, markRead]);

  async function send(body: string) {
    if (!body.trim()) return;
    setBusy(true); setError('');
    try { const r = await api<{ message: ChatMessage }>(`/bookings/${bookingId}/messages`, { body: { text: body.trim() } }); setT((x) => x && !x.messages.some((m) => m.id === r.message.id) ? { ...x, messages: [...x.messages, r.message] } : x); setText(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function phone() {
    setError(''); setNote('');
    try {
      const r = await api<{ mode: string; dial?: string; ringing?: string }>(`/bookings/${bookingId}/phone`, { body: {} });
      if (r.dial) await Linking.openURL(`tel:${r.dial}`);
      else setNote(`DROP is calling your registered number (${r.ringing}). Answer it to be connected. Neither of you sees the other’s number.`);
    } catch (e) { setError((e as Error).message); }
  }

  if (!t?.side || !t.with) return error ? <ErrorText>{error}</ErrorText> : null;
  const peer = t.with.name;
  const inCall = Boolean(calls.call && calls.call.status !== 'ended');
  return <View style={st.box} accessibilityLabel={`Messages with ${peer}`}>
    <View style={st.head}>
      <View style={st.avatar}><Text style={{ color: colors.white, fontWeight: '800' }}>{peer.slice(0, 1)}</Text><View style={[st.dot, { backgroundColor: t.with.online ? '#18A058' : '#A7B1C0' }]} /></View>
      <View style={{ flex: 1 }}><Text style={[type.body, { fontWeight: '700' }]}>{peer}</Text><Text style={type.small}>Your {t.with.role} · {t.with.online ? 'in the app now' : 'notified by push'}</Text></View>
    </View>
    {t.open && <View style={st.callRow}>
      <CallBtn icon="call" label="Voice" disabled={inCall} onPress={() => calls.start(bookingId, 'audio', peer)} />
      <CallBtn icon="videocam" label="Video" disabled={inCall} onPress={() => calls.start(bookingId, 'video', peer)} />
      {t.phone !== 'off' && <CallBtn icon="phone-portrait" label="Phone" onPress={phone} />}
    </View>}
    {note ? <Text style={[type.small, st.note]}>{note}</Text> : null}
    <FlatList ref={list} style={st.list} data={t.messages} keyExtractor={(m) => m.id} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
      ListEmptyComponent={<Text style={[type.small, { textAlign: 'center', padding: 16 }]}>Say hello to {peer}. Messages stay in DROP, so you never need to share your number.</Text>}
      renderItem={({ item: m }) => m.kind === 'system'
        ? <Text style={st.system}>{m.text} · {time(m.createdAt)}</Text>
        : <View style={[st.bubble, m.from === 'me' ? st.mine : st.theirs]} accessible accessibilityLabel={`${m.from === 'me' ? 'You' : m.senderName}: ${m.text}`}>
          <Text style={{ color: m.from === 'me' ? colors.white : colors.text, fontSize: 15 }}>{m.text}</Text>
          <Text style={{ color: m.from === 'me' ? '#B9C5D8' : colors.muted, fontSize: 10, textAlign: 'right', marginTop: 2 }}>{time(m.createdAt)}{m.from === 'me' ? (m.readAt ? ' · Read' : ' · Sent') : ''}</Text>
        </View>} />
    {t.open ? <>
      <FlatList horizontal showsHorizontalScrollIndicator={false} data={t.side ? QUICK[t.side] : []} keyExtractor={(q) => q} style={{ marginVertical: 8, flexGrow: 0 }}
        renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => send(item)} style={st.quick}><Text style={{ fontSize: 13, color: colors.navy }}>{item}</Text></Pressable>} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={text} onChangeText={setText} placeholder={`Message ${peer}`} maxLength={1000} accessibilityLabel={`Message ${peer}`} style={st.input} onSubmitEditing={() => send(text)} returnKeyType="send" />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={busy || !text.trim()} onPress={() => send(text)} style={[st.send, (!text.trim() || busy) && { opacity: 0.5 }]}><Icon name="send" color={colors.navy} /></Pressable>
      </View>
    </> : <Text style={type.small}>This chat has closed. For a lost item, contact DROP support.</Text>}
    <ErrorText>{error}</ErrorText>
    <Text style={[type.small, { fontSize: 11 }]}>Chats and call records are kept for safety and may be reviewed by DROP support if you report a problem.</Text>
  </View>;
}

function CallBtn({ icon, label, onPress, disabled }: { icon: 'call' | 'videocam' | 'phone-portrait'; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} call`} disabled={disabled} onPress={onPress} style={[st.callBtn, disabled && { opacity: 0.5 }]}><Icon name={icon} size={18} /><Text style={{ fontWeight: '700', color: colors.navy }}>{label}</Text></Pressable>;
}

const st = StyleSheet.create({
  box: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space(4), marginBottom: space(4), borderWidth: 1, borderColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
  callRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  callBtn: { flex: 1, minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  note: { backgroundColor: colors.successSoft, color: colors.success, padding: 10, borderRadius: radius.sm, marginBottom: 8 },
  list: { maxHeight: 280, minHeight: 120, backgroundColor: colors.grey, borderRadius: radius.md, padding: 8 },
  system: { alignSelf: 'center', backgroundColor: '#E3E8EF', color: colors.muted, fontSize: 11, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginVertical: 4, overflow: 'hidden' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.navy, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.white, borderWidth: 1, borderColor: '#DBE1EA', borderBottomLeftRadius: 4 },
  quick: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, backgroundColor: colors.white },
  input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, backgroundColor: colors.white },
  send: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
});
