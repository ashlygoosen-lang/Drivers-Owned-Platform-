#!/usr/bin/env node
/**
 * After `expo prebuild`, make the Android release build use DROP's own upload key and version code.
 *   DROP_UPLOAD_STORE_FILE, DROP_UPLOAD_STORE_PASSWORD, DROP_UPLOAD_KEY_ALIAS, DROP_UPLOAD_KEY_PASSWORD
 *   DROP_VERSION_CODE (integer, must increase with every Play upload), DROP_VERSION_NAME (e.g. 1.0.0)
 * Without the upload key, the release build stays signed with the debug key: fine for testing on phones,
 * refused by Google Play. Passwords are read from the environment at build time, never written to files.
 *   node scripts/android-release-signing.js apps/passenger/android
 */
const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
if (!dir) { console.error('usage: android-release-signing.js <android dir>'); process.exit(1); }
const file = path.join(dir, 'app', 'build.gradle');
let g = fs.readFileSync(file, 'utf8');
const env = process.env;

if (env.DROP_VERSION_CODE) {
  if (!/^\d+$/.test(env.DROP_VERSION_CODE)) throw new Error('DROP_VERSION_CODE must be a whole number');
  g = g.replace(/versionCode \d+/, `versionCode ${env.DROP_VERSION_CODE}`);
}
if (env.DROP_VERSION_NAME) g = g.replace(/versionName "[^"]*"/, `versionName "${env.DROP_VERSION_NAME.replace(/[^0-9A-Za-z.\-]/g, '')}"`);

const signed = Boolean(env.DROP_UPLOAD_STORE_FILE && env.DROP_UPLOAD_STORE_PASSWORD && env.DROP_UPLOAD_KEY_ALIAS && env.DROP_UPLOAD_KEY_PASSWORD);
if (signed) {
  if (!fs.existsSync(env.DROP_UPLOAD_STORE_FILE)) throw new Error('DROP_UPLOAD_STORE_FILE does not exist');
  const release = `
        release {
            storeFile file(System.getenv("DROP_UPLOAD_STORE_FILE"))
            storePassword System.getenv("DROP_UPLOAD_STORE_PASSWORD")
            keyAlias System.getenv("DROP_UPLOAD_KEY_ALIAS")
            keyPassword System.getenv("DROP_UPLOAD_KEY_PASSWORD")
        }`;
  if (!/signingConfigs \{[\s\S]*?debug \{[\s\S]*?\}/.test(g)) throw new Error('signingConfigs block not found; Expo template changed');
  g = g.replace(/(signingConfigs \{[\s\S]*?debug \{[\s\S]*?\n {8}\})/, `$1${release}`);
  // The release build type: the second "signingConfig signingConfigs.debug" (the first is the debug build type).
  let n = 0;
  g = g.replace(/signingConfig signingConfigs\.debug/g, (m) => (++n === 2 ? 'signingConfig signingConfigs.release' : m));
  if (n < 2) throw new Error('release signingConfig not found; Expo template changed');
}
// Test APKs: one per processor type (much smaller to send to testers); the Play bundle (AAB) is unaffected
// and still contains every type, from which Google Play delivers each phone only what it needs.
if (!g.includes('splits {')) {
  g = g.replace(/(\n    defaultConfig \{)/, `
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk false
        }
    }
$1`);
}
fs.writeFileSync(file, g);
console.log(`Android release: ${signed ? 'signed with the DROP upload key' : 'signed with the DEBUG key (testing only, not for Google Play)'}; versionCode ${env.DROP_VERSION_CODE || 'unchanged'}`);
