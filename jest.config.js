/**
 * Two suites, kept apart on purpose.
 *
 * BLE Chat brought its own suite and its own set of stubs, built around a rule worth
 * preserving: nothing in that app ever substitutes a fake for a real radio operation. The
 * hub's tests need mocks of a completely different kind — an icon font, a font loader —
 * and folding those into BLE Chat's setup would quietly weaken the file that says it has
 * only the mocks it does.
 *
 * Higher or Lower is wired in the same way and for the same reason: its own project, its
 * own setup file, and a setup file that stubs nothing at all, because what it tests is the
 * bytes on the wire. The remaining app's suite is still not wired in here. Merging another
 * set of assumptions into one shared setup is how a green run stops meaning anything.
 */

const shared = {
  preset: 'react-native',
  rootDir: __dirname,
  // `expo(nent)?` alone matches the `expo` package and nothing else, since the trailing
  // slash ends the alternative — so no `expo-*` module was ever on this allowlist. Widened
  // to cover them. Note that it is not sufficient on its own: ESM packages under
  // node_modules are still reaching Jest untransformed in this checkout, which is why the
  // hub's setup stubs the native ones outright.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?(-[\\w-]+)?|@expo(nent)?/.*|@expo-google-fonts/.*|@react-navigation/.*|@react-native-vector-icons/.*|@noble)/)',
  ],
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'blechat',
      roots: ['<rootDir>/src/apps/blechat'],
      setupFiles: ['<rootDir>/jest.setup.js'],
      // Shared harness code, not test suites.
      testPathIgnorePatterns: ['/node_modules/', '/__tests__/support/'],
    },
    {
      ...shared,
      displayName: 'higherlower',
      roots: ['<rootDir>/src/apps/higherlower'],
      setupFiles: ['<rootDir>/jest.higherlower.setup.js'],
      testPathIgnorePatterns: ['/node_modules/'],
    },
    {
      ...shared,
      displayName: 'hub',
      roots: ['<rootDir>/src/hub'],
      setupFiles: ['<rootDir>/jest.hub.setup.js'],
      testPathIgnorePatterns: ['/node_modules/'],
    },
  ],
};
