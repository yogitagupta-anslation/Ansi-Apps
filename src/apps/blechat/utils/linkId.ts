import type {LinkId} from '../types/BLE';

/**
 * Link addressing, kept transport-neutral.
 *
 * A LinkId is namespaced by which role produced it:
 *   c:<remote device id>  - we are the CENTRAL, the remote is the peripheral
 *   p:<remote central id> - we are the PERIPHERAL, the remote dialled us
 *
 * These helpers live outside ble/ so that peers/ and messaging/ can reason about link
 * direction without importing the BLE implementation.
 */
export const CENTRAL_PREFIX = 'c:';
export const PERIPHERAL_PREFIX = 'p:';

/** True when WE opened the link, i.e. it is ours to re-dial after a drop. */
export function isCentralLink(linkId: LinkId): boolean {
  return linkId.startsWith(CENTRAL_PREFIX);
}

export function toCentralLinkId(deviceId: string): LinkId {
  return CENTRAL_PREFIX + deviceId;
}

export function toPeripheralLinkId(centralId: string): LinkId {
  return PERIPHERAL_PREFIX + centralId;
}

/** Strip the role prefix to recover the underlying transport address. */
export function stripPrefix(linkId: LinkId): string {
  return linkId.slice(2);
}
