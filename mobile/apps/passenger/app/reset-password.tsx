import { router, useLocalSearchParams } from 'expo-router';
import { ResetScreen } from '@drop/shared';
/** Universal link https://<site>/reset-password?token=… opens here. */
export default function Reset() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <ResetScreen token={String(token || '')} onDone={() => router.replace('/sign-in')} />;
}
