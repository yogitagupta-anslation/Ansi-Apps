/**
 * Version and capability negotiation, and the connection-quality score.
 *
 * The compatibility matrix is exactly the one from the roadmap:
 *   v1 <-> v1  ok      v1 <-> v2  compatibility mode      v1 <-> v3  refused
 */
import {
  agreeCapabilities,
  localCapabilities,
  negotiateVersion,
  parseCapabilities,
} from '../messaging/Negotiation';
import {
  computeQuality,
  LinkMetrics,
  MIN_SAMPLES_FOR_QUALITY,
  formatBytes,
  formatDuration,
} from '../peers/LinkMetrics';

describe('version negotiation', () => {
  it('v1 <-> v1 is an exact match', () => {
    const out = negotiateVersion({version: 1, min: 1}, {version: 1, min: 1});
    expect(out.verdict).toBe('exact');
    expect(out.agreed).toBe(1);
  });

  it('v1 <-> v2 drops to v1 in compatibility mode', () => {
    const out = negotiateVersion({version: 1, min: 1}, {version: 2, min: 1});
    expect(out.verdict).toBe('degraded');
    expect(out.agreed).toBe(1);
    expect(out.explanation).toContain('compatibility mode');
  });

  it('v1 <-> v3 is refused when v3 has dropped v1 support', () => {
    const out = negotiateVersion({version: 1, min: 1}, {version: 3, min: 3});
    expect(out.verdict).toBe('unsupported');
    expect(out.agreed).toBeNull();
  });

  it('refuses when OUR floor is above what the peer can speak', () => {
    // After we drop v1 support, an old peer must be told, not left to fail later.
    const out = negotiateVersion({version: 3, min: 3}, {version: 1, min: 1});
    expect(out.verdict).toBe('unsupported');
    expect(out.agreed).toBeNull();
  });

  it('always settles on the highest version both sides can speak', () => {
    const out = negotiateVersion({version: 4, min: 2}, {version: 3, min: 1});
    expect(out.agreed).toBe(3);
    expect(out.verdict).toBe('degraded');
  });
});

describe('capability negotiation', () => {
  it('agrees on the intersection, never the union', () => {
    const a = localCapabilities({relay: true, largeMtu: true});
    const b = {messaging: true, relay: false, encryption: true, largeMtu: true};

    const agreed = agreeCapabilities(a, b);
    expect(agreed.messaging).toBe(true);
    // One side cannot relay, so the link cannot.
    expect(agreed.relay).toBe(false);
    expect(agreed.largeMtu).toBe(true);
  });

  it('reports encryption, which is now implemented and mandatory', () => {
    const local = localCapabilities({relay: true, largeMtu: true});
    expect(local.encryption).toBe(true);
  });

  it('never claims encryption on a link where the peer does not have it', () => {
    const local = localCapabilities({relay: true, largeMtu: true});
    const remoteWithout = {
      messaging: true,
      relay: true,
      encryption: false,
      largeMtu: true,
    };
    // The intersection rule still holds, and still matters: reporting an encrypted link
    // because only our side can do it would be worse than reporting none. In practice
    // such a peer is refused at the handshake for having no ephemeral key — this is the
    // second line of defence, not the first.
    expect(agreeCapabilities(local, remoteWithout).encryption).toBe(false);
  });

  it('treats an older peer that only sent {relay} as still doing messaging', () => {
    const parsed = parseCapabilities({relay: true});
    expect(parsed.messaging).toBe(true);
    expect(parsed.relay).toBe(true);
    expect(parsed.encryption).toBe(false);
    expect(parsed.largeMtu).toBe(false);
  });

  it('tolerates a missing capability object entirely', () => {
    const parsed = parseCapabilities(undefined);
    expect(parsed.messaging).toBe(true);
    expect(parsed.relay).toBe(false);
  });
});

describe('connection quality', () => {
  const good = {
    lossRate: 0,
    attempted: 20,
    avgAckLatencyMs: 80,
    avgRssi: -50,
    disconnects: 0,
    mtu: 517,
  };

  it('withholds a score until there is enough evidence', () => {
    expect(
      computeQuality({...good, attempted: MIN_SAMPLES_FOR_QUALITY - 1}),
    ).toBeNull();
    expect(computeQuality(good)).not.toBeNull();
  });

  it('scores a clean, fast, strong link near 100', () => {
    expect(computeQuality(good)).toBeGreaterThanOrEqual(95);
  });

  it('drops sharply when messages are not acknowledged', () => {
    const lossy = computeQuality({...good, lossRate: 0.5});
    expect(lossy).not.toBeNull();
    // Delivery is half the score, so losing half the messages costs ~25 points.
    expect(lossy!).toBeLessThan(80);
    expect(lossy!).toBeGreaterThan(60);
  });

  it('penalises latency, weak signal and churn independently', () => {
    const base = computeQuality(good)!;
    expect(computeQuality({...good, avgAckLatencyMs: 1000})!).toBeLessThan(base);
    expect(computeQuality({...good, avgRssi: -95})!).toBeLessThan(base);
    expect(computeQuality({...good, disconnects: 5})!).toBeLessThan(base);
  });

  it('stays within 0..100 for absurd inputs', () => {
    const worst = computeQuality({
      lossRate: 5,
      attempted: 10,
      avgAckLatencyMs: 60_000,
      avgRssi: -200,
      disconnects: 999,
      mtu: 0,
    });
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThanOrEqual(100);
  });
});

describe('LinkMetrics', () => {
  it('accumulates uptime across reconnects', () => {
    const m = new LinkMetrics();
    m.markConnected(1_000);
    m.markDisconnected(3_000);
    m.markConnected(5_000);

    const snap = m.snapshot(6_000);
    expect(snap.connects).toBe(2);
    expect(snap.disconnects).toBe(1);
    expect(snap.currentUptimeMs).toBe(1_000);
    expect(snap.totalUptimeMs).toBe(3_000);
  });

  it('reports loss as the fraction of sends never acknowledged', () => {
    const m = new LinkMetrics();
    m.recordAck(50);
    m.recordAck(70);
    m.recordAck(60);
    m.recordAckTimeout();

    const snap = m.snapshot();
    expect(snap.acksReceived).toBe(3);
    expect(snap.acksMissed).toBe(1);
    expect(snap.lossRate).toBeCloseTo(0.25);
    expect(snap.avgAckLatencyMs).toBeCloseTo(60);
    expect(snap.worstAckLatencyMs).toBe(70);
  });

  it('counts bytes in both directions', () => {
    const m = new LinkMetrics();
    m.recordTxFrame(20);
    m.recordTxFrame(20);
    m.recordRxFrame(15);

    const snap = m.snapshot();
    expect(snap.bytesTx).toBe(40);
    expect(snap.bytesRx).toBe(15);
    expect(snap.framesTx).toBe(2);
    expect(snap.framesRx).toBe(1);
  });

  it('gives no quality score before any traffic', () => {
    expect(new LinkMetrics().snapshot().quality).toBeNull();
  });
});

describe('formatting', () => {
  it('formats durations the dashboard shows', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(18 * 60_000 + 32_000)).toBe('18m 32s');
    expect(formatDuration(3 * 3_600_000 + 5 * 60_000)).toBe('3h 5m');
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(84 * 1024)).toBe('84.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
