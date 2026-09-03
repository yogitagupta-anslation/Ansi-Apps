import {
  ATT_HEADER_SIZE,
  FRAGMENT_HEADER_SIZE,
  FRAGMENT_MAGIC,
  FRAME_TYPE_DATA,
  FRAME_TYPE_NACK,
  MAX_CONCURRENT_STREAMS,
  MAX_FRAGMENTS_PER_STREAM,
  MAX_REASSEMBLY_BYTES,
  REASSEMBLY_TIMEOUT_MS,
} from '../config/constants';
import {logger} from '../utils/logger';

const TAG = 'Fragment';
/**
 * v2 added the frame-type byte that makes selective retransmission possible.
 * A v1 peer is rejected rather than silently misparsed.
 */
const FRAGMENT_VERSION = 0x02;
const MAX_FRAGMENTS = 0xffff;

/**
 * One BLE write is NOT one chat message. ATT limits a single write/notification to
 * (MTU - 3) bytes, which is 20 bytes before MTU negotiation. Every payload is therefore
 * framed as:
 *
 *   byte  0      magic 0xB1
 *   byte  1      fragment-protocol version
 *   byte  2      frame type: 0 = DATA, 1 = NACK
 *   bytes 3..6   streamId   (uint32 BE)  - groups fragments of one payload
 *   bytes 7..8   fragIndex  (uint16 BE)
 *   bytes 9..10  fragCount  (uint16 BE)
 *   bytes 11..   DATA: payload slice
 *                NACK: missing indices, uint16 BE each
 *
 * fragCount is explicit rather than a "last fragment" flag so the receiver can size
 * its buffer up front and detect a truncated stream.
 */

export function usableChunkSize(mtu: number): number {
  const size = mtu - ATT_HEADER_SIZE - FRAGMENT_HEADER_SIZE;
  // Guard against a nonsense MTU report leaving us with a non-positive chunk size.
  return Math.max(1, size);
}

export function fragment(payload: Uint8Array, mtu: number, streamId: number): Uint8Array[] {
  const chunkSize = usableChunkSize(mtu);
  const count = Math.max(1, Math.ceil(payload.length / chunkSize));

  if (count > MAX_FRAGMENTS) {
    throw new Error(
      `payload of ${payload.length} bytes needs ${count} fragments, max is ${MAX_FRAGMENTS}`,
    );
  }

  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const slice = payload.subarray(i * chunkSize, (i + 1) * chunkSize);
    const frame = new Uint8Array(FRAGMENT_HEADER_SIZE + slice.length);
    writeHeader(frame, FRAME_TYPE_DATA, streamId, i, count);
    frame.set(slice, FRAGMENT_HEADER_SIZE);
    frames.push(frame);
  }
  return frames;
}

function writeHeader(
  frame: Uint8Array,
  type: number,
  streamId: number,
  index: number,
  count: number,
): void {
  frame[0] = FRAGMENT_MAGIC;
  frame[1] = FRAGMENT_VERSION;
  frame[2] = type;
  frame[3] = (streamId >>> 24) & 0xff;
  frame[4] = (streamId >>> 16) & 0xff;
  frame[5] = (streamId >>> 8) & 0xff;
  frame[6] = streamId & 0xff;
  frame[7] = (index >>> 8) & 0xff;
  frame[8] = index & 0xff;
  frame[9] = (count >>> 8) & 0xff;
  frame[10] = count & 0xff;
}

/** A request to resend specific fragments of a stream. */
export function buildNack(
  streamId: number,
  count: number,
  missing: number[],
): Uint8Array {
  const frame = new Uint8Array(FRAGMENT_HEADER_SIZE + missing.length * 2);
  writeHeader(frame, FRAME_TYPE_NACK, streamId, 0, count);
  missing.forEach((index, i) => {
    frame[FRAGMENT_HEADER_SIZE + i * 2] = (index >>> 8) & 0xff;
    frame[FRAGMENT_HEADER_SIZE + i * 2 + 1] = index & 0xff;
  });
  return frame;
}

export type ParsedFrame =
  | {kind: 'data'; streamId: number; index: number; count: number}
  | {kind: 'nack'; streamId: number; count: number; missing: number[]};

/** Validate and classify a frame. Returns null for anything malformed. */
export function parseFrame(frame: Uint8Array): ParsedFrame | null {
  if (frame.length < FRAGMENT_HEADER_SIZE) {
    return null;
  }
  if (frame[0] !== FRAGMENT_MAGIC || frame[1] !== FRAGMENT_VERSION) {
    return null;
  }

  const streamId =
    ((frame[3] << 24) | (frame[4] << 16) | (frame[5] << 8) | frame[6]) >>> 0;
  const index = (frame[7] << 8) | frame[8];
  const count = (frame[9] << 8) | frame[10];

  if (frame[2] === FRAME_TYPE_NACK) {
    const missing: number[] = [];
    for (let i = FRAGMENT_HEADER_SIZE; i + 1 < frame.length; i += 2) {
      missing.push((frame[i] << 8) | frame[i + 1]);
    }
    return {kind: 'nack', streamId, count, missing};
  }
  if (frame[2] !== FRAME_TYPE_DATA) {
    return null;
  }
  return {kind: 'data', streamId, index, count};
}

interface PartialStream {
  count: number;
  /**
   * Sparse by index.
   *
   * A Map rather than a pre-sized Array: memory grows with fragments we have actually
   * RECEIVED, not with the count a peer claims. A hostile `fragCount` therefore costs
   * nothing until the fragments genuinely arrive.
   */
  parts: Map<number, Uint8Array>;
  startedAt: number;
  bytes: number;
  /** Last time a fragment for this stream arrived. */
  lastFragmentAt: number;
  /** How many times we have asked for the missing pieces. */
  nackRounds: number;
}

/** One instance per inbound link — stream ids are only unique per sender. */
export class Reassembler {
  private streams = new Map<number, PartialStream>();

  constructor(private readonly linkLabel: string) {}

  /** Returns a complete payload, or null while fragments are still outstanding. */
  push(frame: Uint8Array): Uint8Array | null {
    const parsed = parseFrame(frame);
    if (!parsed) {
      logger.warn(TAG, `${this.linkLabel}: malformed frame, dropped`);
      return null;
    }
    if (parsed.kind !== 'data') {
      // Control frames are handled by FragmentedLink, not here.
      return null;
    }

    const {streamId, index, count} = parsed;
    const body = frame.subarray(FRAGMENT_HEADER_SIZE);

    if (count === 0 || index >= count) {
      logger.warn(TAG, `${this.linkLabel}: invalid index ${index}/${count}`);
      return null;
    }

    if (count > MAX_FRAGMENTS_PER_STREAM) {
      logger.warn(
        TAG,
        `${this.linkLabel}: declared ${count} fragments, cap is ` +
          `${MAX_FRAGMENTS_PER_STREAM} — dropped`,
      );
      return null;
    }

    this.expireStale();

    // Fast path: a single-fragment payload never needs buffering.
    if (count === 1) {
      return new Uint8Array(body);
    }

    let stream = this.streams.get(streamId);
    if (!stream) {
      if (this.streams.size >= MAX_CONCURRENT_STREAMS) {
        // One link cannot hold open an unbounded number of half-finished messages.
        // The oldest is sacrificed rather than letting the map grow.
        const oldest = this.oldestStreamId();
        if (oldest !== null) {
          logger.warn(
            TAG,
            `${this.linkLabel}: ${MAX_CONCURRENT_STREAMS} streams open, evicting ${oldest}`,
          );
          this.streams.delete(oldest);
        }
      }
      stream = {
        count,
        parts: new Map(),
        startedAt: Date.now(),
        bytes: 0,
        lastFragmentAt: Date.now(),
        nackRounds: 0,
      };
      this.streams.set(streamId, stream);
    }

    if (stream.count !== count) {
      logger.warn(
        TAG,
        `${this.linkLabel}: stream ${streamId} count changed ${stream.count}->${count}, resetting`,
      );
      this.streams.delete(streamId);
      return null;
    }

    if (stream.parts.has(index)) {
      // Duplicate fragment (BLE retransmission). Harmless — ignore it.
      return null;
    }

    if (stream.bytes + body.length > MAX_REASSEMBLY_BYTES) {
      logger.warn(
        TAG,
        `${this.linkLabel}: stream ${streamId} exceeded ${MAX_REASSEMBLY_BYTES}B, dropped`,
      );
      this.streams.delete(streamId);
      return null;
    }

    stream.parts.set(index, new Uint8Array(body));
    stream.bytes += body.length;
    stream.lastFragmentAt = Date.now();

    if (stream.parts.size < stream.count) {
      return null;
    }

    const out = new Uint8Array(stream.bytes);
    let offset = 0;
    for (let i = 0; i < stream.count; i++) {
      const part = stream.parts.get(i)!;
      out.set(part, offset);
      offset += part.length;
    }
    this.streams.delete(streamId);
    logger.debug(
      TAG,
      `${this.linkLabel}: reassembled ${out.length}B from ${count} fragments`,
    );
    return out;
  }

  private expireStale(): void {
    const now = Date.now();
    for (const [id, stream] of this.streams) {
      if (now - stream.startedAt > REASSEMBLY_TIMEOUT_MS) {
        logger.warn(
          TAG,
          `${this.linkLabel}: stream ${id} incomplete ` +
            `(${stream.parts.size}/${stream.count}), discarded`,
        );
        this.streams.delete(id);
      }
    }
  }

  /**
   * Streams that have gone quiet with pieces still missing.
   *
   * The quiet period matters: asking for fragments that are still in flight would
   * generate needless retransmissions and make congestion worse.
   */
  incompleteStreams(
    quietMs: number,
    now = Date.now(),
  ): Array<{streamId: number; count: number; missing: number[]; rounds: number}> {
    const out: Array<{
      streamId: number;
      count: number;
      missing: number[];
      rounds: number;
    }> = [];

    for (const [streamId, stream] of this.streams) {
      if (now - stream.lastFragmentAt < quietMs) {
        continue;
      }
      const missing: number[] = [];
      for (let i = 0; i < stream.count; i++) {
        if (!stream.parts.has(i)) {
          missing.push(i);
        }
      }
      if (missing.length > 0) {
        out.push({streamId, count: stream.count, missing, rounds: stream.nackRounds});
      }
    }
    return out;
  }

  markNackSent(streamId: number, now = Date.now()): void {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.nackRounds += 1;
      // Restart the quiet window so the next round waits for the retransmission.
      stream.lastFragmentAt = now;
    }
  }

  drop(streamId: number): void {
    this.streams.delete(streamId);
  }

  private oldestStreamId(): number | null {
    let oldestId: number | null = null;
    let oldestAt = Infinity;
    for (const [id, stream] of this.streams) {
      if (stream.startedAt < oldestAt) {
        oldestAt = stream.startedAt;
        oldestId = id;
      }
    }
    return oldestId;
  }

  reset(): void {
    this.streams.clear();
  }

  get pendingStreams(): number {
    return this.streams.size;
  }
}

/** Monotonic stream ids for outbound payloads on one link. */
export class StreamIdGenerator {
  private next = Math.floor(Date.now() % 0xffff);
  take(): number {
    this.next = (this.next + 1) >>> 0;
    return this.next;
  }
}
