/**
 * Shared Expo config for DROP Passenger and DROP Driver. Values come from environment variables at
 * build time (EAS secrets / eas.json env). Nothing secret belongs here: everything in an app is public.
 *
 *   DROP_API_URL               https://drop.co.za (the same API as the website)
 *   DROP_API_PINS              two base64 SHA-256 SPKI pins for the API host (primary,backup)
 *   GOOGLE_MAPS_ANDROID_KEY    Maps SDK for Android key, restricted to the app package + signing SHA-1
 *   GOOGLE_CLOUD_PROJECT_NUMBER  for Play Integrity
 *   EAS_PROJECT_ID             from `eas init`
 */
const DRIVER_STRINGS = {
  locationWhenInUse: 'DROP Driver uses your location to show passengers where you are and to match you with nearby trips.',
  locationAlways: 'While you are online, DROP Driver uses your location in the background so passengers can track your arrival, even when the app is closed. Go offline to stop sharing.',
};
const PASSENGER_STRINGS = {
  locationWhenInUse: 'DROP uses your location to set your pickup point and, if you choose, to show your driver where you are.',
};

module.exports = function makeConfig({ app, name, bundleId, icon }) {
  const api = (process.env.DROP_API_URL || 'https://drop.example.com').replace(/\/$/, '');
  const host = new URL(api).host;
  const driver = app === 'driver';
  const S = driver ? DRIVER_STRINGS : PASSENGER_STRINGS;
  return {
    name,
    slug: driver ? 'drop-driver' : 'drop-passenger',
    scheme: driver ? 'dropdriver' : 'drop',
    version: '1.0.0',
    runtimeVersion: { policy: 'appVersion' },
    orientation: 'portrait',
    icon,
    userInterfaceStyle: 'light',
    backgroundColor: '#F5F7FA',
    ios: {
      bundleIdentifier: bundleId,
      buildNumber: '1',
      supportsTablet: false,
      associatedDomains: [`applinks:${host}`],
      // App Attest (genuine-app checks); 'development' for internal builds signed with a development profile.
      entitlements: { 'com.apple.developer.devicecheck.appattest-environment': process.env.APP_ATTEST_ENV || 'production' },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false, // standard HTTPS/TLS only (exempt)
        NSCameraUsageDescription: 'DROP uses the camera for video calls with your driver or passenger and to photograph your verification documents.',
        NSMicrophoneUsageDescription: 'DROP uses the microphone for in-app voice and video calls on your trips.',
        NSFaceIDUsageDescription: 'DROP can use Face ID to lock the app and confirm withdrawals.',
        NSLocationWhenInUseUsageDescription: S.locationWhenInUse,
        ...(driver && { NSLocationAlwaysAndWhenInUseUsageDescription: S.locationAlways, UIBackgroundModes: ['location', 'audio', 'voip', 'remote-notification'] }),
        ...(!driver && { UIBackgroundModes: ['audio', 'voip', 'remote-notification'] }),
      },
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
        ],
      },
    },
    android: {
      package: bundleId,
      versionCode: 1,
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: driver ? '#FF6B00' : '#071B3A' },
      allowBackup: false, // keep tokens and app data out of device backups
      permissions: [
        'CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', 'USE_BIOMETRIC', 'VIBRATE',
        ...(driver ? ['ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'WAKE_LOCK'] : []),
      ],
      blockedPermissions: ['android.permission.READ_PHONE_STATE', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', ...(driver ? [] : ['android.permission.ACCESS_BACKGROUND_LOCATION'])],
      config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY || '' } },
      intentFilters: [{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host, pathPrefix: '/reset-password' }, { scheme: 'https', host, pathPrefix: '/trip' }], category: ['BROWSABLE', 'DEFAULT'] }],
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      ['expo-splash-screen', { image: './assets/symbol.png', imageWidth: 160, backgroundColor: '#071B3A' }],
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '#FF6B00' }],
      ['expo-location', driver
        ? { locationWhenInUsePermission: S.locationWhenInUse, locationAlwaysAndWhenInUsePermission: S.locationAlways, isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true }
        : { locationWhenInUsePermission: S.locationWhenInUse, locationAlwaysAndWhenInUsePermission: false, isAndroidBackgroundLocationEnabled: false }],
      ['expo-image-picker', { cameraPermission: 'DROP uses the camera to photograph your verification documents.', photosPermission: false, microphonePermission: false }],
      ['expo-local-authentication', { faceIDPermission: 'DROP can use Face ID to lock the app and confirm withdrawals.' }],
      ['@config-plugins/react-native-webrtc', { cameraPermission: 'DROP uses the camera for video calls on your trips.', microphonePermission: 'DROP uses the microphone for calls on your trips.' }],
      ['expo-build-properties', {
        // Release hardening: R8 minify/obfuscate and shrink (Android); Hermes bytecode is the default engine.
        android: { enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true, usesCleartextTraffic: false },
        ios: {},
      }],
    ],
    experiments: { typedRoutes: false },
    extra: {
      app,
      apiUrl: api,
      pins: (process.env.DROP_API_PINS || '').split(',').map((s) => s.trim()).filter(Boolean),
      cloudProjectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '',
      easProjectId: process.env.EAS_PROJECT_ID || '',
      privacyUrl: `${api}/privacy`,
      termsUrl: `${api}/terms`,
      eas: { projectId: process.env.EAS_PROJECT_ID || undefined },
    },
  };
};
