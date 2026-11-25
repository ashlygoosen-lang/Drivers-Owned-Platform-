import { router } from 'expo-router';
import { ForgotScreen } from '@drop/shared';
export default function Forgot() { return <ForgotScreen onBack={() => router.back()} />; }
