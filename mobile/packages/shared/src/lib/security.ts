import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import { initializeSslPinning, isSslPinningAvailable } from 'react-native-ssl-public-key-pinning';
import { API_ORIGIN, extra } from './config';
import { secure, KEYS } from './secureStore';

/**
 * Certificate pinning (MASVS-NETWORK): the app only talks to the DROP API if its TLS key matches one
 * of the pins. Always ship two pins (current key + a backup key you hold) and rotate with an app update
 * before the server key changes. Disabled in development builds.
 */
export async function startPinning() {
  const pins = (extra.pins || []).filter(Boolean);
  if (__DEV__ || pins.length < 2 || !isSslPinningAvailable()) return false;
  await initializeSslPinning({ [new URL(API_ORIGIN).host]: { includeSubdomains: false, publicKeyHashes: pins } });
  return true;
}

/** Rooted / jailbroken devices: warn, and limit money actions (not a hard crash). */
export function useDeviceRisk() {
  const [risky, setRisky] = useState(false);
  useEffect(() => { Device.isRootedExperimentalAsync().then(setRisky).catch(() => setRisky(false)); }, []);
  return risky;
}

/** Ask for Face ID / fingerprint / device PIN. Resolves true if confirmed (or if no lock is set up). */
export async function confirmWithBiometrics(reason: string) {
  const has = await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
  if (!has) return true;
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, fallbackLabel: 'Use passcode', disableDeviceFallback: false });
  return r.success;
}

/** Optional app lock: after 5 minutes in the background, require biometrics to reopen. */
export function useAppLock() {
  const [locked, setLocked] = useState(false);
  const away = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'background') away.current = Date.now();
      if (s === 'active' && away.current && Date.now() - away.current > 5 * 60_000 && (await secure.get(KEYS.biometric)) === 'on') setLocked(true);
    });
    return () => sub.remove();
  }, []);
  const unlock = async () => { if (await confirmWithBiometrics('Unlock DROP')) setLocked(false); };
  return { locked, unlock };
}
