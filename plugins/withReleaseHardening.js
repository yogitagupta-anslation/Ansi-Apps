/**
 * Expo config plugin: the things a release build needs that a debug build does not.
 *
 * WHY THIS IS A PLUGIN AND NOT AN EDIT TO `android/`
 * -------------------------------------------------
 * `/android/` is gitignored and regenerated — `expo prebuild --clean` throws the whole
 * folder away and builds it again from `app.json` plus the plugin list. Every fix in
 * here is therefore written as a mod that re-applies on every prebuild, exactly like
 * withBleChatNative and withAttendanceNative do for their native sources. Editing
 * `android/app/build.gradle` by hand would work until the next prebuild and then
 * silently revert, which is a worse failure than not doing it at all.
 *
 * WHAT IT CHANGES, and what each one is for:
 *
 *   1. Release signing, from a keystore this repo does not contain. The generated
 *      project signs release builds with the DEBUG keystore, which Play rejects on
 *      upload. See `signingConfigs` below for how credentials are supplied.
 *
 *   2. R8 and resource shrinking, both off by default in an Expo project. With four
 *      ABIs and no shrinking the universal APK reached 99 MB against Play's 100 MB
 *      ceiling; dex alone was 29.8 MB of it.
 *
 *   3. Cloud backup off. The app writes its identity key and its at-rest key into
 *      AsyncStorage, and Android Auto Backup copies the whole data directory to the
 *      user's Google Drive. On a device where the Keystore probe fails, SecureStore
 *      falls back to storing that key unwrapped — so the backup would carry the
 *      ciphertext and the key to read it in the same archive.
 *
 *   4. Keep rules for every native module in this repo, so that turning R8 on in (2)
 *      cannot strip a class the bridge looks up by name.
 *
 * Device-to-device transfer is deliberately LEFT ENABLED — see withBackupRules.
 */

const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * 1. Release signing
 * ------------------------------------------------------------------ */

/**
 * Where credentials come from, in order:
 *
 *   android/keystore.properties   a local file, gitignored, for a developer machine
 *   ANDROID_KEYSTORE_* env vars   for CI, where a file on disk is the wrong shape
 *
 * WHEN NEITHER IS PRESENT the release build falls back to debug signing, which is
 * exactly what it does today. That fallback is deliberate: `expo run:android
 * --variant release` is a normal thing to do while developing, and making it fail
 * because no production keystore exists would break a working local flow to guard
 * against a mistake that only matters at upload time. Play itself rejects the
 * debug-signed artifact, so the mistake cannot reach users — and Gradle prints a
 * warning at configure time so it is not silent either.
 */
const SIGNING_CONFIG = `
// ---- release signing (injected by plugins/withReleaseHardening.js) ----
// Credentials are read from android/keystore.properties (gitignored) or from
// ANDROID_KEYSTORE_* environment variables. Neither is committed to this repo.
def releaseSigning = new Properties()
def releaseSigningFile = rootProject.file('keystore.properties')
if (releaseSigningFile.exists()) {
    releaseSigningFile.withInputStream { releaseSigning.load(it) }
}
if (System.getenv('ANDROID_KEYSTORE_PATH')) {
    releaseSigning['storeFile'] = System.getenv('ANDROID_KEYSTORE_PATH')
    releaseSigning['storePassword'] = System.getenv('ANDROID_KEYSTORE_PASSWORD')
    releaseSigning['keyAlias'] = System.getenv('ANDROID_KEY_ALIAS')
    releaseSigning['keyPassword'] = System.getenv('ANDROID_KEY_PASSWORD')
}
def hasReleaseKeystore = releaseSigning['storeFile'] != null &&
        rootProject.file(releaseSigning['storeFile']).exists()
if (!hasReleaseKeystore) {
    logger.warn('w: No release keystore configured — release builds will be signed ' +
            'with the DEBUG key and cannot be uploaded to Play. ' +
            'See android/keystore.properties.example.')
}
`;

const RELEASE_SIGNING_BLOCK = `
        release {
            if (hasReleaseKeystore) {
                storeFile rootProject.file(releaseSigning['storeFile'])
                storePassword releaseSigning['storePassword']
                keyAlias releaseSigning['keyAlias']
                keyPassword releaseSigning['keyPassword']
            }
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;

    if (gradle.includes('withReleaseHardening.js')) {
      // Already applied. A prebuild that is not --clean re-runs mods over the
      // previous output, and appending a second copy would not compile.
      return mod;
    }

    // The properties block goes above `android {` so both signingConfigs and
    // buildTypes can see it.
    gradle = gradle.replace(/\nandroid \{/, `\n${SIGNING_CONFIG}\nandroid {`);

    // Add a `release` entry beside the existing `debug` one.
    gradle = gradle.replace(
      /(signingConfigs \{[\s\S]*?\n {8}\})/,
      `$1${RELEASE_SIGNING_BLOCK}`,
    );

    // Point the release buildType at it, when one is actually configured.
    gradle = gradle.replace(
      /(release \{\n)(\s*)\/\/ Caution![\s\S]*?signingConfig signingConfigs\.debug/,
      `$1$2signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug`,
    );

    mod.modResults.contents = gradle;
    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * 2. R8 and resource shrinking
 * ------------------------------------------------------------------ */

/**
 * Both default to false in an Expo project, and the generated build.gradle reads them
 * from gradle.properties rather than hard-coding them — so setting the properties is
 * all that is needed, and the generated file keeps its shape.
 *
 * shrinkResources requires minifyEnabled; AGP fails the build if it is set alone.
 */
const GRADLE_PROPERTIES = [
  ['android.enableMinifyInReleaseBuilds', 'true'],
  ['android.enableShrinkResourcesInReleaseBuilds', 'true'],
];

function withShrinking(config) {
  return withGradleProperties(config, (mod) => {
    for (const [key, value] of GRADLE_PROPERTIES) {
      const existing = mod.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        mod.modResults.push({ type: 'property', key, value });
      }
    }
    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * 4. Keep rules
 * ------------------------------------------------------------------ */

/**
 * R8 reaches every native module in this app through a ReactPackage that is
 * constructed directly, so in principle the call graph keeps them. In practice the
 * bridge also resolves modules and their methods by NAME at runtime, and a rule that
 * is unnecessary costs a few kilobytes while a rule that is missing costs a crash on
 * a device nobody has tested yet.
 *
 * Every package below is either hand-written in `modules/` or a BLE dependency whose
 * failure mode is the app appearing to work while finding nobody — the hardest kind
 * of regression to notice. They are kept explicitly.
 */
const KEEP_RULES = `
# ---- injected by plugins/withReleaseHardening.js ----
# Native modules written in this repo. Registered through ReactPackages, but resolved
# by name across the bridge, so they are kept by name rather than by reachability.
-keep class com.blechat.** { *; }
-keep class com.bleattendance.** { *; }
-keep class com.eventpulse.ble.** { *; }

# BLE dependencies. A stripped adapter class here does not crash — it scans and finds
# nobody, which looks exactly like an empty room.
-keep class com.bleplx.** { *; }
-keep class com.bleperipheralmanager.** { *; }

# Reached only through ACTION_IMAGE_CAPTURE / provider entries in the manifest.
-keep class com.imagepicker.** { *; }

# The bridge invokes these reflectively.
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }
-keep @com.facebook.react.module.annotations.ReactModule class * { *; }

# ScreenGuardModule reflects onto android.app.Activity$ScreenCaptureCallback through a
# dynamic Proxy. The framework side is not ours to shrink, but the proxy's interfaces
# must survive for the callback to be dispatched.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keeps stack traces in Play Console readable after R8 renames everything.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
`;

function withKeepRules(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const rules = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      const existing = fs.existsSync(rules) ? fs.readFileSync(rules, 'utf8') : '';
      if (!existing.includes('withReleaseHardening.js')) {
        fs.writeFileSync(rules, `${existing.trimEnd()}\n${KEEP_RULES}`, 'utf8');
      }
      return mod;
    },
  ]);
}

/* ------------------------------------------------------------------ *
 * 3. Backup
 * ------------------------------------------------------------------ */

/**
 * CLOUD BACKUP OFF, DEVICE TRANSFER LEFT ON. The two are separate switches on
 * Android 12+ and the reasons differ.
 *
 * Cloud backup copies the data directory to Google Drive, off the device and onto
 * infrastructure neither the user nor this app controls. For an app holding a
 * messaging identity key that is the wrong default, so it is turned off.
 *
 * Device-to-device transfer stays enabled because it is how somebody moves to a new
 * phone, and turning it off would silently discard attendance records, event
 * profiles and game history for every user who switches devices — a real loss, to
 * defend against an attacker who already has both phones. Note that a Keystore-wrapped
 * key does not survive the move regardless: the hardware key stays behind, and
 * SecureStore already reports that as KeyInvalidatedError.
 */
const EXCLUDE_ALL = ['root', 'database', 'sharedpref', 'external', 'file'];

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Written by plugins/withReleaseHardening.js.

  Cloud backup is excluded in full: this app stores a messaging identity key and an
  at-rest encryption key in AsyncStorage, and on a device with no usable Keystore the
  at-rest key is stored unwrapped beside the data it protects.

  Device transfer is intentionally NOT excluded, so moving to a new phone keeps
  attendance records, profiles and history.
-->
<data-extraction-rules>
  <cloud-backup>
${EXCLUDE_ALL.map((d) => `    <exclude domain="${d}" />`).join('\n')}
  </cloud-backup>
</data-extraction-rules>
`;

function withBackupRules(config) {
  const withXml = withDangerousMod(config, [
    'android',
    (mod) => {
      const dir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'data_extraction_rules.xml'), BACKUP_RULES, 'utf8');
      return mod;
    },
  ]);

  return withAndroidManifest(withXml, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) {
      return mod;
    }
    // allowBackup governs cloud backup on every version; dataExtractionRules is what
    // Android 12+ reads, and is what keeps device transfer working while cloud backup
    // is off. Both are set, because the app supports API 24 upward.
    application.$['android:allowBackup'] = 'false';
    application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
    return mod;
  });
}

/* ------------------------------------------------------------------ */

module.exports = function withReleaseHardening(config) {
  return withBackupRules(withKeepRules(withShrinking(withReleaseSigning(config))));
};
