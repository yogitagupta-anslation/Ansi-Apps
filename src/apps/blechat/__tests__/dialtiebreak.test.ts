/**
 * Exactly one of any two phones places the call.
 *
 * Both see each other in the same instant, and before this both dialled. On two devices
 * that produced a link that came up and died a millisecond later — Android brings up the
 * second connection between the same pair and the stack tears one down under the other —
 * so the greeting went to a connection that no longer existed and came back "Operation
 * was rejected", which reads as the peer's fault and is not.
 *
 * The property that matters is not which side wins. It is that the two sides NEVER agree,
 * because agreeing either way is a bug: both dial is the collision, neither dials is a
 * stalemate where nothing ever happens.
 */
import {peerIdPrefix, shouldDial} from '../utils/id';

const A = peerIdPrefix('1f3c9a2b4d5e6f70' + '00'.repeat(8));
const B = peerIdPrefix('9a8b7c6d5e4f3021' + '00'.repeat(8));

describe('who dials', () => {
  it('never has both sides dial, and never has neither', () => {
    expect(shouldDial(A, B)).not.toBe(shouldDial(B, A));
  });

  it('gives the same answer every time it is asked', () => {
    // Both phones evaluate this independently, on every advertisement. An answer that
    // could change between two evaluations would put them back in lockstep.
    const first = shouldDial(A, B);
    for (let i = 0; i < 100; i++) {
      expect(shouldDial(A, B)).toBe(first);
    }
  });

  it('lets the lower identity dial', () => {
    expect(shouldDial(A, B)).toBe(true);
    expect(shouldDial(B, A)).toBe(false);
  });

  it('dials rather than stall when there is nothing to compare', () => {
    // No identity yet, or an advertisement that carried no prefix. Dialling may collide;
    // waiting for a comparison that will never happen cannot connect at all.
    expect(shouldDial(null, B)).toBe(true);
    expect(shouldDial(A, null)).toBe(true);
    expect(shouldDial(null, null)).toBe(true);
  });

  it('does not deadlock two identical prefixes', () => {
    // Should not happen — it would mean one identity on two phones — but a stalemate
    // here would be a silent "nothing ever connects".
    expect(shouldDial(A, A)).toBe(true);
  });

  it('decides on identity, not on who was discovered first', () => {
    // The rule has to be a property of the pair, or the two phones can disagree about
    // which of them is the caller depending on scan timing.
    const pairs: Array<[string, string]> = [
      [A, B],
      [B, A],
      [peerIdPrefix('0'.repeat(32)), peerIdPrefix('f'.repeat(32))],
    ];
    for (const [mine, theirs] of pairs) {
      expect(shouldDial(mine, theirs)).toBe(!shouldDial(theirs, mine) || mine === theirs);
    }
  });
});
