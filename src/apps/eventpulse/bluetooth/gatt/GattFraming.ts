/**
 * Fragmentation and reassembly for the GATT link.
 *
 * PROVENANCE. The algorithm and the frame layout are adapted from
 * `src/apps/treasure-hunt/ble/Framer.ts`, which is proven in this same APK.
 * It is copied rather than imported for two reasons, both deliberate:
 *
 *   - Treasure Hunt's version reaches into `treasure-hunt/config/bleConfig.ts`
 *     for its limits and into `treasure-hunt/utils/logger` for output. Importing
 *     it would pull one app's game constants and star-topology service UUIDs
 *     into another app and couple their release cycles, which the hub's
 *     one-app-per-directory rule exists to prevent.
 *   - This version takes its group-id source by injection instead of seeding a
 *     module-level counter from `Math.random()`, so a test can assert exact
 *     bytes rather than only round-trips.
 *
 * The wire layout is unchanged from the original, so the two remain readable by
 * the same tooling.
 *
 * WHY FRAGMENTATION IS NOT OPTIONAL. A characteristic write or notification
 * carries at most `MTU - 3` bytes. Before negotiation succeeds that is 20 bytes
 * on Android — smaller than any profile card. Everything must work at 20 bytes
 * or it does not work on the first message of every Android link.
 *
 * Frame layout (little-endian):
 *
 *   offset  size  field
 *   ------  ----  ------------------------------------------------------------
 *        0     1  version (high nibble) | flags (low nibble)
 *        1     4  groupId    — ties the fragments of one message together
 *        5     2  fragIndex  — 0-based
 *        7     2  fragTotal  — fragments in this message
 *        9     n  payload chunk
 *
 * Fragments may arrive out of order and may be delivered twice; BLE stacks do
 * both. The reassembler tolerates both and drops a group that stalls.
 */

import {
  FRAME_HEADER_BYTES,
  MAX_MESSAGE_BYTES,
  REASSEMBLY_TIMEOUT_MS,
} from './GattProfile';

export const GATT_FRAME_VERSION = 1;

export const GattFrameFlags = {
  None: 0x0,
  /** Set on every fragment of a message that needed more than one frame. */
  Fragmented: 0x1,
} as const;

export interface ParsedGattFrame {
  version: number;
  flags: number;
  groupId: number;
  fragIndex: number;
  fragTotal: number;
  payload: Uint8Array;
}

export type GattFrameErrorCode =
  | 'too_short'
  | 'unsupported_version'
  | 'bad_fragment_total'
  | 'bad_fragment_index'
  | 'message_too_large'
  | 'bad_fragment_size';

export class GattFrameError extends Error {
  readonly code: GattFrameErrorCode;

  constructor(code: GattFrameErrorCode, message: string) {
    super(message);
    this.name = 'GattFrameError';
    this.code = code;
  }
}

/**
 * Hands out the id that ties one message's fragments together.
 *
 * Ids only have to be unique among the messages a single sender has in flight,
 * so a wrapping counter is enough. It is a class so tests can start from a
 * known value; production uses a fresh instance per transport.
 */
export class GroupIdSource {
  private next: number;

  constructor(seed = 0) {
    this.next = seed >>> 0;
  }

  allocate(): number {
    const id = this.next;
    this.next = (this.next + 1) >>> 0;
    return id;
  }
}

/**
 * Split a payload into wire frames.
 *
 * @param maxPayloadBytes usable bytes per frame AFTER the 9-byte header —
 *   i.e. `payloadBytesForMtu(mtu)`, not the MTU itself.
 */
export function fragmentMessage(
  payload: Uint8Array,
  maxPayloadBytes: number,
  groupIds: GroupIdSource,
): Uint8Array[] {
  if (!Number.isFinite(maxPayloadBytes) || maxPayloadBytes < 1) {
    throw new GattFrameError(
      'bad_fragment_size',
      `maxPayloadBytes must be a finite value >= 1, received ${maxPayloadBytes}`,
    );
  }
  if (payload.length > MAX_MESSAGE_BYTES) {
    throw new GattFrameError(
      'message_too_large',
      `message of ${payload.length} bytes exceeds the ${MAX_MESSAGE_BYTES}-byte cap`,
    );
  }

  const chunkSize = Math.floor(maxPayloadBytes);
  // An empty payload is still one frame: the far side must learn that a
  // zero-length message arrived, not that nothing did.
  const total = Math.max(1, Math.ceil(payload.length / chunkSize));
  if (total > 0xffff) {
    throw new GattFrameError(
      'bad_fragment_total',
      `message needs ${total} fragments, over the 65535 the header can express`,
    );
  }

  const groupId = groupIds.allocate();
  const flags = total > 1 ? GattFrameFlags.Fragmented : GattFrameFlags.None;
  const frames: Uint8Array[] = [];

  for (let index = 0; index < total; index++) {
    const start = index * chunkSize;
    const chunk = payload.subarray(start, Math.min(start + chunkSize, payload.length));
    const frame = new Uint8Array(FRAME_HEADER_BYTES + chunk.length);

    frame[0] = ((GATT_FRAME_VERSION & 0x0f) << 4) | (flags & 0x0f);
    frame[1] = groupId & 0xff;
    frame[2] = (groupId >>> 8) & 0xff;
    frame[3] = (groupId >>> 16) & 0xff;
    frame[4] = (groupId >>> 24) & 0xff;
    frame[5] = index & 0xff;
    frame[6] = (index >>> 8) & 0xff;
    frame[7] = total & 0xff;
    frame[8] = (total >>> 8) & 0xff;
    frame.set(chunk, FRAME_HEADER_BYTES);

    frames.push(frame);
  }

  return frames;
}

export function parseGattFrame(bytes: Uint8Array): ParsedGattFrame {
  if (bytes.length < FRAME_HEADER_BYTES) {
    throw new GattFrameError(
      'too_short',
      `frame of ${bytes.length} bytes is shorter than the ${FRAME_HEADER_BYTES}-byte header`,
    );
  }

  const b0 = bytes[0];
  const version = (b0 >>> 4) & 0x0f;
  const flags = b0 & 0x0f;

  if (version !== GATT_FRAME_VERSION) {
    // Dropped rather than guessed at, so a future layout change can never be
    // rendered as garbage by an older build.
    throw new GattFrameError(
      'unsupported_version',
      `frame version ${version} is not supported (this build speaks v${GATT_FRAME_VERSION})`,
    );
  }

  const groupId =
    (bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24)) >>> 0;
  const fragIndex = bytes[5] | (bytes[6] << 8);
  const fragTotal = bytes[7] | (bytes[8] << 8);

  if (fragTotal === 0) {
    throw new GattFrameError('bad_fragment_total', 'a fragTotal of 0 is not a message');
  }
  if (fragIndex >= fragTotal) {
    throw new GattFrameError(
      'bad_fragment_index',
      `fragIndex ${fragIndex} is out of range for a ${fragTotal}-fragment message`,
    );
  }

  return {
    version,
    flags,
    groupId,
    fragIndex,
    fragTotal,
    payload: bytes.subarray(FRAME_HEADER_BYTES),
  };
}

interface PendingGroup {
  fragTotal: number;
  received: Array<Uint8Array | undefined>;
  receivedCount: number;
  byteLength: number;
  startedAt: number;
}

/**
 * Rebuilds messages from incoming frames.
 *
 * ONE INSTANCE PER PEER. Group ids are unique only per sender, so feeding two
 * peers into one reassembler would let their messages collide and interleave.
 */
export class GattReassembler {
  private readonly groups = new Map<number, PendingGroup>();

  constructor(
    private readonly timeoutMs: number = REASSEMBLY_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Feed one received frame.
   *
   * @returns the complete payload when the last missing fragment lands,
   *   otherwise null. Throws `GattFrameError` for a frame that is not ours.
   */
  push(bytes: Uint8Array): Uint8Array | null {
    const frame = parseGattFrame(bytes);
    this.evictStale();

    // Single-fragment fast path: the overwhelming majority of messages, and it
    // needs no bookkeeping at all.
    if (frame.fragTotal === 1) {
      return Uint8Array.from(frame.payload);
    }

    let group = this.groups.get(frame.groupId);
    if (!group) {
      group = {
        fragTotal: frame.fragTotal,
        received: new Array<Uint8Array | undefined>(frame.fragTotal),
        receivedCount: 0,
        byteLength: 0,
        startedAt: this.now(),
      };
      this.groups.set(frame.groupId, group);
    }

    if (group.fragTotal !== frame.fragTotal) {
      // The id was reused with a different shape, so whatever we were holding
      // belongs to a message that will never complete. Start over on this frame.
      this.groups.delete(frame.groupId);
      return this.push(bytes);
    }

    // A duplicate. BLE stacks re-deliver; accepting it twice would corrupt the
    // byte count and produce a short message.
    if (group.received[frame.fragIndex] !== undefined) {
      return null;
    }

    const chunk = Uint8Array.from(frame.payload);
    group.received[frame.fragIndex] = chunk;
    group.receivedCount++;
    group.byteLength += chunk.length;

    if (group.byteLength > MAX_MESSAGE_BYTES) {
      this.groups.delete(frame.groupId);
      return null;
    }

    if (group.receivedCount < group.fragTotal) {
      return null;
    }

    const out = new Uint8Array(group.byteLength);
    let offset = 0;
    for (let i = 0; i < group.fragTotal; i++) {
      const part = group.received[i];
      if (!part) {
        // Unreachable once receivedCount === fragTotal, but a hole here would
        // hand the caller a silently corrupt message, so refuse instead.
        this.groups.delete(frame.groupId);
        return null;
      }
      out.set(part, offset);
      offset += part.length;
    }

    this.groups.delete(frame.groupId);
    return out;
  }

  /** Drop groups that stopped making progress, so a half-message cannot pin memory. */
  private evictStale(): void {
    if (this.groups.size === 0) return;
    const cutoff = this.now() - this.timeoutMs;
    for (const [groupId, group] of this.groups) {
      if (group.startedAt < cutoff) this.groups.delete(groupId);
    }
  }

  /** Partially received messages currently held. */
  get pendingCount(): number {
    return this.groups.size;
  }

  reset(): void {
    this.groups.clear();
  }
}
