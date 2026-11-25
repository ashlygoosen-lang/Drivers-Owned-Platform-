import { Redirect, Tabs } from 'expo-router';
import { Icon, colors, useAuth, type IconName } from '@drop/shared';

const tab = (icon: IconName) => ({ tabBarIcon: ({ color }: { color: unknown }) => <Icon name={icon} color={String(color)} size={22} /> });
export default function TabsLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.orange, tabBarInactiveTintColor: colors.muted, tabBarStyle: { minHeight: 60 }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Ride', ...tab('car') }} />
    <Tabs.Screen name="trips" options={{ title: 'Trips', ...tab('time') }} />
    <Tabs.Screen name="plans" options={{ title: user.role === 'business' ? 'Staff' : 'School', ...tab(user.role === 'business' ? 'business' : 'school') }} />
    <Tabs.Screen name="notifications" options={{ title: 'Inbox', ...tab('notifications') }} />
    <Tabs.Screen name="account" options={{ title: 'Account', ...tab('person-circle') }} />
  </Tabs>;
}
