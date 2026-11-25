import { Platform } from 'react-native';
import * as AppIntegrity from '@expo/app-integrity';
import { extra } from './config';
import { secure, KEYS } from './secureStore';

type Raw = <T>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<T>;

/**
 * Proof that a sensitive request comes from the genuine app on a real device (MASVS-RESILIENCE).
 * Android: Play Integrity standard request, bound to a one-time server challenge.
 * iOS: App Attest key (registered once) signs an assertion over the challenge.
 * If the device can't attest (simulator, unsupported device), no proof is sent: the server decides
 * (ATTESTATION_MODE=report logs it, enforce blocks it).
 */
let prepared = false;
export async function integrityHeaders(raw: Raw): Promise<Record<string, string>> {
  try {
    if (Platform.OS === 'android') {
      if (!extra.cloudProjectNumber) return {};
      if (!prepared) { await AppIntegrity.prepareIntegrityTokenProviderAsync(extra.cloudProjectNumber); prepared = true; }
      const { challenge } = await raw<{ challenge: string }>('/app/attest/challenge', { method: 'POST' });
      const token = await AppIntegrity.requestIntegrityCheckAsync(challenge);
      return { 'x-drop-challenge': challenge, 'x-drop-integrity': `android ${token}` };
    }
    if (Platform.OS !== 'ios' || !AppIntegrity.isSupported) return {};
    let keyId = await secure.get(KEYS.attestKey);
    if (!keyId) {
      keyId = await AppIntegrity.generateKeyAsync();
      const reg = await raw<{ challenge: string }>('/app/attest/challenge', { method: 'POST' });
      const attestation = await AppIntegrity.attestKeyAsync(keyId, reg.challenge);
      await raw('/app/attest/ios/register', { method: 'POST', body: { keyId, attestation, challenge: reg.challenge } });
      await secure.set(KEYS.attestKey, keyId);
    }
    const { challenge } = await raw<{ challenge: string }>('/app/attest/challenge', { method: 'POST' });
    const assertion = await AppIntegrity.generateAssertionAsync(keyId, challenge);
    return { 'x-drop-challenge': challenge, 'x-drop-integrity': `ios ${keyId}.${assertion}` };
  } catch {
    return {};
  }
}
