import { Redirect } from 'expo-router';
import { useAuth } from '@drop/shared';
export default function Index() {
  const { user } = useAuth();
  return <Redirect href={user ? '/(tabs)' : '/sign-in'} />;
}
