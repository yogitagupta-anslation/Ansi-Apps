/**
 * Stubs for the hub's own suite.
 *
 * All four exist because the real thing is a native asset rather than logic: an icon font
 * copied in by Gradle, two font families delivered as .ttf files, and a device store. None
 * of them stands in for behaviour the hub is responsible for — the screens, the filtering,
 * the permission reporting and the launch path all run for real.
 */

/* global globalThis */

// The Lucide font is bundled at build time and has no JS-test equivalent. Rendered as a
// Text carrying its own name so a test can still assert which icon a row chose.
jest.mock('@react-native-vector-icons/lucide/static', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Lucide: ({name}) => React.createElement(Text, {accessibilityLabel: `icon:${name}`}, name),
  };
});

// A gradient is a native view: under a test renderer there is no drawing surface and
// nothing to assert about it. It is stubbed as a plain View — which is also what gets
// past the fact that expo-linear-gradient ships ESM and is not being transformed here.
// Whether the fade actually renders is a question for a screen, not a test runner.
jest.mock('expo-linear-gradient', () => {
  const {View} = require('react-native');
  return {LinearGradient: View};
});

// expo-font resolves .ttf assets Metro would have bundled. Reporting "loaded" here is the
// state every hub screen renders in on a device a moment after launch.
jest.mock('expo-font', () => ({useFonts: () => [true, null]}));
jest.mock('@expo-google-fonts/space-grotesk', () => ({
  SpaceGrotesk_600SemiBold: 'SpaceGrotesk_600SemiBold',
  SpaceGrotesk_700Bold: 'SpaceGrotesk_700Bold',
}));
jest.mock('@expo-google-fonts/manrope', () => ({
  Manrope_500Medium: 'Manrope_500Medium',
  Manrope_600SemiBold: 'Manrope_600SemiBold',
  Manrope_700Bold: 'Manrope_700Bold',
  Manrope_800ExtraBold: 'Manrope_800ExtraBold',
}));

// Same store-on-globalThis reasoning as BLE Chat's: it has to survive jest.resetModules()
// so that "close the hub and reopen it" is something a test can actually express.
globalThis.__hubStorage = globalThis.__hubStorage ?? new Map();
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = globalThis.__hubStorage;
  return {
    __esModule: true,
    default: {
      getItem: async key => (store.has(key) ? store.get(key) : null),
      setItem: async (key, value) => {
        store.set(key, value);
      },
      removeItem: async key => {
        store.delete(key);
      },
    },
  };
});
