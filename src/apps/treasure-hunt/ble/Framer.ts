/**
 * BLE fragmentation and reassembly.
 *
 * A BLE characteristic write or notification carries at most (MTU - 3) bytes.
 * At the un-negotiated default MTU of 23 that is 20 bytes -- far less than a
 * JSON game message. Every payload is therefore split into fragments, each with
 * a 9-byte header, and rebuilt on the far side.
 *
 * Frame layout (little-endian):
 *
 *   offset  size  field
 *   ------  ----  ----------------------------------------------------------
 *        0     1  version (high nibble) | flags (low nibble)
 *        1     4  groupId   -- ties fragments of one message together
 *        5     2  fragIndex -- 0-based
 *        7     2  fragTotal -- total fragments in this message
 *        9     n  payload chunk
 *
 * Fragments may arrive out of order or be duplicated; the reassembler tolerates
 * both. A group that stalls part-way is dropped after REASSEMBLY_TIMEOUT_MS so
 * a half-delivered message cannot pin memory forever.
 */
import {
  FRAME_HEADER_BYTES,
  MAX_MESSAGE_BYTES,
  REASSEMBLY_TIMEOUT_MS,
} from '../config/bleConfig';
import {createLogger} from '../utils/logger';

const log = createLogger('Framer');

export const FRAME_VERSION = 1;

export const FrameFlags = {
  None: 0x0,
  /** Set on every fragment of a message that needed more than one frame. */
  Fragmented: 0x1,
} as const;

export interface ParsedFrame {
  version: number;
  flags: number;
  groupId: number;
  fragIndex: number;
  fragTotal: number;
  payload: Uint8Array;
}

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

let nextGroupId = Math.floor(Math.random() * 0xffffffff) >>> 0;

function allocateGroupId(): number {
  nextGroupId = (nextGroupId + 1) >>> 0;
  return nextGroupId;
}

/**
 * Split a payload into wire frames.
 * @param maxPayloadBytes usable bytes per frame AFTER the 9-byte frame header.
 */
export function fragment(payload: Uint8Array, maxPayloadBytes: number): Uint8Array[] {
  if (maxPayloadBytes < 1) {
    throw new FrameError(`maxPayloadBytes must be >= 1, got ${maxPayloadBytes}`);
  }
  if (payload.length > MAX_MESSAGE_BYTES) {
    throw new FrameError(
      `message of ${payload.length} bytes exceeds the ${MAX_MESSAGE_BYTES}-byte cap`,
    );
  }

  const total = Math.max(1, Math.ceil(payload.length / maxPayloadBytes));
  if (total > 0xffff) {
    throw new FrameError(`message needs ${total} fragments, exceeding the 65535 limit`);
  }

  const groupId = allocateGroupId();
  const flags = total > 1 ? FrameFlags.Fragmented : FrameFlags.None;
  const frames: Uint8Array[] = [];

  for (let index = 0; index < total; index++) {
    const start = index * maxPayloadBytes;
    const chunk = payload.subarray(start, Math.min(start + maxPayloadBytes, payload.length));
    const frame = new Uint8Array(FRAME_HEADER_BYTES + chunk.length);

    frame[0] = ((FRAME_VERSION & 0x0f) << 4) | (flags & 0x0f);
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

export function parseFrame(bytes: Uint8Array): ParsedFrame {
  if (bytes.length < FRAME_HEADER_BYTES) {
    throw new FrameError(`frame of ${bytes.length} bytes is shorter than the header`);
  }

  const b0 = bytes[0] as number;
  const version = (b0 >>> 4) & 0x0f;
  const flags = b0 & 0x0f;

  if (version !== FRAME_VERSION) {
    throw new FrameError(`unsupported frame version ${version}`);
  }

  const groupId =
    ((bytes[1] as number) |
      ((bytes[2] as number) << 8) |
      ((bytes[3] as number) << 16) |
      ((bytes[4] as number) << 24)) >>>
    0;
  const fragIndex = (bytes[5] as number) | ((bytes[6] as number) << 8);
  const fragTotal = (bytes[7] as number) | ((bytes[8] as number) << 8);

  if (fragTotal === 0) {
    throw new FrameError('fragTotal of 0 is invalid');
  }
  if (fragIndex >= fragTotal) {
    throw new FrameError(`fragIndex ${fragIndex} out of range for total ${fragTotal}`);
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
 * One instance per peer -- group ids are only unique per sender, so mixing two
 * peers into a single reassembler would collide.
 */
export class Reassembler {
  private readonly groups = new Map<number, PendingGroup>();

  constructor(
    private readonly timeoutMs: number = REASSEMBLY_TIMEOUT_MS,
    private readonly nowFn: () => number = Date.now,
  ) {}

  /**
   * Feed one received frame.
   * @returns the complete payload once the final missing fragment arrives,
   *          otherwise null.
   */
  push(bytes: Uint8Array): Uint8Array | null {
    const frame = parseFrame(bytes);
    this.evictStale();

    // Single-fragment fast path: no bookkeeping needed.
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
        startedAt: this.nowFn(),
      };
      this.groups.set(frame.groupId, group);
    }

    if (group.fragTotal !== frame.fragTotal) {
      // A group id was reused with a different shape; the old one is garbage.
      log.warn(`group ${frame.groupId} changed fragTotal, restarting reassembly`);
      this.groups.delete(frame.groupId);
      return this.push(bytes);
    }

    // Duplicate fragment -- BLE stacks do re-deliver. Ignore it.
    if (group.received[frame.fragIndex] !== undefined) {
      return null;
    }

    const chunk = Uint8Array.from(frame.payload);
    group.received[frame.fragIndex] = chunk;
    group.receivedCount++;
    group.byteLength += chunk.length;

    if (group.byteLength > MAX_MESSAGE_BYTES) {
      log.warn(`group ${frame.groupId} exceeded the size cap; discarding`);
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
        // Cannot happen once receivedCount === fragTotal, but stay defensive.
        log.error(`group ${frame.groupId} completed with a hole at ${i}`);
        this.groups.delete(frame.groupId);
        return null;
      }
      out.set(part, offset);
      offset += part.length;
    }

    this.groups.delete(frame.groupId);
    return out;
  }

  /** Drop groups that stopped receiving fragments. */
  private evictStale(): void {
    if (this.groups.size === 0) {
      return;
    }
    const cutoff = this.nowFn() - this.timeoutMs;
    for (const [groupId, group] of this.groups) {
      if (group.startedAt < cutoff) {
        log.warn(
          `dropping stalled group ${groupId} (${group.receivedCount}/${group.fragTotal} fragments)`,
        );
        this.groups.delete(groupId);
      }
    }
  }

  /** Number of partially received messages currently held. */
  get pendingCount(): number {
    return this.groups.size;
  }

  reset(): void {
    this.groups.clear();
  }
}
