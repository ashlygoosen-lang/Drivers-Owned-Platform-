# 05 · Mobile apps: DROP and DROP Driver

Two React Native apps (Expo SDK 58, React Native 0.88, Hermes) for **Android and iOS**, in `mobile/`. They share one package and use the **same secured API as the website**; there is no separate backend.

```
mobile/
  packages/shared/   API client, sessions, integrity, live events, calls, push, security, UI kit, shared screens
  apps/passenger/    "DROP": book, track, chat/call, pay, trips, verification, account
  apps/driver/       "DROP Driver": apply, verification, go online (background GPS), trips, earnings, card
  app-config.base.js shared Expo config (permissions, privacy manifest, hardening)
```

## Feature parity

| Feature | Website | DROP | DROP Driver |
|---|:-:|:-:|:-:|
| Sign up / sign in / forgotten password / two-step sign-in | ✅ | ✅ | ✅ (apply) |
| Identity verification with camera upload | ✅ | ✅ | ✅ driver documents |
| Book ride, delivery, premium; upfront fare; card (Paystack) or cash | ✅ | ✅ | n/a |
| Live trip map (Google Maps), ETA, share my location | ✅ | ✅ | ✅ own car, passenger spot |
| Chat, voice and video calls, phone call on registered number | ✅ | ✅ | ✅ |
| Cancel, refund, rate, share trip, SOS 10111 | ✅ | ✅ | release trip |
| Go online, requests, accept, advance, navigate (Google Maps/Waze) | ✅ | n/a | ✅ with **background GPS** |
| Wallet, withdrawals, bank account, DROP Driver Card | ✅ | n/a | ✅ |
| Monthly plans: scholar transport (parents) and staff transport (business): quote, guardian consent, pay, skip days, cancel, renew, follow each trip | ✅ | ✅ School / Staff tab | n/a |
| Monthly plans for drivers: offers (vetted drivers only for scholar plans), accept the month, learner and handover details, release | ✅ | n/a | ✅ Plans tab |
| Notifications, support tickets, account deletion | ✅ | ✅ | ✅ |
| Push notifications (trip updates, messages, ringing calls) | n/a | ✅ | ✅ |
| Business accounts (employees, invoices), staff dashboards | ✅ | Business can book | website only |

## Security (OWASP MASVS v2)

| MASVS | Control | Where |
|---|---|---|
| STORAGE | Refresh token only in iOS Keychain / Android Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the driver app uses `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so background GPS can renew it). The access token is in memory only. `allowBackup=false`. | `lib/secureStore.ts`, `lib/api.ts` |
| CRYPTO | TLS only (`usesCleartextTraffic=false`). No app-side secrets or custom crypto. | app config |
| AUTH | Same server sessions as the website: 15-minute access tokens, rotating refresh tokens with reuse detection, two-step sign-in, sign out everywhere. Optional Face ID / fingerprint app lock after 5 minutes away. Biometric confirmation for withdrawals. | `lib/auth.tsx`, `lib/security.ts`, `Gates.tsx` |
| NETWORK | Certificate (public-key) pinning with two pins (primary and backup), disabled in development builds. | `lib/security.ts → startPinning` |
| PLATFORM | Minimal permissions. Unneeded ones are blocked (phone state, overlays, storage). Background location only in the driver app, after a **prominent disclosure** screen. Universal links and App Links are verified by the server (`/.well-known/*`). | `app-config.base.js` |
| CODE | Release builds: Hermes bytecode, R8 minify/obfuscate and resource shrinking, `console.*` stripped. **Force update**: the server sets the minimum version (`MOBILE_MIN_VERSION_*`), and older apps are blocked. | `babel.config.js`, `UpdateGate` |
| RESILIENCE | **App attestation:** Play Integrity (Android) and App Attest (iOS) proofs on sign-in, sign-up, booking, card checkout, withdrawals and bank changes, verified by the server (`ATTESTATION_MODE=report` then `enforce`). **Root/jailbreak detection:** a warning, and withdrawals and bank changes are disabled. | `lib/integrity.ts`, `backend/src/attest.js` |
| PRIVACY | Screenshots blocked on the earnings/bank screen. No analytics or ad SDKs. iOS privacy manifest declared. Account deletion in-app plus `/delete-account` page. Location is shared only while online or on a trip. | `wallet.tsx`, app config |

**Not included (deliberate):** OTA code updates (EAS Update). They can be added with code signing. Without them, every code change goes through store review, which is the safer default for a payments app.

## How it was verified here
- **Type checks:** `npm run typecheck` passes for the shared package and both apps (strict TypeScript).
- **Unit tests:** `npm test`, 8 tests:
  - polyline decoding and the version gate
  - the API client keeps tokens only in secure storage, refreshes and retries once, wipes a rejected refresh token, attaches integrity proofs only to sensitive calls, and revokes on sign-out
- **Production bundles:** `expo export` compiles both apps for Android **and** iOS to Hermes bytecode (every import and native module resolves).
- **Server side:** `backend/test/mobile-api.test.js` covers password reset, push, account deletion, force update, and the full Play Integrity and App Attest verification. The App Attest check uses a test certificate chain built with openssl in place of Apple's root.
- **Not yet run:** the apps on a physical phone or emulator, and the Maestro end-to-end flows (`apps/*/.maestro/*.yaml`). That needs an EAS development build on a device; see below. Google Maps, push delivery, camera/WebRTC and Play Integrity / App Attest only work in real native builds.
- **CI:** the `mobile` job in `.github/workflows/ci.yml` repeats the type check, tests and bundling on every push.

## Run it (developers)
```bash
cd mobile && npm install
npm i -g eas-cli && eas login
cd apps/passenger && eas init        # once per app; puts the project ID in app config (EAS_PROJECT_ID)
eas build --profile development --platform android   # installable dev build (Expo Go can't run WebRTC/attestation)
npx expo start --dev-client
```
Point the app at staging with `DROP_API_URL` (set in `eas.json` per profile).

## Release (owner checklist)
1. **Accounts:** Apple Developer Program ($99/year) and Google Play Console ($25 once), both in the name of VINK Group (Pty) Ltd. Use a D-U-N-S number for organisation enrolment.
2. **Identifiers:** bundle IDs `za.co.drop.passenger` and `za.co.drop.driver` (change in each `app.config.js` if you prefer).
3. **Keys and settings:**
   - **Mobile maps key:** create a Google Maps **Android** key restricted to both packages and their signing SHA-1, then set `GOOGLE_MAPS_ANDROID_KEY` as an EAS secret.
   - **Play Integrity:** enable the Play Integrity API in the Google Cloud project linked in Play Console. Set `GOOGLE_CLOUD_PROJECT_NUMBER` (app) and `GOOGLE_PLAY_INTEGRITY_SA_JSON` (server, a service account with the Play Integrity role).
   - **App Attest:** set `APPLE_TEAM_ID` on the server. Enable the App Attest capability for both bundle IDs.
   - **Push notifications:** upload the FCM V1 service-account key and an APNs key to Expo (`eas credentials`). Optionally set `EXPO_ACCESS_TOKEN` on the server.
   - **Certificate pinning:** `DROP_API_PINS="<current SPKI sha256>,<backup SPKI sha256>"`. Generate the pins with `openssl s_client -connect drop.co.za:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`, and keep the backup key offline.
   - **App links:** `ANDROID_CERT_SHA256` (Play App Signing SHA-256) on the server.
4. **Build and submit:** run **Actions → Mobile release builds** on GitHub (Android APK + AAB for both apps; iOS through Expo). Step by step: [09-mobile-release.md](09-mobile-release.md).
5. **Integrity rollout:** run with `ATTESTATION_MODE=report` for two weeks after launch, check Admin → Security for `app_integrity_failed`, then switch to `enforce`.
6. **Store listing:** see [store-submission.md](mobile/store-submission.md).
