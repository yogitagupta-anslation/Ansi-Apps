import {
  NACK_MAX_ROUNDS,
  NACK_QUIET_MS,
  RETRANSMIT_BUFFER_MS,
} from '../config/constants';
import {
  buildNack,
  fragment,
  parseFrame,
  Reassembler,
  StreamIdGenerator,
} from './Fragmentation';
import {logger} from '../utils/logger';

const TAG = 'Link';

/**
 * One link's fragmentation, reassembly and retransmission.
 *
 * Extracted so the BLE transport and the in-memory test transport share the SAME ARQ
 * implementation. Retransmission logic that differs between what ships and what is
 * tested is worse than no tests at all.
 *
 * Recovery is selective, not whole-message: at a 23-byte MTU a long message is 60+
 * frames, and losing one at the edge of range should cost one frame, not all sixty.
 *
 *   sender                                   receiver
 *   ------                                   --------
 *   DATA 0..59  ------------------------->   57 arrive, 3 lost
 *                                            (quiet period elapses)
 *          <---------------- NACK [12,31,48]
 *   DATA 12,31,48 ----------------------->   complete, delivered up
 */
export interface FragmentSink {
  /** Hand one MTU-sized frame to the underlying transport. */
  sendFrame(frame: Uint8Array): Promise<void>;
  /** Current usable ATT MTU for this link. */
  currentMtu(): number;
}

interface SentStream {
  frames: Uint8Array[];
  sentAt: number;
}

export class FragmentedLink {
  private reassembler: Reassembler;
  private streamIds = new StreamIdGenerator();
  /** Serialises outbound frames so fragment order is preserved. */
  private sendChain: Promise<void> = Promise.resolve();
  /** Recently sent streams, retained so a NACK can be answered. */
  private sent = new Map<number, SentStream>();

  constructor(
    private readonly label: string,
    private readonly sink: FragmentSink,
  ) {
    this.reassembler = new Reassembler(label);
  }

  // ---- outbound ---------------------------------------------------------

  async send(
    payload: Uint8Array,
    /** Fires after each fragment actually reaches the sink, not on a timer. */
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const streamId = this.streamIds.take();
    const frames = fragment(payload, this.sink.currentMtu(), streamId);

    // Retained so missing frames can be resent without the caller re-encoding.
    this.sent.set(streamId, {frames, sentAt: Date.now()});
    this.pruneSent();

    const task = this.sendChain.then(async () => {
      for (let i = 0; i < frames.length; i++) {
        await this.sink.sendFrame(frames[i]);
        onProgress?.(i + 1, frames.length);
      }
    });
    // Keep the chain alive on failure, otherwise one error wedges the link.
    this.sendChain = task.catch(() => undefined);
    await task;
  }

  private pruneSent(now = Date.now()): void {
    for (const [id, stream] of this.sent) {
      if (now - stream.sentAt > RETRANSMIT_BUFFER_MS) {
        this.sent.delete(id);
      }
    }
  }

  // ---- inbound ----------------------------------------------------------

  /**
   * Feed one received frame.
   *
   * Returns a completed payload, or null. A NACK frame is handled internally and never
   * surfaces to the caller — it is link machinery, not application data.
   */
  receive(frame: Uint8Array): Uint8Array | null {
    const parsed = parseFrame(frame);
    if (!parsed) {
      return null;
    }

    if (parsed.kind === 'nack') {
      void this.handleNack(parsed.streamId, parsed.missing);
      return null;
    }

    return this.reassembler.push(frame);
  }

  private async handleNack(streamId: number, missing: number[]): Promise<void> {
    const stream = this.sent.get(streamId);
    if (!stream) {
      // Already expired from the retransmit buffer. The application-level ACK timeout
      // is the backstop; nothing useful can be done here.
      logger.warn(
        TAG,
        `${this.label}: NACK for expired stream ${streamId}, cannot retransmit`,
      );
      return;
    }

    const valid = missing.filter(i => i >= 0 && i < stream.frames.length);
    if (valid.length === 0) {
      return;
    }
    logger.info(
      TAG,
      `${this.label}: retransmitting ${valid.length} frame(s) of stream ${streamId}`,
    );

    const task = this.sendChain.then(async () => {
      for (const index of valid) {
        await this.sink.sendFrame(stream.frames[index]);
      }
    });
    this.sendChain = task.catch(() => undefined);
    await task;
  }

  /**
   * Ask for anything still missing.
   *
   * Called on a timer by the transport. Only streams that have been quiet for
   * NACK_QUIET_MS are chased, so a NACK is never raced against frames still in flight.
   */
  requestMissing(now = Date.now()): void {
    const stale = this.reassembler.incompleteStreams(NACK_QUIET_MS, now);
    for (const entry of stale) {
      if (entry.rounds >= NACK_MAX_ROUNDS) {
        logger.warn(
          TAG,
          `${this.label}: stream ${entry.streamId} unrecovered after ` +
            `${NACK_MAX_ROUNDS} attempts, giving up`,
        );
        this.reassembler.drop(entry.streamId);
        continue;
      }

      logger.info(
        TAG,
        `${this.label}: requesting ${entry.missing.length} missing frame(s) of ` +
          `stream ${entry.streamId} (attempt ${entry.rounds + 1})`,
      );
      this.reassembler.markNackSent(entry.streamId, now);

      const nack = buildNack(entry.streamId, entry.count, entry.missing);
      const task = this.sendChain.then(() => this.sink.sendFrame(nack));
      this.sendChain = task.catch(() => undefined);
    }
  }

  get pendingStreams(): number {
    return this.reassembler.pendingStreams;
  }

  reset(): void {
    this.reassembler.reset();
    this.sent.clear();
  }
}
