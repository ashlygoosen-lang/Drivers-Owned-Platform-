import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useCalls } from '../lib/calls';
import { colors } from '../theme';
import { Icon, type IconName } from './ui';

function Clock({ from }: { from?: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (!from) return null;
  const s = Math.floor((Date.now() - from) / 1000);
  return <Text style={st.sub}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</Text>;
}

/** Full-screen incoming / outgoing / in-progress call UI, shown over any screen. */
export function CallScreen() {
  const { call, local, remote, muted, camOff, accept, decline, hangup, toggleMute, toggleCamera, switchCamera } = useCalls();
  if (!call) return null;
  const video = call.kind === 'video';
  const showRemote = video && remote && call.status === 'connected';
  const status = { outgoing: call.id ? 'Ringing…' : 'Calling…', incoming: `Incoming ${video ? 'video' : 'voice'} call`, connecting: 'Connecting…', connected: '', ended: call.note || 'Call ended' }[call.status];
  return <Modal visible animationType="fade" onRequestClose={() => hangup()} supportedOrientations={['portrait']}>
    <View style={st.wrap} accessibilityViewIsModal>
      {showRemote && <RTCView streamURL={remote!.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />}
      {video && local && !camOff && call.status !== 'ended' && <RTCView streamURL={local.toURL()} style={st.pip} objectFit="cover" mirror zOrder={1} />}
      <View style={st.top}>
        {!showRemote && <View style={st.avatar}><Text style={{ fontSize: 40, fontWeight: '800', color: colors.navy }}>{call.peer.slice(0, 1).toUpperCase()}</Text></View>}
        <Text style={st.name} accessibilityRole="header">{call.peer}</Text>
        {call.status === 'connected' ? <Clock from={call.startedAt} /> : <Text style={st.sub} accessibilityLiveRegion="polite">{status}</Text>}
        <Text style={st.tiny}>DROP {video ? 'video' : 'voice'} call · your phone number is not shared</Text>
      </View>
      {call.status === 'incoming'
        ? <View style={st.row}><Round icon="close" label="Decline" color="#D7263D" onPress={decline} /><Round icon={video ? 'videocam' : 'call'} label="Answer" color="#18A058" onPress={accept} /></View>
        : call.status !== 'ended' && <View style={st.row}>
          <Round icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} onPress={toggleMute} active={muted} />
          {video && <Round icon={camOff ? 'videocam-off' : 'videocam'} label={camOff ? 'Camera on' : 'Camera off'} onPress={toggleCamera} active={camOff} />}
          {video && <Round icon="camera-reverse" label="Switch camera" onPress={switchCamera} />}
          <Round icon="call" label="End call" color="#D7263D" onPress={() => hangup()} />
        </View>}
    </View>
  </Modal>;
}

function Round({ icon, label, onPress, color, active }: { icon: IconName; label: string; onPress: () => void; color?: string; active?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[st.round, { backgroundColor: color || (active ? colors.white : 'rgba(255,255,255,.18)') }]}>
    <Icon name={icon} size={26} color={active && !color ? colors.navy : colors.white} />
  </Pressable>;
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#050F22', justifyContent: 'space-between', paddingVertical: 70 },
  top: { alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  name: { color: colors.white, fontSize: 30, fontWeight: '800' },
  sub: { color: '#C9D3E3', fontSize: 15 },
  tiny: { color: '#8FA0BA', fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 22 },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  pip: { position: 'absolute', top: 60, right: 16, width: 110, height: 150, borderRadius: 16, overflow: 'hidden', zIndex: 2 },
});
