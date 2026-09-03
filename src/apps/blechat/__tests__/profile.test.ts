/**
 * Names and interests — the profile that makes a stranger nearby approachable.
 *
 * Two things are being pinned. First, matching actually works: two people who picked the
 * same interest see it as shared. Second, a profile is attacker-controlled input like any
 * other packet field, so it is bounded before it is stored or displayed.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';
import {
  ALL_INTERESTS,
  bitmaskToBytes,
  bitmaskToInterests,
  bytesToBitmask,
  INTEREST_BITS,
  INTEREST_MASK_BITS,
  interestsToBitmask,
  isValidDisplayName,
  MAX_INTERESTS,
  MAX_INTEREST_LENGTH,
  sanitiseDisplayName,
  sanitiseInterests,
  sharedInterests,
} from '../config/interests';

describe('sanitiseInterests', () => {
  it('keeps a normal list untouched', () => {
    expect(sanitiseInterests(['Coding', 'Music'])).toEqual(['Coding', 'Music']);
  });

  it('collapses case-insensitive duplicates, keeping what the user typed', () => {
    // Otherwise "Coding" and "coding" are two interests that never match each other.
    expect(sanitiseInterests(['Coding', 'coding', 'CODING'])).toEqual(['Coding']);
  });

  it('drops blanks and non-strings instead of rendering them as empty chips', () => {
    expect(
      sanitiseInterests(['Music', '', '   ', null, 42, undefined, 'Art']),
    ).toEqual(['Music', 'Art']);
  });

  it('flattens whitespace so one interest cannot render as several rows', () => {
    expect(sanitiseInterests(['road\ntrips', 'live\tmusic'])).toEqual([
      'road trips',
      'live music',
    ]);
  });

  it('caps the length of a single interest', () => {
    const long = 'x'.repeat(500);
    const [only] = sanitiseInterests([long]);
    expect(only).toHaveLength(MAX_INTEREST_LENGTH);
  });

  it('caps how many a peer can send us', () => {
    const many = Array.from({length: 500}, (_, i) => `interest-${i}`);
    expect(sanitiseInterests(many)).toHaveLength(MAX_INTERESTS);
  });

  it('returns nothing for a value that is not a list at all', () => {
    expect(sanitiseInterests(undefined)).toEqual([]);
    expect(sanitiseInterests('Coding')).toEqual([]);
    expect(sanitiseInterests({0: 'Coding'})).toEqual([]);
  });
});

describe('sharedInterests', () => {
  it('finds the overlap', () => {
    expect(sharedInterests(['Coding', 'Music', 'Gym'], ['Music', 'Gym'])).toEqual([
      'Music',
      'Gym',
    ]);
  });

  it('matches regardless of case, so a typed entry meets a tapped chip', () => {
    expect(sharedInterests(['Coding'], ['coding'])).toEqual(['Coding']);
  });

  it('reports the overlap in OUR wording, not theirs', () => {
    // The local user recognises their own phrasing on screen.
    expect(sharedInterests(['CODING'], ['coding'])).toEqual(['CODING']);
  });

  it('is empty when nothing lines up', () => {
    expect(sharedInterests(['Coding'], ['Cricket'])).toEqual([]);
    expect(sharedInterests([], ['Coding'])).toEqual([]);
    expect(sharedInterests(['Coding'], [])).toEqual([]);
  });
});

describe('display names', () => {
  it('accepts something a person would answer to', () => {
    expect(isValidDisplayName('Ana')).toBe(true);
    expect(isValidDisplayName('  Ravi  ')).toBe(true);
  });

  it('rejects a name too short to mean anything', () => {
    expect(isValidDisplayName('')).toBe(false);
    expect(isValidDisplayName(' ')).toBe(false);
    expect(isValidDisplayName('a')).toBe(false);
  });

  it('normalises what gets stored', () => {
    expect(sanitiseDisplayName('  Ravi   Kumar ')).toBe('Ravi Kumar');
    expect(sanitiseDisplayName('x'.repeat(100))).toHaveLength(24);
    expect(sanitiseDisplayName(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('profiles over a real handshake', () => {
  let air: VirtualAir;
  let ana: VirtualPhone;
  let ravi: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    ana = new VirtualPhone('deviceA', 'Ana', air, undefined, [
      'Coding',
      'Music',
      'Cricket',
    ]);
    ravi = new VirtualPhone('deviceB', 'Ravi', air, undefined, ['Music', 'Gym']);
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
      'both sides to complete the handshake',
    );
  }

  it('carries the name and interests both ways', async () => {
    await connect();

    const raviAsSeenByAna = ana.peerManager.getPeer(ravi.peerId)!;
    expect(raviAsSeenByAna.displayName).toBe('Ravi');
    expect(raviAsSeenByAna.interests).toEqual(['Music', 'Gym']);

    // The responder learns the initiator's profile too — a one-way exchange would leave
    // whoever answered the call unable to see who called.
    const anaAsSeenByRavi = ravi.peerManager.getPeer(ana.peerId)!;
    expect(anaAsSeenByRavi.displayName).toBe('Ana');
    expect(anaAsSeenByRavi.interests).toEqual(['Coding', 'Music', 'Cricket']);
  });

  it('gives each side the overlap to highlight', async () => {
    await connect();

    const theirs = ana.peerManager.getPeer(ravi.peerId)!.interests;
    expect(sharedInterests(ana.interests, theirs)).toEqual(['Music']);
  });

  it('still connects to a peer with no profile at all', async () => {
    // A peer on a build without profiles, or someone who added no interests. Neither is
    // a reason to refuse a conversation.
    ravi.interests = [];
    await connect();

    expect(ana.peerManager.getPeer(ravi.peerId)!.interests).toEqual([]);
    expect(ana.isConnectedTo(ravi.peerId)).toBe(true);
  });

  it('never puts an unbounded profile on the air, however it got set', async () => {
    // Bounded on the way OUT, not only on receipt. Sanitising only at the far end is too
    // late: by then the profile has already been fragmented across the link, and past the
    // reassembly caps the handshake stalls instead of completing. This is what stops us
    // doing that to somebody else.
    ravi.interests = Array.from({length: 200}, (_, i) => `${i}-${'x'.repeat(400)}`);
    await connect();

    const stored = ana.peerManager.getPeer(ravi.peerId)!.interests;
    expect(stored.length).toBeLessThanOrEqual(MAX_INTERESTS);
    for (const interest of stored) {
      expect(interest.length).toBeLessThanOrEqual(MAX_INTEREST_LENGTH);
    }
  });

  it('sends the profile as it is at handshake time, not as it was at startup', async () => {
    // Editing your interests in Settings must reach the next person you meet without
    // restarting the app.
    ravi.interests = ['Photography'];
    await connect();

    expect(ana.peerManager.getPeer(ravi.peerId)!.interests).toEqual([
      'Photography',
    ]);
  });
});

describe('the advertised interest bitmask', () => {
  /**
   * The one thing in this file that can never change.
   *
   * Bit N means whatever INTEREST_BITS says at index N, on every phone that has ever run
   * the app. Inserting an entry in the middle silently relabels every bit above it, and a
   * peer on an older build would then confidently show the wrong interest. If this test
   * fails because the list was reordered, the list is wrong — not the test.
   */
  it('has a fixed, append-only wire order', () => {
    expect(INTEREST_BITS.slice(0, 6)).toEqual([
      'Football',
      'Cricket',
      'Gym',
      'Running',
      'Cycling',
      'Hiking',
    ]);
    expect(INTEREST_BITS[12]).toBe('Music');
    expect(INTEREST_BITS[23]).toBe('Pets');
  });

  it('fits in the three bytes the advertisement can spare', () => {
    expect(INTEREST_BITS.length).toBeLessThanOrEqual(INTEREST_MASK_BITS);
  });

  it('has a bit for every interest the picker offers', () => {
    // A catalogue entry with no bit would be invisible until after connecting, which is
    // exactly the gap this feature closes.
    const bits = new Set(INTEREST_BITS.map(i => i.toLowerCase()));
    for (const interest of ALL_INTERESTS) {
      expect(bits.has(interest.toLowerCase())).toBe(true);
    }
  });

  it('round-trips a selection', () => {
    const picked = ['Cricket', 'Music', 'Pets'];
    expect(bitmaskToInterests(interestsToBitmask(picked)).sort()).toEqual(
      [...picked].sort(),
    );
  });

  it('round-trips every interest at once', () => {
    const all = [...INTEREST_BITS];
    expect(bitmaskToInterests(interestsToBitmask(all))).toEqual(all);
  });

  it('is empty for an empty selection', () => {
    expect(interestsToBitmask([])).toBe(0);
    expect(bitmaskToInterests(0)).toEqual([]);
  });

  it('matches a catalogue entry regardless of case', () => {
    expect(interestsToBitmask(['cricket'])).toBe(interestsToBitmask(['Cricket']));
  });

  it('silently drops a custom interest, which has no bit to occupy', () => {
    // The honest cost of showing interests before connecting: free text cannot fit in
    // three bytes. It still travels in the handshake.
    const mask = interestsToBitmask(['Cricket', 'Competitive yodelling']);
    expect(bitmaskToInterests(mask)).toEqual(['Cricket']);
  });

  it('ignores bits above the catalogue instead of refusing the advertisement', () => {
    // A future build with a longer list will set them. Treating that as corrupt would
    // make the newer release invisible to this one.
    const mask = interestsToBitmask(['Music']) + Math.pow(2, 30);
    expect(bitmaskToInterests(mask)).toEqual(['Music']);
  });

  it('rejects a nonsensical mask rather than producing nonsense', () => {
    expect(bitmaskToInterests(-1)).toEqual([]);
    expect(bitmaskToInterests(NaN)).toEqual([]);
    expect(bitmaskToInterests(Infinity)).toEqual([]);
  });

  it('encodes little-endian, matching the Kotlin writer', () => {
    // Bit 0 is the low bit of the FIRST byte. Getting this backwards would swap
    // "Football" for "Pets" between platforms.
    expect(Array.from(bitmaskToBytes(interestsToBitmask(['Football'])))).toEqual([
      1, 0, 0,
    ]);
    expect(Array.from(bitmaskToBytes(interestsToBitmask(['Pets'])))).toEqual([
      0, 0, 128,
    ]);
  });

  it('survives the byte round trip', () => {
    const mask = interestsToBitmask(['Coding', 'Travel', 'Pets']);
    expect(bytesToBitmask(bitmaskToBytes(mask))).toBe(mask);
  });

  it('reads a truncated mask without throwing', () => {
    // A malformed advertisement must never take the scanner down.
    expect(bytesToBitmask(new Uint8Array([1]))).toBe(1);
    expect(bytesToBitmask(new Uint8Array([]))).toBe(0);
  });
});

describe('interests before connecting', () => {
  let air: VirtualAir;
  let ana: VirtualPhone;
  let ravi: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    ana = new VirtualPhone('deviceA', 'Ana', air, undefined, ['Coding', 'Music']);
    ravi = new VirtualPhone('deviceB', 'Ravi', air, undefined, ['Music', 'Gym']);
    // What each phone puts in its advertisement, packed exactly as production does.
    ana.transport.interestMask = interestsToBitmask(ana.interests);
    ravi.transport.interestMask = interestsToBitmask(ravi.interests);
  });

  afterEach(() => {
    ana.dispose();
    ravi.dispose();
  });

  /** The whole point of the bitmask: something to go on before you tap Connect. */
  it('shows a stranger interests with no connection at all', async () => {
    ravi.startAdvertising();
    await ana.scan();

    const seen = ana.peerManager
      .getPeers()
      .find(p => p.peerIdPrefix === ravi.peerId.slice(0, 16));

    expect(seen).toBeDefined();
    expect(seen!.state).not.toBe('connected');
    // Catalogue order, not the order Ravi picked: a bitmask has no room to record which
    // interest he listed first. The handshake list, which does, replaces this on connect.
    expect(seen!.interests).toEqual(['Gym', 'Music']);
  });

  it('gives the overlap to highlight before connecting', async () => {
    ravi.startAdvertising();
    await ana.scan();

    const seen = ana.peerManager
      .getPeers()
      .find(p => p.peerIdPrefix === ravi.peerId.slice(0, 16))!;
    expect(sharedInterests(ana.interests, seen.interests)).toEqual(['Music']);
  });

  it('advertises nothing for a peer that has chosen nothing', async () => {
    ravi.transport.interestMask = 0;
    ravi.startAdvertising();
    await ana.scan();

    const seen = ana.peerManager
      .getPeers()
      .find(p => p.peerIdPrefix === ravi.peerId.slice(0, 16))!;
    expect(seen.interests).toEqual([]);
  });

  it('replaces the advertised list with the fuller one from the handshake', async () => {
    // The advertisement can only carry catalogue entries; the handshake carries custom
    // ones too. Once connected, the richer list must win.
    ravi.interests = ['Music', 'Gym', 'Competitive yodelling'];
    ravi.transport.interestMask = interestsToBitmask(ravi.interests);
    ravi.startAdvertising();

    await ana.scan();
    expect(
      ana.peerManager
        .getPeers()
        .find(p => p.peerIdPrefix === ravi.peerId.slice(0, 16))!.interests,
    ).toEqual(['Gym', 'Music']);

    await ana.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => ana.isConnectedTo(ravi.peerId), 'handshake');

    expect(ana.peerManager.getPeer(ravi.peerId)!.interests).toEqual([
      'Music',
      'Gym',
      'Competitive yodelling',
    ]);
  });

  it('does not blank a known list when an older peer advertises without one', async () => {
    ravi.startAdvertising();
    await ana.scan();
    await ana.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => ana.isConnectedTo(ravi.peerId), 'handshake');

    // A build predating the bitmask advertises no interests at all. Losing what the
    // handshake already told us would be a step backwards.
    ravi.transport.interestMask = 0;
    await ana.scan();

    expect(ana.peerManager.getPeer(ravi.peerId)!.interests).toEqual([
      'Music',
      'Gym',
    ]);
  });
});
