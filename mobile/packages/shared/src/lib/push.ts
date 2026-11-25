import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { api } from './api';
import { APP, extra } from './config';

/** Push notifications: trip updates, chat messages and ringing calls. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let registered: string | null = null;
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't receive pushes
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Trips and messages', importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationChannelAsync('calls', { name: 'Incoming calls', importance: Notifications.AndroidImportance.MAX, sound: 'default', vibrationPattern: [0, 400, 200, 400], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync(extra.easProjectId ? { projectId: extra.easProjectId } : undefined)).data;
  if (token !== registered) {
    await api('/devices', { body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android', app: APP } });
    registered = token;
  }
  return token;
}
export async function unregisterPush() {
  if (registered) await api('/devices/remove', { body: { token: registered } }).catch(() => undefined);
  registered = null;
}

export type PushTarget = { type?: string; bookingId?: string; callId?: string };
/** Calls back with the notification's data when the user taps it (including a cold start). */
export function onPushTap(fn: (data: PushTarget) => void) {
  void Notifications.getLastNotificationResponseAsync().then((r) => { if (r) fn(r.notification.request.content.data as PushTarget); });
  const sub = Notifications.addNotificationResponseReceivedListener((r) => fn(r.notification.request.content.data as PushTarget));
  return () => sub.remove();
}
