# 09 · Building and publishing the apps

**For:** Vincent Kafula, VINK Group (Pty) Ltd · **Date:** 25 November 2026

Both apps (DROP and DROP Driver) are built by GitHub. Go to **Actions → Mobile release builds → Run workflow**. Each run produces, for each app:

| File | What it's for |
|---|---|
| `DROP-1.0.0-<n>-…-arm64-v8a.apk`, `DROP-Driver-…-arm64-v8a.apk` | Install directly on Android phones for testing (arm64 fits almost every current phone; `armeabi-v7a` is for older phones, `x86_64` for emulators and Chromebooks) |
| `DROP-1.0.0-<n>-….aab`, `DROP-Driver-1.0.0-<n>-….aab` | Upload to Google Play Console |
| `SHA256SUMS.txt` | Checksums, to confirm the files weren't changed |

Download them from the run's **Artifacts** section (kept 30 days). Files ending `test-signed` are signed with a debug key: they install on phones, but Google Play refuses them. Files ending `release` are signed with your upload key and ready for Play.

The run also type-checks and tests the apps first, so a broken build never produces files.

## 1. One-time setup (only you can do this)

Add these under **GitHub → Settings → Secrets and variables → Actions**. Never paste them in chat, email or code.

| Name | Type | What it is |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Secret | Your Play upload key, base64-encoded (see below) |
| `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` | Secrets | The key's passwords and alias |
| `GOOGLE_MAPS_ANDROID_KEY` | Secret | Maps SDK for Android key, restricted to `za.co.drop.passenger` and `za.co.drop.driver` and your signing SHA-1. Without it the in-app maps are blank |
| `DROP_API_PINS` | Variable | Two certificate pins for drop.co.za (see 05-mobile-apps.md). Leave empty until the domain is live |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | Variable | For Play Integrity (genuine-app checks) |
| `EAS_PROJECT_ID_PASSENGER`, `EAS_PROJECT_ID_DRIVER` | Variables | From `eas init` in each app folder. Push notifications need them |
| `EXPO_TOKEN` (secret) and `EAS_ENABLED=true` (variable) | Optional | Turns on the Expo job that builds **iOS** and Android in Expo's cloud and submits them to the stores |

**Create the Android upload key** (once, on your own computer; keep the file and passwords in a password manager, because losing it means contacting Google to reset it):

```bash
keytool -genkeypair -v -keystore drop-upload.jks -alias drop-upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 drop-upload.jks   # paste the output into the ANDROID_UPLOAD_KEYSTORE_BASE64 secret
```

In Play Console, turn on **Play App Signing** (Google holds the app signing key; you keep the upload key). Then copy Play's **app signing SHA-256** into the server variable `ANDROID_CERT_SHA256` so password-reset and trip links open the app.

## 2. Publishing on Google Play

1. Create both apps in Play Console (VINK Group (Pty) Ltd developer account).
2. Fill in the store listing, Data safety form and declarations from [mobile/store-submission.md](mobile/store-submission.md). DROP Driver needs the background-location declaration and a short video.
3. Upload the `release` AAB to **Internal testing** first, test on real phones, then promote to Production.
4. Every later upload needs a higher version code. The workflow uses the run number, so just run it again.

## 3. Publishing on the App Store (iPhone)

iPhone apps must be built on Apple's tools, which GitHub's Linux runners and this workspace don't have. Use the Expo job:

1. Apple Developer Program in VINK Group's name (D-U-N-S number needed), App Store Connect apps for both bundle IDs.
2. Create an Expo account, run `npx eas-cli init` and `npx eas-cli credentials` in each app folder (`mobile/apps/passenger`, `mobile/apps/driver`), and let Expo manage the certificates.
3. Add `EXPO_TOKEN` and `EAS_ENABLED=true` in GitHub, then run the workflow. Expo builds both platforms and, with `--auto-submit`, sends them to App Store Connect (TestFlight) and Google Play.
4. Fill in App Privacy and review notes from [mobile/store-submission.md](mobile/store-submission.md), add reviewer demo accounts, and submit for review.

## 4. Before each release

- Point the build at the right server: the workflow's **api_url** (default `https://drop.co.za`). The website and API must be live there first, with HTTPS.
- Bump the **version** (for example 1.0.1) for a store update.
- If an update fixes a security problem, raise `MOBILE_MIN_VERSION_PASSENGER` / `_DRIVER` on the server once it's live in both stores, so older apps ask users to update.
