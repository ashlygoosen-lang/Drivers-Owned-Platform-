import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import "../tasks/location";
import { AuthProvider, LiveProvider, CallsProvider, CallScreen, UpdateGate, AppLock, useAuth, onPushTap, startPinning } from '@drop/shared';

void SplashScreen.preventAutoHideAsync();
void startPinning();

function Shell() {
  const { user, ready } = useAuth();
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  // Tapping a notification opens the right screen.
  useEffect(() => onPushTap((d) => {
    if (!user) return;
    if ((d.type === 'message' || d.type === 'trips') && d.bookingId) router.push("/(tabs)");
    else if (d.type === 'verification') router.push('/verification');
  }), [user]);
  if (!ready) return null;
  return <LiveProvider enabled={Boolean(user)}>
    <CallsProvider>
      <Stack screenOptions={{ headerTintColor: '#071B3A', headerStyle: { backgroundColor: '#F5F7FA' }, headerShadowVisible: false, headerBackTitle: 'Back' }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="apply" options={{ title: "Apply to drive" }} />
        <Stack.Screen name="forgot" options={{ title: '' }} />
        <Stack.Screen name="reset-password" options={{ title: '' }} />
        <Stack.Screen name="verification" options={{ title: 'Verification' }} />
        <Stack.Screen name="support" options={{ title: 'Support' }} />
      </Stack>
      <CallScreen />
    </CallsProvider>
  </LiveProvider>;
}

export default function RootLayout() {
  return <SafeAreaProvider>
    <StatusBar style="dark" />
    <UpdateGate logo={require('../assets/symbol.png')}>
      <AuthProvider><AppLock><Shell /></AppLock></AuthProvider>
    </UpdateGate>
  </SafeAreaProvider>;
}
