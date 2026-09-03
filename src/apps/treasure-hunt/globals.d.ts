/**
 * Ambient declarations shared by the RN runtime and the plain-Node test runner.
 */
declare const __DEV__: boolean;

/** Image assets resolved by Metro. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
