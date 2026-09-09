import { MAX_FRAGMENTS, Reassembler, toFrames, usablePayload } from '../ble/framing';
import { decode, encode, MAX_PAYLOAD, Msg } from '../ble/protocol';
import { DEFAULT_ATT_MTU, REQUESTED_MTU } from '../ble/constants';

/**
 * The framing exists for the case nobody wants to think about: a stack that
 * refuses the MTU request and leaves twenty usable bytes per write. Every test
 * here is that case, because the comfortable one is trivially correct.
 */

const go: Msg = { t: 'go', rid: 'r-a1b2c3', lo: 1, hi: 10000, tg: 6174, md: 'sudden', mf: ['limited', 'heat'] };

function pipe(msg: Msg, mtu: number): Msg | null {
  const reassembler = new Reassembler();
  let out: string | null = null;
  for (const frame of toFrames(encode(msg), mtu)) {
    out = reassembler.accept(frame);
  }
  return out === null ? null : decode(out);
}

describe('framing', () => {
  it('sends a message in one packet once the MTU request lands', () => {
    expect(toFrames(encode(go), REQUESTED_MTU)).toHaveLength(1);
    expect(pipe(go, REQUESTED_MTU)).toEqual(go);
  });

  it('rebuilds a round intact across the smallest MTU any stack offers', () => {
    const frames = toFrames(encode(go), DEFAULT_ATT_MTU);
    expect(frames.length).toBeGreaterThan(1);
    expect(pipe(go, DEFAULT_ATT_MTU)).toEqual(go);
  });

  it('leaves room for the ATT header and its own', () => {
    expect(usablePayload(DEFAULT_ATT_MTU)).toBe(19);
    expect(usablePayload(REQUESTED_MTU)).toBe(181);
  });

  it('carries the largest message the protocol will ever emit', () => {
    const big = 'x'.repeat(MAX_PAYLOAD);
    const reassembler = new Reassembler();
    let out: string | null = null;
    for (const frame of toFrames(big, DEFAULT_ATT_MTU)) out = reassembler.accept(frame);
    expect(out).toBe(big);
  });

  it('keeps non-ASCII names intact when they are split mid-character', () => {
    const hello: Msg = { t: 'hello', id: 'p-9f2c1a', nm: 'Zoë 🎲 Kenji' };
    expect(pipe(hello, DEFAULT_ATT_MTU)).toEqual(hello);
  });

  it('drops a message with a hole in it rather than delivering a corrupt one', () => {
    const frames = toFrames(encode(go), DEFAULT_ATT_MTU);
    const reassembler = new Reassembler();

    let out: string | null = null;
    frames.forEach((frame, i) => {
      if (i === 1) return; // the radio ate this one
      out = reassembler.accept(frame);
    });

    expect(out).toBeNull();
  });

  it('recovers on the next message after a hole', () => {
    const reassembler = new Reassembler();
    toFrames(encode(go), DEFAULT_ATT_MTU)
      .slice(0, 2)
      .forEach((frame) => reassembler.accept(frame)); // sender vanished mid-message

    const guess: Msg = { t: 'g', rid: 'r-a1b2c3', id: 'p-9f2c1a', v: 4242 };
    let out: string | null = null;
    for (const frame of toFrames(encode(guess), DEFAULT_ATT_MTU)) out = reassembler.accept(frame);

    expect(out === null ? null : decode(out)).toEqual(guess);
  });

  it('refuses to emit more fragments than the header can number', () => {
    // One byte of header gives six bits of index. Anything past that would
    // silently wrap and reassemble into nonsense, so it throws instead.
    const overlong = 'x'.repeat(usablePayload(DEFAULT_ATT_MTU) * (MAX_FRAGMENTS + 1));
    expect(() => toFrames(overlong, DEFAULT_ATT_MTU)).toThrow(/fragments/);
  });
});
