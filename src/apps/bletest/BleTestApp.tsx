/**
 * Entry point for the isolated BLE GATT test.
 *
 * A development diagnostic, not a product. It is registered in the hub only
 * when `__DEV__` is true, so it cannot reach a release build.
 */

import React from 'react';

import { BleTestScreen } from './BleTestScreen';

export default function BleTestApp(): React.ReactElement {
  return <BleTestScreen />;
}
