# App Hub

One Expo app that launches five existing apps from a single home screen.

```bash
npm install
npm run android
```

`npm run android` is `expo run:android`: it prebuilds the native project from
`app.json` + the plugins in `plugins/`, compiles it, and installs it on a
connected device or running emulator. The first run takes a while (NDK, CMake);
after that it is incremental.

Everything here needs a **development build**. There is no Expo Go path — the
hand-written native modules and `react-native-ble-plx` are not in the Go client.

## What is inside

| App | What it is | Where it came from |
| --- | --- | --- |
| **BLE Chat** | Encrypted peer-to-peer chat over Bluetooth Low Energy | `test/BleChat` |
| **EventPulse** | Live proximity radar for conferences and meetups | `networking app/mobile` |
| **Higher or Lower** | Number-guessing race, solo / daily / multiplayer | `guess the number/mobile` |
| **Bluetooth Attendance** | Offline roll call: employees advertise, the host records | `react-native-app` |
| **Treasure Hunt** | Offline multiplayer treasure hunt in a virtual world | `Treasure-hunt-game` |

## Layout

```
App.tsx                 root NavigationContainer + one stack route per app
index.ts                CSPRNG polyfill, global error handler, registerRootComponent
src/hub/                the launcher: registry, search, categories, recents, featured
src/shell/AppFrame.tsx  the strip every hosted app runs under
src/apps/<app>/         each app's original src/, plus a <Name>App.tsx entry
modules/                Kotlin/Swift native sources the config plugins install
plugins/                the config plugins that install them
```

## How the apps share one shell

**One navigation container.** React Navigation allows exactly one per tree, so
the hub owns it and each app contributes a *nested* navigator underneath. Each
app's own `NavigationContainer` was replaced with React Navigation's
`ThemeProvider`, which is the supported way to give a subtree its own colours
without a second container. Android's back button then works for free: the
innermost navigator handles it until nothing is left to pop, at which point the
root stack returns to the hub.

**One safe-area provider.** `AppFrame` renders the "‹ App Hub" strip in the band
under the status bar, then hands the subtree a top inset of `0` via
`SafeAreaInsetsContext`. Without that override every screen in every app
would pad past a strip that had already consumed that space.

**Lazy apps.** Registry entries hold `lazy(() => import(...))`, so opening the
hub does not pull in a BLE stack, a positioning engine and an audio bank.

**Cheap to leave.** Closing an app back to the hub drops BLE Chat to its saver
scan duty cycle, moves EventPulse's scanner to its `background` phase, frees
Higher or Lower's audio players, flushes Attendance's pending records, and
disposes Treasure Hunt's `GameManager` (which is built fresh on every open, so
this is a clean teardown rather than a one-way door).

Two radios deliberately keep running. BLE Chat's, because a BLE message exists
only while both radios are on, so a missed one is missed permanently — which is
what its foreground service is for. Attendance's, for the same reason: a hub
exit is far closer to backgrounding than to quitting, and stopping the employee
advertisement there would silently make that phone invisible to the host, which
is precisely what its own foreground service and `android:stopWithTask="false"`
exist to prevent. Both stay under the user's control from their own settings.

**One orientation, unlocked at runtime.** Treasure Hunt is a landscape game and
shipped as `android:screenOrientation="sensorLandscape"`; the hub and the other
four apps are portrait, and one Activity cannot be statically both. So its lock
moved from the manifest into `TreasureHuntApp.tsx`, scoped to exactly the time
that app is mounted and released on the way out. `app.json` stays `portrait`.

**No key collisions.** The five storage namespaces (`@blechat/`, `eventpulse:`,
`hol.`, `@bleattendance/`, `th.v1.`) are disjoint, so nothing had to be renamed.
Each app funnels all of its AsyncStorage access through one small wrapper, so
this is checkable rather than hopeful.

## Adding another app

1. Drop its `src/` under `src/apps/<name>/`.
2. Add a `<Name>App.tsx` that renders the app without a `SafeAreaProvider`,
   `StatusBar` or `NavigationContainer` of its own.
3. Add one entry to `src/hub/registry.ts`, and its id to the `AppId` union.
4. If it has hand-written native code, add a config plugin under `plugins/` and
   its sources under `modules/<name>/` — never a committed `android/`.

The grid, the search index, the category chips and the route table are all
derived from that entry. No other file changes.

## Native modules

`expo prebuild` regenerates `android/` and `ios/`, so nothing hand-written can
live there. Three config plugins re-apply the native halves on every prebuild:

- **`withBleChatNative.js`** — `BlePeripheral` (the GATT server half;
  `react-native-ble-plx` is central-only), `Presence` (the foreground service),
  `SecureStore` (Keystore-backed identity storage). It rewrites the sources'
  `com.blechat.MainActivity` / `com.blechat.R` imports to the hub's application
  id at copy time, so changing `android.package` in `app.json` cannot silently
  break the build.
- **`withEventPulseBle.js`** — `EventPulseBle`, plus the BLE manifest entries.
- **`withAttendanceNative.js`** — `BleAdvertiser` (the peripheral half, with the
  foreground service that keeps an advertisement on air) and `FileShare` (the
  FileProvider that hands one exported report to the share sheet). Rewrites
  `com.bleattendance.MainActivity` the same way, and owns the `neverForLocation`
  decision described below.

Both register their `ReactPackage`s through `plugins/addReactPackages.js`, which
knows the several shapes `MainApplication` has taken across Expo SDKs.

## Release builds

A fourth plugin, **`withReleaseHardening.js`**, carries the settings a Play
upload needs. They live in a plugin for the same reason the native sources do:
`android/` is regenerated, so an edit there survives exactly until the next
`expo prebuild --clean`.

- **Signing.** The generated project signs release builds with the *debug*
  keystore, which Play rejects. The plugin adds a `release` signing config fed
  from `android/keystore.properties` (gitignored — see
  `android-keystore.properties.example`) or from `ANDROID_KEYSTORE_*`
  environment variables for CI. With neither configured it falls back to debug
  signing and warns, so `expo run:android --variant release` keeps working
  locally.
- **R8 and resource shrinking**, both off by default in an Expo project. Keep
  rules for every native module in `modules/` are appended to
  `proguard-rules.pro`, because the bridge resolves modules by name and a
  stripped BLE adapter does not crash — it scans and finds nobody.
- **Cloud backup off.** The identity key and the at-rest key live in
  AsyncStorage, and Auto Backup would copy both to Google Drive. Device-to-device
  transfer is deliberately left on, so changing phones still carries attendance
  records and profiles across.

Unused sensitive permissions are stripped in `app.json` rather than here:
`CAMERA`, `RECORD_AUDIO`, `ACTIVITY_RECOGNITION` and `SYSTEM_ALERT_WINDOW` are
all listed under `android.blockedPermissions`. The last one is removed from the
release manifest only — the debug source set declares it at a higher merge
priority, so React Native's dev-menu overlay is unaffected.

Removing `CAMERA` also fixed a live bug. `react-native-image-picker` does not
need it, but its `isCameraPermissionFulfilled` refuses to launch the camera when
the app *declares* the permission without holding it — which is exactly what
expo-image-picker's manifest entry caused. Attendance's camera button works again
now that the declaration is gone.

Build the upload artifact with `cd android && ./gradlew bundleRelease`.

## Porting notes

Three SDKs became one (Expo 57 / React Native 0.86 / React 19). What that
actually required:

- `StyleSheet.absoluteFillObject` is gone in RN 0.86 — replaced with
  `StyleSheet.absoluteFill`, which is now the plain object it used to be. This
  was a real bug, not a type error: eight backdrops and scrims would have
  rendered non-absolute.
- `AsyncStorage.removeMany` (v3) → `multiRemove` (v2.2, the SDK 57 version).
- `ImagePicker.MediaTypeOptions.Images` → `mediaTypes: ['images']`.
- `ImageManipulator.manipulateAsync` → the contextual
  `manipulate` / `renderAsync` / `saveAsync` API.
- `react-native-get-random-values` is imported first in `index.ts`, before any
  module that generates an identifier.

Bringing Attendance and Treasure Hunt across (React Native 0.87 → 0.86) needed:

- **`neverForLocation` had to go, app-wide.** `react-native-ble-plx`'s *own*
  library manifest declares `BLUETOOTH_SCAN` with that flag, and the merger
  folds it in — setting `neverForLocation: false` on its plugin stops only the
  plugin's copy, so `tools:remove` in `withAttendanceNative.js` is what actually
  strips it. It had to go because the platform filters beacon-shaped
  advertisements out of scan results when it is set, and Attendance's employee
  advertisements are exactly that shape: the host would scan "successfully" and
  see nobody. One APK has one manifest, so the cost is paid by everyone —
  `ACCESS_FINE_LOCATION` is now held with no `maxSdkVersion`, and BLE Chat,
  EventPulse and Treasure Hunt each request it on API 31+. None of them reads a
  location; they simply can no longer prove that to the OS for free.
- **`buffer` is now a direct dependency.** `react-native-ble-peripheral-manager`
  does `import 'buffer'` without declaring it. Standalone it resolved to a copy
  the RN CLI toolchain happened to hoist; Expo's tree has no such accident.
- **`.gitignore` needed anchoring.** `android/` and `ios/` without a leading
  slash match a directory of that name at *any* depth, which silently excluded
  `modules/*/android` and `modules/*/ios` — the reason the plugins' native
  sources are missing from this repo's history. Now `/android/` and `/ios/`.
- RN 0.86 types are stricter than 0.87's in three places: a percentage built
  with `.toFixed()` or a template literal needs `as DimensionValue`, `Image` no
  longer lists `pointerEvents` in `ImageProps`, and `ScrollView`'s
  `refreshControl` wants a `ReactElement<RefreshControlProps>` rather than a
  bare `ReactElement`. All four were type-level only; no behaviour changed.
- Attendance's teardown effect stopped both radios and destroyed the BLE
  manager. That was right when only process death unmounted it, and wrong in a
  hub where Back unmounts it — see "Cheap to leave" above.
