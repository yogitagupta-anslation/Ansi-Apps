/**
 * Per-link and per-session measurements.
 *
 * Every number here is recorded from something that actually happened: a byte handed to
 * the BLE stack, a packet decoded, an ACK matched to its send timestamp. Nothing is
 * modelled, estimated or smoothed into existence — which is the whole point, because a
 * quality score derived from invented inputs is worse than no score.
 */

/** Bounded sample window, so a long session cannot grow memory without limit. */
const SAMPLE_WINDOW = 50;

class Samples {
  private values: number[] = [];

  add(value: number): void {
    this.values.push(value);
    if (this.values.length > SAMPLE_WINDOW) {
      this.values.shift();
    }
  }

  get count(): number {
    return this.values.length;
  }

  get average(): number | null {
    if (this.values.length === 0) {
      return null;
    }
    let total = 0;
    for (const v of this.values) {
      total += v;
    }
    return total / this.values.length;
  }

  get latest(): number | null {
    return this.values.length > 0 ? this.values[this.values.length - 1] : null;
  }

  get worst(): number | null {
    if (this.values.length === 0) {
      return null;
    }
    return Math.max(...this.values);
  }

  snapshot(): number[] {
    return [...this.values];
  }
}

export interface LinkMetricsSnapshot {
  /** Wall-clock ms the link has been up in its current session, or 0 when down. */
  currentUptimeMs: number;
  /** Cumulative connected time across all sessions with this peer. */
  totalUptimeMs: number;
  connects: number;
  disconnects: number;

  packetsTx: number;
  packetsRx: number;
  bytesTx: number;
  bytesRx: number;
  framesTx: number;
  framesRx: number;

  acksReceived: number;
  /** Sends that were never acknowledged within the timeout. */
  acksMissed: number;
  /** Mean round trip from handing a packet to the transport to its ACK arriving. */
  avgAckLatencyMs: number | null;
  worstAckLatencyMs: number | null;

  avgRssi: number | null;
  latestRssi: number | null;
  mtu: number;

  sendFailures: number;
  /** Fraction of sends that were never acknowledged, 0..1. */
  lossRate: number;
  /** Derived 0..100. Null until there is enough evidence to justify a number. */
  quality: number | null;
}

export class LinkMetrics {
  private connectedAt: number | null = null;
  private totalUptimeMs = 0;
  private connects = 0;
  private disconnects = 0;

  private packetsTx = 0;
  private packetsRx = 0;
  private bytesTx = 0;
  private bytesRx = 0;
  private framesTx = 0;
  private framesRx = 0;

  private acksReceived = 0;
  private acksMissed = 0;
  private sendFailures = 0;

  private ackLatency = new Samples();
  private rssi = new Samples();
  private mtu = 23;

  markConnected(now = Date.now()): void {
    if (this.connectedAt !== null) {
      return;
    }
    this.connectedAt = now;
    this.connects += 1;
  }

  markDisconnected(now = Date.now()): void {
    if (this.connectedAt === null) {
      return;
    }
    this.totalUptimeMs += now - this.connectedAt;
    this.connectedAt = null;
    this.disconnects += 1;
  }

  get isConnected(): boolean {
    return this.connectedAt !== null;
  }

  recordTxPacket(bytes: number): void {
    this.packetsTx += 1;
    this.bytesTx += bytes;
  }

  recordRxPacket(bytes: number): void {
    this.packetsRx += 1;
    this.bytesRx += bytes;
  }

  recordTxFrame(bytes: number): void {
    this.framesTx += 1;
    this.bytesTx += bytes;
  }

  recordRxFrame(bytes: number): void {
    this.framesRx += 1;
    this.bytesRx += bytes;
  }

  recordSendFailure(): void {
    this.sendFailures += 1;
  }

  recordAck(latencyMs: number): void {
    this.acksReceived += 1;
    this.ackLatency.add(latencyMs);
  }

  recordAckTimeout(): void {
    this.acksMissed += 1;
  }

  recordRssi(value: number | null): void {
    if (value !== null) {
      this.rssi.add(value);
    }
  }

  setMtu(mtu: number): void {
    this.mtu = mtu;
  }

  snapshot(now = Date.now()): LinkMetricsSnapshot {
    const currentUptimeMs = this.connectedAt === null ? 0 : now - this.connectedAt;
    const attempted = this.acksReceived + this.acksMissed;
    const lossRate = attempted === 0 ? 0 : this.acksMissed / attempted;

    return {
      currentUptimeMs,
      totalUptimeMs: this.totalUptimeMs + currentUptimeMs,
      connects: this.connects,
      disconnects: this.disconnects,

      packetsTx: this.packetsTx,
      packetsRx: this.packetsRx,
      bytesTx: this.bytesTx,
      bytesRx: this.bytesRx,
      framesTx: this.framesTx,
      framesRx: this.framesRx,

      acksReceived: this.acksReceived,
      acksMissed: this.acksMissed,
      avgAckLatencyMs: this.ackLatency.average,
      worstAckLatencyMs: this.ackLatency.worst,

      avgRssi: this.rssi.average,
      latestRssi: this.rssi.latest,
      mtu: this.mtu,

      sendFailures: this.sendFailures,
      lossRate,
      quality: computeQuality({
        lossRate,
        attempted,
        avgAckLatencyMs: this.ackLatency.average,
        avgRssi: this.rssi.average,
        disconnects: this.disconnects,
        mtu: this.mtu,
      }),
    };
  }
}

export interface QualityInputs {
  lossRate: number;
  /** Number of acknowledged-or-timed-out sends. Below a floor, no score is produced. */
  attempted: number;
  avgAckLatencyMs: number | null;
  avgRssi: number | null;
  disconnects: number;
  mtu: number;
}

/**
 * A word for a 0-100 score.
 *
 * "Connected" alone does not distinguish a link carrying messages instantly from one
 * limping along at the edge of range, and the second is what the user needs to know about
 * before wondering why a message is slow.
 */
export function qualityLabel(score: number | null): string | null {
  if (score === null) {
    return null;
  }
  if (score >= 80) {
    return 'Excellent';
  }
  if (score >= 60) {
    return 'Good';
  }
  if (score >= 40) {
    return 'Fair';
  }
  return 'Poor';
}

/** Below this many measured round trips, any score would be noise. */
export const MIN_SAMPLES_FOR_QUALITY = 3;

/**
 * A 0..100 score derived only from measured values.
 *
 * Returns null rather than a confident-looking number when there is not enough evidence.
 * The weighting is deliberately simple and documented so the figure can be argued with:
 *
 *   50%  delivery      fraction of sends that were acknowledged
 *   20%  latency       ACK round trip, 100ms or better scores full marks, 1s scores zero
 *   15%  signal        -55 dBm or better full marks, -95 dBm zero
 *   10%  stability     penalised per disconnect
 *    5%  throughput    negotiated MTU relative to the 517 ceiling
 */
export function computeQuality(inputs: QualityInputs): number | null {
  if (inputs.attempted < MIN_SAMPLES_FOR_QUALITY) {
    return null;
  }

  const delivery = 1 - clamp01(inputs.lossRate);

  const latency =
    inputs.avgAckLatencyMs === null
      ? 1
      : 1 - clamp01((inputs.avgAckLatencyMs - 100) / 900);

  const signal =
    inputs.avgRssi === null ? 1 : 1 - clamp01((-inputs.avgRssi - 55) / 40);

  const stability = 1 - clamp01(inputs.disconnects / 5);

  const throughput = clamp01((inputs.mtu - 23) / (517 - 23));

  const score =
    delivery * 50 + latency * 20 + signal * 15 + stability * 10 + throughput * 5;

  return Math.round(clamp01(score / 100) * 100);
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) {
    return 0;
  }
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Session-wide totals for the dashboard. */
export class SessionMetrics {
  readonly startedAt = Date.now();
  messagesSent = 0;
  messagesReceived = 0;
  bytesTx = 0;
  bytesRx = 0;
  reconnects = 0;

  private ackLatency = new Samples();
  private rssi = new Samples();

  recordAck(latencyMs: number): void {
    this.ackLatency.add(latencyMs);
  }

  recordRssi(value: number | null): void {
    if (value !== null) {
      this.rssi.add(value);
    }
  }

  snapshot(now = Date.now()) {
    return {
      durationMs: now - this.startedAt,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      bytesTx: this.bytesTx,
      bytesRx: this.bytesRx,
      reconnects: this.reconnects,
      avgAckLatencyMs: this.ackLatency.average,
      avgRssi: this.rssi.average,
    };
  }
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  return `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
