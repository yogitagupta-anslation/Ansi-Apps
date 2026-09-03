/**
 * Expo config plugin: wire BLE Attendance's two native modules into the projects
 * that `expo prebuild` generates.
 *
 * Same shape and same reasoning as `withBleChatNative.js`: Attendance was a bare
 * React Native app, so these lived in a committed `android/` folder. The hub is
 * an Expo project where `android/` is build output, so the same sources now live
 * under `modules/attendance/` and get re-applied on every prebuild:
 *
 *   1. BleAdvertiser — the peripheral half of the system. react-native-ble-plx is
 *      central-only, so without this an employee's phone can scan but can never
 *      be *seen* by a host, which is the entire point of the app. It comes with a
 *      foreground service, because what kills an advertisement is the process
 *      being reaped once the app is backgrounded.
 *   2. FileShare    — a FileProvider-backed share of one exported report file at
 *      a time, scoped to the app's own cache/reports directory.
 *
 * The sources still declare `package com.bleattendance.*` — a Java package has no
 * reason to follow the hub's application id — but the foreground service imports
 * `MainActivity` from the *application* package, which is now the hub's. That
 * reference is rewritten at copy time rather than hard-coded, so changing the app
 * id in app.json cannot silently break the build.
 *
 * THE neverForLocation TRAP — the reason this plugin also touches a permission
 * ---------------------------------------------------------------------------
 * react-native-ble-plx's OWN library manifest declares
 *
 *     <uses-permission android:name="android.permission.BLUETOOTH_SCAN"
 *                      android:usesPermissionFlags="neverForLocation" />
 *
 * and Android's manifest merger folds that flag into the final APK. Setting
 * `neverForLocation: false` on the ble-plx plugin in app.json stops *it* from
 * adding the flag, but does nothing about the library's own manifest — a missing
 * attribute loses to a present one. Only `tools:remove` strips it.
 *
 * Why that matters here: with the flag set, the platform filters beacon-shaped
 * advertisements out of scan results. Attendance's employee advertisements are
 * exactly beacon-shaped (service UUID + manufacturer data, non-connectable), so a
 * host would scan "successfully" and report nobody — a total failure of the app's
 * core function that looks identical to "nobody is nearby".
 *
 * The cost, paid app-wide, is that every BLE app in the hub must now hold
 * ACCESS_FINE_LOCATION and the user must have Location switched on. Each app's
 * permission module requests it; see the note in each `permissions` file.
 */

const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const { addReactPackages } = require('./addReactPackages');

const ANDROID_SOURCE_DIRS = ['ble', 'files'];
const ANDROID_PACKAGE_SEGMENTS = ['com', 'bleattendance'];

const REACT_PACKAGES = [
  'com.bleattendance.ble.BleAdvertiserPackage',
  'com.bleattendance.files.FileSharePackage',
];

const ADVERTISE_SERVICE = 'com.bleattendance.ble.BleAdvertiseService';

/* ------------------------------------------------------------------ *
 * Android sources
 * ------------------------------------------------------------------ */

function withAndroidSources(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const appPackage = mod.android?.package;
      if (!appPackage) {
        throw new Error('withAttendanceNative: android.package is not set in app.json.');
      }

      const source = path.join(mod.modRequest.projectRoot, 'modules', 'attendance', 'android');
      const javaRoot = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...ANDROID_PACKAGE_SEGMENTS,
      );

      for (const dir of ANDROID_SOURCE_DIRS) {
        const from = path.join(source, dir);
        const to = path.join(javaRoot, dir);
        fs.mkdirSync(to, { recursive: true });

        for (const file of fs.readdirSync(from)) {
          if (!file.endsWith('.kt')) continue;
          const contents = fs
            .readFileSync(path.join(from, file), 'utf8')
            // `com.bleattendance.MainActivity` / `com.bleattendance.R` are the
            // generated app's, not ours. Anchored so `com.bleattendance.ble.*` and
            // the framework's own `android.R` are both left alone.
            .replace(/com\.bleattendance\.MainActivity/g, `${appPackage}.MainActivity`)
            .replace(/com\.bleattendance\.R\b/g, `${appPackage}.R`);
          fs.writeFileSync(path.join(to, file), contents);
        }
      }

      // FileProvider's path declaration. Referenced by the <provider> below as
      // @xml/file_share_paths, so it has to land in the generated res tree.
      const resFrom = path.join(source, 'res', 'xml');
      const resTo = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(resTo, { recursive: true });
      for (const file of fs.readdirSync(resFrom)) {
        fs.copyFileSync(path.join(resFrom, file), path.join(resTo, file));
      }

      return mod;
    },
  ]);
}

function withPackageRegistration(config) {
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = addReactPackages(
      mod.modResults.contents,
      REACT_PACKAGES,
      'withAttendanceNative',
    );
    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

function withAttendanceManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;

    // `tools:remove` below is meaningless without the tools namespace declared
    // on <manifest>. Expo's helper is idempotent.
    AndroidConfig.Manifest.ensureToolsAvailable(manifest);

    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] ?? [];
    const permissions = manifest.manifest['uses-permission'];

    /**
     * Upsert, not insert-if-absent: `withEventPulseBle` and the ble-plx plugin
     * both run before this one and have already pushed bare entries. An "add only
     * if missing" helper would silently drop these attributes.
     */
    const upsert = (name, attributes = {}) => {
      const existing = permissions.find((entry) => entry.$?.['android:name'] === name);
      if (existing) {
        existing.$ = { ...existing.$, ...attributes };
        return;
      }
      permissions.push({ $: { 'android:name': name, ...attributes } });
    };

    // The whole point of this plugin's manifest pass — see the header note.
    // `usesPermissionFlags` is deleted from our own entry as well as removed from
    // the merged result, so neither source can put the flag back.
    const scan = permissions.find(
      (entry) => entry.$?.['android:name'] === 'android.permission.BLUETOOTH_SCAN',
    );
    if (scan) {
      delete scan.$['android:usesPermissionFlags'];
      scan.$['tools:remove'] = 'android:usesPermissionFlags';
    } else {
      permissions.push({
        $: {
          'android:name': 'android.permission.BLUETOOTH_SCAN',
          'tools:remove': 'android:usesPermissionFlags',
        },
      });
    }

    // Required for scanning precisely *because* the flag above is stripped.
    // `withEventPulseBle` caps this at API 30; scanning on 31+ now needs it too,
    // so the cap is cleared rather than the entry re-added.
    const fineLocation = permissions.find(
      (entry) => entry.$?.['android:name'] === 'android.permission.ACCESS_FINE_LOCATION',
    );
    if (fineLocation) {
      delete fineLocation.$['android:maxSdkVersion'];
    } else {
      upsert('android.permission.ACCESS_FINE_LOCATION');
    }

    upsert('android.permission.BLUETOOTH_ADVERTISE');
    upsert('android.permission.BLUETOOTH_CONNECT');

    // The advertiser's foreground service. Already added by withBleChatNative for
    // its own service; both are upserts, so whichever runs first wins and the
    // other is a no-op.
    upsert('android.permission.FOREGROUND_SERVICE');
    // API 34+ wants the specific type declared as its own permission. Omitting it
    // makes startForeground() throw SecurityException at runtime.
    upsert('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE');
    // API 33+: without this the service runs but its mandatory notification is
    // not shown, leaving the user no indication their radio is in use.
    upsert('android.permission.POST_NOTIFICATIONS');

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    /* ---- the advertising foreground service ---- */
    application.service = application.service ?? [];
    if (!application.service.some((entry) => entry.$?.['android:name'] === ADVERTISE_SERVICE)) {
      application.service.push({
        $: {
          'android:name': ADVERTISE_SERVICE,
          'android:enabled': 'true',
          'android:exported': 'false',
          // connectedDevice, honestly: this service exists to hold a BLE
          // advertisement on air.
          'android:foregroundServiceType': 'connectedDevice',
          // Load-bearing: this is what lets the advertisement survive the task
          // being swiped from recents on AOSP. Setting it true defeats the point.
          'android:stopWithTask': 'false',
        },
      });
    }

    /* ---- FileProvider for exported reports ---- */
    application.provider = application.provider ?? [];
    const providerName = 'androidx.core.content.FileProvider';
    if (!application.provider.some((entry) => entry.$?.['android:name'] === providerName)) {
      application.provider.push({
        $: {
          'android:name': providerName,
          // Matches `${reactContext.packageName}.fileshare` in FileShareModule.
          'android:authorities': '${applicationId}.fileshare',
          'android:exported': 'false',
          'android:grantUriPermissions': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'android.support.FILE_PROVIDER_PATHS',
              'android:resource': '@xml/file_share_paths',
            },
          },
        ],
      });
    }

    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

module.exports = function withAttendanceNative(config) {
  config = withAndroidSources(config);
  config = withPackageRegistration(config);
  config = withAttendanceManifest(config);
  return config;
};
