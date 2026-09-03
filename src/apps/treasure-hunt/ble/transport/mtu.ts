/**
 * Platform-specific MTU defaults.
 *
 * Kept out of config/bleConfig.ts so that module stays free of react-native
 * imports and can be unit-tested in plain Node.
 */
import {Platform} from 'react-native';
import {ATT_DEFAULT_MTU, IOS_ASSUMED_MTU} from '../../config/bleConfig';

/**
 * MTU to assume before the real one is known.
 *
 * iOS negotiates automatically and settles around 185 bytes. Android starts at
 * the 23-byte BLE minimum until requestMTU succeeds, so we must assume the
 * worst there or the first messages would be silently truncated.
 */
export function initialAssumedMtu(): number {
  return Platform.OS === 'ios' ? IOS_ASSUMED_MTU : ATT_DEFAULT_MTU;
}
