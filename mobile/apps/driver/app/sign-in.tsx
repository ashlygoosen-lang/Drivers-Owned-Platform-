import { Redirect, router } from 'expo-router';
import { SignInScreen, useAuth } from '@drop/shared';
export default function SignIn() {
  const { user } = useAuth();
  if (user) return <Redirect href="/(tabs)" />;
  return <SignInScreen onForgot={() => router.push('/forgot')} onCreate={() => router.push('/apply')} createLabel="Apply to drive with DROP" />;
}
