import { router } from 'expo-router';
import { NotificationsScreen } from '@drop/shared';
export default function Inbox() {
  return <NotificationsScreen onOpen={(link) => { if (link === 'verification') router.push('/verification'); else if (link === 'trips') router.push('/(tabs)/trips'); else if (link === 'travel') router.push('/(tabs)/travel'); else if (link === 'plans') router.push('/(tabs)/plans'); }} />;
}
