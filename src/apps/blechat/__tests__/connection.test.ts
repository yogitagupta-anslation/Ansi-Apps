/**
 * Covers the connection state machine, typed failures, and the mesh-forward accounting
 * that Phase 2 will rely on.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';
import {buildMessage, buildRelayed} from '../messaging/Packet';
import {JsonPacketCodec} from '../messaging/PacketCodec';
import type {Packet} from '../types/Packet';
import {utf8Encode} from '../utils/bytes';
import {LINK_PROGRESS, type LinkState} from '../types/BLE';
import {makeFailure, toLinkFailure} from '../utils/linkFailure';
import {relativeTime} from '../utils/time';
import {DEFAULT_TTL} from '../config/constants';

describe('connection state machine', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  it('walks the phases in order and ends connected', async () => {
    const seen: LinkState[] = [];
    phoneA.transport.onLinkPhase(e => seen.push(e.phase));

    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () => phoneA.isConnectedTo(phoneB.peerId),
      'A to reach connected',
    );

    expect(seen).toEqual([
      'connecting',
      'discoveringServices',
      'negotiatingMtu',
      'enablingNotifications',
    ]);

    // The stages reported are a prefix of the canonical progression, in order.
    const expectedOrder = LINK_PROGRESS.filter(p => seen.includes(p));
    expect(seen).toEqual(expectedOrder);

    expect(phoneA.peerManager.getPeer(phoneB.peerId)?.state).toBe('connected');
  });

  it('records a typed failure when the peer is not reachable', async () => {
    await expect(
      phoneA.peerManager.connect(toCentralLinkId('nonexistent')),
    ).rejects.toThrow();

    const failed = phoneA.peerManager
      .getPeers()
      .find(p => p.linkId === toCentralLinkId('nonexistent'));

    expect(failed?.state).toBe('failed');
    expect(failed?.failure?.phase).toBe('connecting');
    // No typed carrier on this throw, so it falls back to the phase-appropriate reason
    // rather than being swallowed as "unknown error".
    expect(failed?.failure?.reason).toBe('ConnectionRefused');
    expect(failed?.failure?.message).toContain('nonexistent');
  });

  it('clears a stale failure when the peer advertises again', async () => {
    await expect(
      phoneA.peerManager.connect(toCentralLinkId('deviceB')),
    ).rejects.toThrow();
    expect(
      phoneA.peerManager.getPeers().find(p => p.linkId === toCentralLinkId('deviceB'))
        ?.failure,
    ).not.toBeNull();

    phoneB.startAdvertising();
    await phoneA.scan();

    const peer = phoneA.peerManager
      .getPeers()
      .find(p => p.linkId === toCentralLinkId('deviceB'));
    expect(peer?.state).toBe('discovering');
    expect(peer?.failure).toBeNull();
  });

  it('counts successful connects per peer', async () => {
    phoneB.startAdvertising();
    await phoneA.scan();

    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.peerId), 'first connect');
    expect(phoneA.peerManager.getPeer(phoneB.peerId)?.connectCount).toBe(1);

    await phoneA.peerManager.disconnect(phoneB.peerId);
    await waitFor(() => !phoneA.isConnectedTo(phoneB.peerId), 'disconnect');

    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.peerId), 'second connect');
    expect(phoneA.peerManager.getPeer(phoneB.peerId)?.connectCount).toBe(2);
  });

  it('marks a dropped link as LinkLost rather than a bare string', async () => {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.peerId), 'connect');

    await phoneB.transport.disconnect(phoneB.transport.linkIds[0]);
    await waitFor(
      () => !phoneA.isConnectedTo(phoneB.peerId),
      'A to notice the drop',
    );

    const peer = phoneA.peerManager.getPeer(phoneB.peerId);
    expect(peer?.failure?.reason).toBe('LinkLost');
    expect(peer?.failure?.phase).toBe('connected');
  });
});

describe('typed link failures', () => {
  it('preserves a carrier failure unchanged', () => {
    const original = makeFailure('ServiceNotFound', 'discoveringServices', 'no service');
    const carrier = {toFailure: () => original};
    expect(toLinkFailure(carrier, 'connecting')).toBe(original);
  });

  it('falls back to the phase-appropriate reason for a plain throw', () => {
    const failure = toLinkFailure(new Error('boom'), 'handshaking', 'HandshakeFailed');
    expect(failure.reason).toBe('HandshakeFailed');
    expect(failure.phase).toBe('handshaking');
    expect(failure.message).toBe('boom');
  });
});

describe('mesh forwarding accounting', () => {
  const codec = new JsonPacketCodec();

  it('buildRelayed decrements TTL, increments hops, and keeps the origin', () => {
    const original = buildMessage('peerA', 'peerC', 'hello', 'msg-1');
    expect(original.originId).toBe('peerA');
    expect(original.hopCount).toBe(0);
    expect(original.ttl).toBe(DEFAULT_TTL);

    const relayed = buildRelayed(original, 'peerB');

    // Identity of the message is preserved so dedup still catches it downstream.
    expect(relayed.id).toBe(original.id);
    expect(relayed.originId).toBe('peerA');
    expect(relayed.destinationId).toBe('peerC');
    // Only the hop accounting and the last-hop sender change.
    expect(relayed.senderId).toBe('peerB');
    expect(relayed.ttl).toBe(DEFAULT_TTL - 1);
    expect(relayed.hopCount).toBe(1);
  });

  it('ttl and hopCount stay consistent across a simulated A -> B -> C -> D chain', () => {
    let packet: Packet = buildMessage('A', 'D', 'over the mesh', 'msg-2');
    const path = ['B', 'C'];
    for (const relay of path) {
      packet = buildRelayed(packet, relay);
    }

    expect(packet.hopCount).toBe(2);
    expect(packet.ttl).toBe(DEFAULT_TTL - 2);
    expect(packet.originId).toBe('A');
    expect(packet.senderId).toBe('C');
    // The invariant a relay must never break: hops taken plus hops left is constant.
    expect(packet.hopCount + packet.ttl).toBe(DEFAULT_TTL);
  });

  it('survives the wire format intact', () => {
    const relayed = buildRelayed(buildMessage('A', 'C', 'hi', 'msg-3'), 'B');
    // Builders leave seq at zero; MessageRouter stamps it on the way out, so a packet
    // that has actually been transmitted always carries one.
    relayed.seq = 12;
    expect(codec.decode(codec.encode(relayed))).toEqual(relayed);
  });

  it('still defaults originId and hopCount when a peer omits them', () => {
    const decoded = codec.decode(
      utf8Encode(
        JSON.stringify({
          version: 1,
          id: 'no-mesh-fields',
          type: 'MESSAGE',
          senderId: 'oldPeer',
          destinationId: 'me',
          seq: 4,
          timestamp: 1,
          ttl: 5,
          payload: {text: 'no mesh fields'},
        }),
      ),
    );

    expect(decoded.originId).toBe('oldPeer');
    expect(decoded.hopCount).toBe(0);
  });

  it('refuses a packet with no sequence number rather than defaulting one', () => {
    // originId and hopCount are tolerated when absent, because a build without them is
    // merely older. seq is not: a packet without one has no replay protection, and
    // substituting a value would hand an attacker exactly the bypass it exists to close.
    const noSeq = JSON.stringify({
      version: 1,
      id: 'legacy-1',
      type: 'MESSAGE',
      senderId: 'oldPeer',
      destinationId: 'me',
      timestamp: 1,
      ttl: 5,
      payload: {text: 'from an older build'},
    });

    expect(() => codec.decode(utf8Encode(noSeq))).toThrow(/seq/);

    for (const bad of [0, -1, 1.5, '3', null]) {
      const packet = JSON.stringify({
        version: 1,
        id: 'bad-seq',
        type: 'MESSAGE',
        senderId: 'oldPeer',
        destinationId: 'me',
        seq: bad,
        timestamp: 1,
        ttl: 5,
        payload: {text: 'x'},
      });
      expect(() => codec.decode(utf8Encode(packet))).toThrow(/seq/);
    }
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;
  it('formats the ranges a peer list actually shows', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 5_000, now)).toBe('5s ago');
    expect(relativeTime(now - 120_000, now)).toBe('2m ago');
    expect(relativeTime(now - 7_200_000, now)).toBe('2h ago');
    expect(relativeTime(now - 172_800_000, now)).toBe('2d ago');
  });
});

describe('simultaneous dial (observed on hardware)', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  /**
   * Reproduces what the two-phone screenshots showed: one physical phone listed twice,
   * once "[connected]" on the inbound peripheral link and once "[handshaking]" on the
   * outbound central link, because both handsets dialled each other at once.
   */
  it('lists a peer once when it is reachable on two links', async () => {
    phoneA.startAdvertising();
    phoneB.startAdvertising();

    // B dials A first and completes, so A is reachable over its peripheral link.
    await phoneB.peerManager.connect(toCentralLinkId('deviceA'));
    await waitFor(
      () => phoneA.isConnectedTo(phoneB.peerId),
      'A to accept the inbound link',
    );

    // Now A also sees B advertising and would dial out.
    await phoneA.scan();

    const entries = phoneA.peerManager
      .getPeers()
      .filter(p => p.peerIdPrefix === phoneB.identity.peerId.slice(0, 16) ||
                   p.peerId === phoneB.peerId);
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe('connected');
  });

  it('refuses a redundant dial to an already-connected peer', async () => {
    phoneA.startAdvertising();
    phoneB.startAdvertising();

    await phoneB.peerManager.connect(toCentralLinkId('deviceA'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.peerId), 'inbound link up');

    await phoneA.scan();
    const linksBefore = phoneA.transport.linkIds.length;

    // Dialling out would create a second link, which the tie-break would then tear down —
    // and every packet in flight on the losing link counts as a failed send.
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));

    expect(phoneA.transport.linkIds).toHaveLength(linksBefore);
    expect(phoneA.isConnectedTo(phoneB.peerId)).toBe(true);
  });
});
