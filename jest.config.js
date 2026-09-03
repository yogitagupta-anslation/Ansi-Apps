/**
 * BLE Chat's test suite, running inside the hub.
 *
 * Scoped to that app's folder: the other two apps brought their own suites and their own
 * runners, and merging three sets of assumptions into one config is how a green run
 * stops meaning anything.
 */
module.exports = {
  preset: 'react-native',
  roots: ['<rootDir>/src/apps/blechat'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Shared harness code, not test suites.
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/support/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|@noble)/)',
  ],
};
