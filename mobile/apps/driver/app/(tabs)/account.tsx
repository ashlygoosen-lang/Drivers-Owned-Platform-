import { router } from 'expo-router';
import { AccountScreen } from '@drop/shared';
export default function Account() { return <AccountScreen onVerification={() => router.push('/verification')} onSupport={() => router.push('/support')} />; }
