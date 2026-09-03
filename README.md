# App Hub

One Expo app that launches three existing apps from a single home screen.

```bash
npm install
npm run android
```

`npm run android` is `expo run:android`: it prebuilds the native project from
`app.json` + the plugins in `plugins/`, compiles it, and installs it on a
connected device or running emulator. The first run takes a while (NDK, CMake);
after that it is incremental.

Everything here needs a **development build**. There is no Expo Go path — three
native modules and `react-native-ble-plx` are not in the Go client.

## What is inside

| App | What it is | Where it came from |
| --- | --- | --- |
| **BLE Chat** | Encrypted peer-to-peer chat over Bluetooth Low Energy | `test/BleChat` |
| **EventPulse** | Live proximity radar for conferences and meetups | `networking app/mobile` |
| **Higher or Lower** | Number-guessing race, solo / daily / multiplayer | `guess the number/mobile` |

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

## How the three apps share one shell

**One navigation container.** React Navigation allows exactly one per tree, so
the hub owns it and each app contributes a *nested* navigator underneath. Each
app's own `NavigationContainer` was replaced with React Navigation's
`ThemeProvider`, which is the supported way to give a subtree its own colours
without a second container. Android's back button then works for free: the
innermost navigator handles it until nothing is left to pop, at which point the
root stack returns to the hub.

**One safe-area provider.** `AppFrame` renders the "‹ App Hub" strip in the band
under the status bar, then hands the subtree a top inset of `0` via
`SafeAreaInsetsContext`. Without that override every screen in all three apps
would pad past a strip that had already consumed that space.

**Lazy apps.** Registry entries hold `lazy(() => import(...))`, so opening the
hub does not pull in a BLE stack, a positioning engine and an audio bank.

**Cheap to leave.** Closing an app back to the hub drops BLE Chat to its saver
scan duty cycle, moves EventPulse's scanner to its `background` phase, and frees
Higher or Lower's audio players. BLE Chat's radio deliberately keeps running:
a BLE message exists only while both radios are on, so a missed one is missed
permanently — which is what the foreground service is for.

**No key collisions.** The three storage namespaces (`@blechat/`, `eventpulse:`,
`hol.`) were already disjoint, so nothing had to be renamed.

## Adding a fourth app

1. Drop its `src/` under `src/apps/<name>/`.
2. Add a `<Name>App.tsx` that renders the app without a `SafeAreaProvider`,
   `StatusBar` or `NavigationContainer` of its own.
3. Add one entry to `src/hub/registry.ts`.

The grid, the search index, the category chips and the route table are all
derived from that entry. No other file changes.

## Native modules

`expo prebuild` regenerates `android/` and `ios/`, so nothing hand-written can
live there. Two config plugins re-apply the native halves on every prebuild:

- **`withBleChatNative.js`** — `BlePeripheral` (the GATT server half;
  `react-native-ble-plx` is central-only), `Presence` (the foreground service),
  `SecureStore` (Keystore-backed identity storage). It rewrites the sources'
  `com.blechat.MainActivity` / `com.blechat.R` imports to the hub's application
  id at copy time, so changing `android.package` in `app.json` cannot silently
  break the build.
- **`withEventPulseBle.js`** — `EventPulseBle`, plus the BLE manifest entries.

Both register their `ReactPackage`s through `plugins/addReactPackages.js`, which
knows the several shapes `MainApplication` has taken across Expo SDKs.

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
