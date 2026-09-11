/**
 * Expo config plugin: wire BleChat's three native modules into the projects that
 * `expo prebuild` generates.
 *
 * BleChat was a bare React Native app, so these lived in a committed `android/`
 * folder. The hub is an Expo project where `android/` is build output, so the same
 * sources now live under `modules/blechat/` and get re-applied on every prebuild:
 *
 *   1. BlePeripheral  — the GATT server half of the link. react-native-ble-plx is
 *      central-only, so without this BleChat can scan but never be found.
 *   2. Presence       — the foreground service that keeps the radio alive while the
 *      app is backgrounded. A BLE message is not stored anywhere; a missed one is
 *      missed permanently, which is why this is not optional.
 *   3. SecureStore    — Keystore-backed storage for the identity key.
 *
 * The sources still declare `package com.blechat.*` — a Java package has no reason
 * to follow the hub's application id — but two of them import `MainActivity` and
 * `R` from the *application* package, which is now the hub's. Those two references
 * are rewritten at copy time rather than hard-coded, so changing the app id in
 * app.json cannot silently break the build.
 */

const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withXcodeProject,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const { addReactPackages } = require('./addReactPackages');

const ANDROID_SOURCE_DIRS = ['bleperipheral', 'bleclient', 'presence', 'securestore', 'screenguard'];
const ANDROID_PACKAGE_SEGMENTS = ['com', 'blechat'];
const IOS_SOURCES = ['BlePeripheral.swift', 'BlePeripheral.m'];

const REACT_PACKAGES = [
  'com.blechat.bleperipheral.BlePeripheralPackage',
  'com.blechat.bleclient.BleClientPackage',
  'com.blechat.presence.PresencePackage',
  'com.blechat.securestore.SecureStorePackage',
  'com.blechat.screenguard.ScreenGuardPackage',
];

/* ------------------------------------------------------------------ *
 * Android sources
 * ------------------------------------------------------------------ */

function withAndroidSources(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const appPackage = mod.android?.package;
      if (!appPackage) {
        throw new Error('withBleChatNative: android.package is not set in app.json.');
      }

      const source = path.join(mod.modRequest.projectRoot, 'modules', 'blechat', 'android');
      const destinationRoot = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...ANDROID_PACKAGE_SEGMENTS,
      );

      for (const dir of ANDROID_SOURCE_DIRS) {
        const from = path.join(source, dir);
        const to = path.join(destinationRoot, dir);
        fs.mkdirSync(to, { recursive: true });

        for (const file of fs.readdirSync(from)) {
          if (!file.endsWith('.kt')) continue;
          const contents = fs
            .readFileSync(path.join(from, file), 'utf8')
            // `com.blechat.MainActivity` / `com.blechat.R` are the generated app's,
            // not ours. Anchored on the dot so `com.blechat.presence.*` is untouched.
            .replace(/com\.blechat\.MainActivity/g, `${appPackage}.MainActivity`)
            .replace(/com\.blechat\.R\b/g, `${appPackage}.R`);
          fs.writeFileSync(path.join(to, file), contents);
        }
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
      'withBleChatNative',
    );
    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

function withPresenceService(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;

    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] ?? [];
    const permissions = manifest.manifest['uses-permission'];
    const addPermission = (name) => {
      if (permissions.some((entry) => entry.$?.['android:name'] === name)) return;
      permissions.push({ $: { 'android:name': name } });
    };

    addPermission('android.permission.FOREGROUND_SERVICE');
    // API 34+ wants the specific type declared as its own permission.
    addPermission('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE');
    // API 33+: without this the service runs but shows nothing, leaving the user with
    // no indication their radio is in use and no way to stop it.
    addPermission('android.permission.POST_NOTIFICATIONS');

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.service = application.service ?? [];

    const name = 'com.blechat.presence.ChatForegroundService';
    if (!application.service.some((entry) => entry.$?.['android:name'] === name)) {
      application.service.push({
        $: {
          'android:name': name,
          'android:exported': 'false',
          // connectedDevice, honestly: this service exists to hold a Bluetooth link
          // and scan open. Picking a broader type to dodge a restriction is exactly
          // the abuse the requirement exists to stop.
          'android:foregroundServiceType': 'connectedDevice',
        },
      });
    }

    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * iOS
 * ------------------------------------------------------------------ */

function withIosSources(config) {
  const withCopied = withDangerousMod(config, [
    'ios',
    (mod) => {
      const source = path.join(mod.modRequest.projectRoot, 'modules', 'blechat', 'ios');
      const destination = path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName);

      fs.mkdirSync(destination, { recursive: true });
      for (const file of IOS_SOURCES) {
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }
      return mod;
    },
  ]);

  return withXcodeProject(withCopied, (mod) => {
    const project = mod.modResults;
    const projectName = mod.modRequest.projectName;
    const group = project.findPBXGroupKey({ name: projectName });
    if (!group) return mod;

    for (const file of IOS_SOURCES) {
      const alreadyAdded = Object.values(project.pbxFileReferenceSection()).some(
        (entry) => typeof entry === 'object' && entry.path?.includes(file),
      );
      if (alreadyAdded) continue;
      project.addSourceFile(`${projectName}/${file}`, { target: project.getFirstTarget().uuid }, group);
    }

    return mod;
  });
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

module.exports = function withBleChatNative(config) {
  config = withAndroidSources(config);
  config = withPackageRegistration(config);
  config = withPresenceService(config);
  config = withIosSources(config);
  return config;
};
