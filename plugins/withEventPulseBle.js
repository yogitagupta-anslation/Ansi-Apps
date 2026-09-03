/**
 * Expo config plugin: wire the EventPulse BLE native module into the projects
 * that `expo prebuild` generates.
 *
 * Why a plugin instead of committed `android/` and `ios/` folders: those folders
 * are build output. Committing them means every Expo SDK bump becomes a manual
 * merge of files nobody wrote. This plugin re-applies the same three changes on
 * every prebuild:
 *
 *   1. copy the Kotlin / Swift sources into the generated project,
 *   2. register the Android package in MainApplication,
 *   3. add the manifest entries Android needs (with `neverForLocation`, which
 *      is what lets us scan without asking for the location permission).
 *
 * `expo prebuild --clean` therefore always produces a buildable project.
 */

const {
  withAndroidManifest,
  withDangerousMod,
  withGradleProperties,
  withMainApplication,
  withXcodeProject,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const { addReactPackages } = require('./addReactPackages');

const ANDROID_PACKAGE_PATH = 'com/eventpulse/ble';
const ANDROID_SOURCES = ['EventPulseBleModule.kt', 'EventPulseBlePackage.kt'];
const IOS_SOURCES = ['EventPulseBle.swift', 'EventPulseBle.m'];

/* ------------------------------------------------------------------ *
 * Android
 * ------------------------------------------------------------------ */

function withAndroidSources(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const platformRoot = mod.modRequest.platformProjectRoot;
      const source = path.join(projectRoot, 'modules', 'eventpulse-ble', 'android');
      const destination = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        ...ANDROID_PACKAGE_PATH.split('/'),
      );

      fs.mkdirSync(destination, { recursive: true });
      for (const file of ANDROID_SOURCES) {
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }
      return mod;
    },
  ]);
}

function withPackageRegistration(config) {
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = addReactPackages(
      mod.modResults.contents,
      ['com.eventpulse.ble.EventPulseBlePackage'],
      'withEventPulseBle',
    );
    return mod;
  });
}

function withBluetoothManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] ?? [];

    const permissions = manifest.manifest['uses-permission'];

    /**
     * Upsert, not insert-if-absent.
     *
     * Expo's `android.permissions` in app.json runs before this plugin and adds
     * bare `<uses-permission>` entries. An "add only if missing" helper would
     * therefore silently drop our attributes — and losing `neverForLocation` is
     * not cosmetic: without it Android 12+ treats BLE scanning as
     * location-derived and demands the location permission, which is precisely
     * the thing this app promises not to need.
     */
    const add = (name, attributes = {}) => {
      const existing = permissions.find((entry) => entry.$?.['android:name'] === name);
      if (existing) {
        existing.$ = { ...existing.$, ...attributes };
        return;
      }
      permissions.push({ $: { 'android:name': name, ...attributes } });
    };

    // Android 12+ split Bluetooth into purpose-scoped runtime permissions.
    //
    // `neverForLocation` used to be set here, and it is what let EventPulse skip
    // the location permission entirely. It is deliberately no longer set: BLE
    // Attendance cannot work with that flag in the merged manifest, because the
    // platform then filters its beacon-shaped employee advertisements out of
    // every scan result. One APK has one manifest, so the flag had to go
    // app-wide. `plugins/withAttendanceNative.js` carries the full reasoning and
    // is what actually strips the copy that react-native-ble-plx's own library
    // manifest contributes; this is only about not having two plugins set the
    // same attribute to opposite values.
    add('android.permission.BLUETOOTH_SCAN');
    add('android.permission.BLUETOOTH_ADVERTISE');
    add('android.permission.BLUETOOTH_CONNECT');

    // Android 11 and below: the legacy permissions.
    add('android.permission.BLUETOOTH', { 'android:maxSdkVersion': '30' });
    add('android.permission.BLUETOOTH_ADMIN', { 'android:maxSdkVersion': '30' });
    // No longer capped at API 30. With `neverForLocation` gone, scanning needs
    // this on every version, not just the ones that always did.
    add('android.permission.ACCESS_FINE_LOCATION');

    // Declare BLE as required-at-runtime rather than at install, so the app
    // still installs on a device without it and degrades to Discover only.
    manifest.manifest['uses-feature'] = manifest.manifest['uses-feature'] ?? [];
    const features = manifest.manifest['uses-feature'];
    if (!features.some((entry) => entry.$?.['android:name'] === 'android.hardware.bluetooth_le')) {
      features.push({
        $: {
          'android:name': 'android.hardware.bluetooth_le',
          'android:required': 'false',
        },
      });
    }

    return mod;
  });
}

/**
 * Relocate Gradle's project cache when the project path contains a space.
 *
 * Gradle 8.10 fails on Windows with
 *
 *   Could not move temporary workspace (...\.gradle\8.10.2\dependencies-accessors\<hash>-<uuid>)
 *   to immutable location (...\dependencies-accessors\<hash>)
 *
 * when `.gradle` sits under a path with a space in it — reproducible here in
 * about one second, and it happens before any of our code compiles, so it looks
 * alarming and says nothing useful.
 *
 * Moving only the *project* cache off that path fixes it and changes nothing
 * else about the build. The permanent fix is to check the project out somewhere
 * without a space; this keeps `npx expo run:android` working in the meantime.
 */
function withGradleCacheWorkaround(config) {
  return withGradleProperties(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    if (!projectRoot.includes(' ')) return mod;

    const key = 'org.gradle.projectcachedir';
    if (mod.modResults.some((item) => item.type === 'property' && item.key === key)) return mod;

    // Drive root on Windows, /tmp elsewhere — both space-free by construction.
    const drive = path.parse(projectRoot).root.replace(/[\\/]$/, '');
    const cacheDir =
      process.platform === 'win32' ? `${drive}/.eventpulse-gradle` : '/tmp/.eventpulse-gradle';

    mod.modResults.push({
      type: 'comment',
      value:
        ' Project path contains a space, which breaks Gradle 8.10 dependency accessors on Windows.',
    });
    mod.modResults.push({ type: 'property', key, value: cacheDir.replace(/\\/g, '/') });
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
      const projectRoot = mod.modRequest.projectRoot;
      const platformRoot = mod.modRequest.platformProjectRoot;
      const projectName = mod.modRequest.projectName;
      const source = path.join(projectRoot, 'modules', 'eventpulse-ble', 'ios');
      const destination = path.join(platformRoot, projectName);

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
      // `addSourceFile` is idempotent enough in practice, but a prebuild that
      // ran twice should not produce duplicate build entries.
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

module.exports = function withEventPulseBle(config) {
  config = withAndroidSources(config);
  config = withPackageRegistration(config);
  config = withBluetoothManifest(config);
  config = withGradleCacheWorkaround(config);
  config = withIosSources(config);
  return config;
};
