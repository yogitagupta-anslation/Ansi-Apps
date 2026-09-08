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
 */

const shared = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Shared harness code, not test suites.
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/support/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|@noble)/)',
  ],
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'blechat',
      rootDir: __dirname,
      roots: ['<rootDir>/src/apps/blechat'],
    },
    {
      ...shared,
      displayName: 'attendance',
      rootDir: __dirname,
      roots: ['<rootDir>/src/apps/attendance'],
    },
  ],
};
