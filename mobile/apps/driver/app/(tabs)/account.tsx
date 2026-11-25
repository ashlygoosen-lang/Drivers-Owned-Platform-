import { router } from 'expo-router';
import { AccountScreen, Row } from '@drop/shared';
export default function Account() { return <AccountScreen onVerification={() => router.push('/verification')} onSupport={() => router.push('/support')} extraRows={<Row icon="car" title="My vehicle" subtitle="What it can do, or change it" onPress={() => router.push('/vehicle')} />} />; }
