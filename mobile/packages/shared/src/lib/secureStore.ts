import * as SecureStore from 'expo-secure-store';

/**
 * Secrets live only in the iOS Keychain / Android Keystore (MASVS-STORAGE), never in AsyncStorage.
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: not readable while the phone is locked and never restored to another
 * device from a backup.
 */
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// Background location (driver) must refresh its token while the screen is locked.
const BACKGROUND_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const secure = {
  get: (key: string) => SecureStore.getItemAsync(key, OPTS).catch(() => null),
  set: (key: string, value: string | null, background = false) =>
    (value == null ? SecureStore.deleteItemAsync(key, OPTS) : SecureStore.setItemAsync(key, value, background ? BACKGROUND_OPTS : OPTS)).catch(() => undefined),
};
export const KEYS = { refresh: 'drop.refresh', attestKey: 'drop.attestKey', biometric: 'drop.biometricLock', disclosure: 'drop.locationDisclosure' };
