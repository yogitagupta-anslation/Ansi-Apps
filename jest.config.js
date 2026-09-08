/**
 * Test suites, one Jest project per app.
 *
 * The apps brought their own suites and their own assumptions, and merging those into a
 * single flat config is how a green run stops meaning anything. Projects keep them
 * isolated — a failure names the app it belongs to — while `npm test` still runs
 * everything in one pass.
 *
 * Both projects share jest.setup.js. Its stubs (AsyncStorage, the BLE adapter-state
 * callback, a real CSPRNG) are environment plumbing, not behaviour: nothing in src/ ever
 * substitutes a fake for a real radio operation, and neither project tests one.
 *
 * The hub has no project here. Its suite tested the previous hub implementation, which
 * this merge replaced; rather than leave a suite pointing at deleted screens, it went with
 * them. The hub is untested until something covers the current one.
 */

const shared = {
  preset: 'react-native',
  rootDir: __dirname,
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Shared harness code, not test suites.
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/support/'],
  // `expo(nent)?` alone matches the `expo` package and nothing else, since the trailing
  // slash ends the alternative — so no `expo-*` module was ever on this allowlist. The
  // `(-[\w-]+)?` group widens it to cover them.
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
    },
    {
      ...shared,
      displayName: 'attendance',
      roots: ['<rootDir>/src/apps/attendance'],
    },
  ],
};
