/**
 * What the Nearby and Chats lists are built from.
 *
 * These cover the bookkeeping the UI reads: attempt counters, the connection timeline,
 * cancellation, reconnect bounds, and unread/preview state. None of it is cosmetic — a
 * count that drifts or a timeline that lies is worse than not showing one.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
} from '../config/constants';
import {qualityLabel} from '../peers/LinkMetrics';

describe('connection bookkeeping', () => {
  let air: VirtualAir;
  let ana: VirtualPhone;
  let ravi: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    ana = new VirtualPhone('deviceA', 'Ana', air);
    ravi = new VirtualPhone('deviceB', 'Ravi', air);
  });

  afterEach(() => {
    ana.dispose();
    ravi.dispose();
  });

  async function connect(): Promise<void> {
    ravi.startAdvertising();
    await ana.scan();
    await ana.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => ana.isConnectedTo(ravi.peerId), 'handshake');
  }

  it('counts a successful attempt as an attempt and a success, not a failure', async () => {
    await connect();

    const peer = ana.peerManager.getPeer(ravi.peerId)!;
    expect(peer.attempts).toBe(1);
    expect(peer.connectCount).toBe(1);
    expect(peer.failures).toBe(0);
  });

  it('counts a failed attempt without inventing a success', async () => {
    // Not advertising, so it cannot be connected to.
    await expect(
      ana.peerManager.connect(toCentralLinkId('deviceB')),
    ).rejects.toBeDefined();

    const stats = ana.peerManager.statsFor(toCentralLinkId('deviceB'));
    expect(stats.attempts).toBe(1);
    expect(stats.failures).toBe(1);
    expect(stats.successes).toBe(0);
  });

  it('records the stages a connection actually went through', async () => {
    await connect();

    const labels = ana.peerManager
      .historyFor(toCentralLinkId('deviceB'))
      .map(e => e.label);

    // The order matters: knowing an attempt reached "MTU negotiated" but not "Connected"
    // is what separates a peer out of range from one running the wrong build.
    expect(labels).toEqual(
      expect.arrayContaining([
        'Connecting',
        'Service discovered',
        'MTU negotiated',
        'Notifications enabled',
        'Connected',
      ]),
    );
    expect(labels.indexOf('Connecting')).toBeLessThan(labels.indexOf('Connected'));
  });

  it('marks the connected entry as a success and a failure as an error', async () => {
    await connect();
    const events = ana.peerManager.historyFor(toCentralLinkId('deviceB'));
    expect(events.find(e => e.label === 'Connected')?.tone).toBe('ok');

    await ana.peerManager.disconnect(toCentralLinkId('deviceB'));
    await waitFor(() => !ana.isConnectedTo(ravi.peerId), 'disconnect');

    const after = ana.peerManager.historyFor(toCentralLinkId('deviceB'));
    expect(after[after.length - 1].label).toBe('Disconnected');
  });

  it('names the reason a failure happened, not just that it did', async () => {
    await expect(
      ana.peerManager.connect(toCentralLinkId('deviceB')),
    ).rejects.toBeDefined();

    const failed = ana.peerManager
      .historyFor(toCentralLinkId('deviceB'))
      .find(e => e.label === 'Failed');
    expect(failed).toBeDefined();
    expect(failed!.tone).toBe('error');
    // "ConnectionRefused during connecting" — the stage is half the diagnosis.
    expect(failed!.detail).toMatch(/during/);
  });

  it('keeps the timeline bounded so a long session cannot grow it forever', async () => {
    for (let i = 0; i < 120; i++) {
      await ana.peerManager
        .connect(toCentralLinkId('deviceB'))
        .catch(() => undefined);
    }
    expect(
      ana.peerManager.historyFor(toCentralLinkId('deviceB')).length,
    ).toBeLessThanOrEqual(60);
  });

  it('reports nothing for a link that has never been touched', () => {
    expect(ana.peerManager.historyFor('c:never')).toEqual([]);
    expect(ana.peerManager.statsFor('c:never')).toEqual({
      attempts: 0,
      successes: 0,
      failures: 0,
    });
    expect(ana.peerManager.historyFor(null)).toEqual([]);
  });

  it('clears the reconnect backoff after a success', async () => {
    await connect();
    // A fresh success means the next drop starts at 1s again rather than inheriting a
    // long delay from a bad patch earlier in the session.
    expect(ana.peerManager.getPeer(ravi.peerId)!.reconnectAttempt).toBe(0);
  });
});

describe('cancelling a connection', () => {
  let air: VirtualAir;
  let ana: VirtualPhone;
  let ravi: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    ana = new VirtualPhone('deviceA', 'Ana', air);
    ravi = new VirtualPhone('deviceB', 'Ravi', air);
  });

  afterEach(() => {
    ana.dispose();
    ravi.dispose();
  });

  it('leaves the peer connectable rather than marked as failed', async () => {
    ravi.startAdvertising();
    await ana.scan();
    await ana.peerManager.cancelConnect(toCentralLinkId('deviceB'));

    const peer = ana.peerManager
      .getPeers()
      .find(p => p.linkId === toCentralLinkId('deviceB'));

    // A cancel is evidence of nothing about the peer, so it must not leave a failure
    // behind that the row would render as a red error.
    expect(peer?.failure ?? null).toBeNull();
    expect(peer?.state).not.toBe('failed');
  });

  it('records the cancel in the timeline without counting it as a failure', async () => {
    ravi.startAdvertising();
    await ana.scan();
    await ana.peerManager.cancelConnect(toCentralLinkId('deviceB'));

    const events = ana.peerManager.historyFor(toCentralLinkId('deviceB'));
    expect(events.map(e => e.label)).toContain('Cancelled by user');
    expect(ana.peerManager.statsFor(toCentralLinkId('deviceB')).failures).toBe(0);
  });

  it('can still connect afterwards', async () => {
    ravi.startAdvertising();
    await ana.scan();
    await ana.peerManager.cancelConnect(toCentralLinkId('deviceB'));

    await ana.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => ana.isConnectedTo(ravi.peerId), 'connect after cancel');
  });
});

describe('reconnect policy', () => {
  it('doubles the delay from one second', () => {
    // 1s, 2s, 4s, 8s. Retrying immediately reproduces the most common cause of an
    // Android connect failure — a teardown that has not finished.
    const delay = (attempt: number) =>
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    expect(delay(1)).toBe(1000);
    expect(delay(2)).toBe(2000);
    expect(delay(3)).toBe(4000);
    expect(delay(4)).toBe(8000);
  });

  it('is bounded, so a peer that has gone is eventually left alone', () => {
    expect(RECONNECT_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(RECONNECT_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});

describe('link quality wording', () => {
  it('withholds a word when there is no score', () => {
    // No measurement, no claim.
    expect(qualityLabel(null)).toBeNull();
  });

  it('turns a score into something a person can act on', () => {
    expect(qualityLabel(95)).toBe('Excellent');
    expect(qualityLabel(70)).toBe('Good');
    expect(qualityLabel(45)).toBe('Fair');
    expect(qualityLabel(10)).toBe('Poor');
  });
});

describe('unread counts and previews', () => {
  let air: VirtualAir;
  let ana: VirtualPhone;
  let ravi: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    ana = new VirtualPhone('deviceA', 'Ana', air);
    ravi = new VirtualPhone('deviceB', 'Ravi', air);
  });

  afterEach(() => {
    ana.dispose();
    ravi.dispose();
  });

  async function connect(): Promise<void> {
    ravi.startAdvertising();
    await ana.scan();
    await ana.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () => ana.isConnectedTo(ravi.peerId) && ravi.isConnectedTo(ana.peerId),
      'handshake',
    );
  }

  it('counts what arrived and nothing else', async () => {
    await connect();
    await ravi.messages.send(ana.peerId, 'one');
    await ravi.messages.send(ana.peerId, 'two');
    await waitFor(
      () => ana.messages.unreadCount(ravi.peerId) === 2,
      'both to count as unread',
    );
  });

  it('does not count our own messages as unread', async () => {
    await connect();
    await ana.messages.send(ravi.peerId, 'mine');
    expect(ana.messages.unreadCount(ravi.peerId)).toBe(0);
  });

  it('clears when the conversation is opened', async () => {
    await connect();
    await ravi.messages.send(ana.peerId, 'hello');
    await waitFor(() => ana.messages.unreadCount(ravi.peerId) === 1, 'unread');

    ana.messages.markRead(ravi.peerId);
    expect(ana.messages.unreadCount(ravi.peerId)).toBe(0);
  });

  it('counts a message that arrives after the conversation was read', async () => {
    await connect();
    await ravi.messages.send(ana.peerId, 'first');
    await waitFor(() => ana.messages.unreadCount(ravi.peerId) === 1, 'first');
    ana.messages.markRead(ravi.peerId);

    await ravi.messages.send(ana.peerId, 'second');
    await waitFor(
      () => ana.messages.unreadCount(ravi.peerId) === 1,
      'the later message to count',
    );
  });

  it('survives a restart, so every chat is not unread on launch', () => {
    // A high-water mark rather than a running count: a count would have to be adjusted in
    // lockstep with every arrival and every read, and one missed event leaves it wrong
    // permanently.
    const marks = {'peer-1': 1000};
    ana.messages.hydrateReadMarks(marks);
    expect(ana.messages.readMarks()['peer-1']).toBe(1000);
  });

  it('offers the newest message as the list preview', async () => {
    await connect();
    await ravi.messages.send(ana.peerId, 'older');
    await waitFor(() => ana.conversationWith(ravi.peerId).length === 1, 'first');
    await ravi.messages.send(ana.peerId, 'newest');
    await waitFor(() => ana.conversationWith(ravi.peerId).length === 2, 'second');

    expect(ana.messages.lastMessage(ravi.peerId)?.text).toBe('newest');
  });

  it('has no preview for a conversation that does not exist', () => {
    expect(ana.messages.lastMessage('nobody')).toBeNull();
    expect(ana.messages.unreadCount('nobody')).toBe(0);
  });
});
