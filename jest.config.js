/**
 * Test suites, one Jest project per app.
 *
 * The apps brought their own suites and their own assumptions, and merging those into a
 * single flat config is how a green run stops meaning anything. Projects keep them
 * isolated — a failure names the app it belongs to — while `npm test` still runs
 * everything in one pass.
 *
 * All three projects share jest.setup.js. Its stubs (AsyncStorage, the BLE adapter-state
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

/**
 * EventPulse is deliberately NOT built on `shared`.
 *
 * Every module its suite covers — the advertisement codec, the peer registry, the RSSI
 * filter, the scan policy, the match engine, the positioning maths, the privacy rules —
 * is plain TypeScript with no import of `react-native` or `expo` anywhere in its graph.
 * That is by design: `bluetooth/BleTransport.ts` is the seam precisely so the logic worth
 * testing sits above it. Verified by grep across all nineteen modules before this project
 * was added.
 *
 * So it needs neither the React Native preset nor `jest.setup.js`. Running it on the plain
 * node environment with no stubs at all means a passing test proves the real implementation
 * works, not that a mock does — and it keeps the two existing projects untouched: nothing
 * here can alter how blechat or attendance resolve modules, transform files, or set up
 * their globals.
 */
const eventpulse = {
  displayName: 'eventpulse',
  rootDir: __dirname,
  roots: ['<rootDir>/src/apps/eventpulse'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/support/'],
};

module.exports = {
  /**
   * Twenty seconds, not Jest's five.
   *
   * The component suites mount whole screens through react-test-renderer, and there are
   * now enough of them that several run at once on every worker the machine has. Measured
   * on this repo: each of the five heaviest .tsx suites reports 32-44s of wall clock in a
   * full parallel run and under 3s alone — the work is the same, the clock is not. At five
   * seconds a test, that difference is the whole margin, and the failures it produced were
   * timeouts on tests that pass every time in isolation.
   *
   * Raised rather than worked around with maxWorkers, which would trade a flaky suite for
   * a uniformly slow one. A genuinely hung test still fails, twenty seconds later.
   *
   * At the ROOT rather than inside `shared`: with `projects`, Jest takes this from the
   * global config and silently ignores a per-project copy — which is exactly what it did,
   * leaving every failure still reporting the 5000ms default.
   */
  testTimeout: 20_000,
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
    {
      ...shared,
      displayName: 'higherlower',
      roots: ['<rootDir>/src/apps/higherlower'],
    },
    {
      ...shared,
      displayName: 'hitch',
      roots: ['<rootDir>/src/apps/hitch'],
    },
    // Last, and shaped differently on purpose: see the note above its definition.
    eventpulse,
  ],
};
