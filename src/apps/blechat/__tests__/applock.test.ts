/**
 * AppLock's PIN hashing: deterministic, distinguishes different PINs, and never stores
 * or compares the PIN itself in plain text.
 */
import {hashPin, pinMatches} from '../security/AppLock';

describe('AppLock', () => {
  it('hashes the same PIN to the same value', () => {
    expect(hashPin('1234')).toBe(hashPin('1234'));
  });

  it('hashes different PINs to different values', () => {
    expect(hashPin('1234')).not.toBe(hashPin('4321'));
    expect(hashPin('1234')).not.toBe(hashPin('12345'));
  });

  it('never returns the PIN itself', () => {
    expect(hashPin('1234')).not.toBe('1234');
  });

  it('pinMatches confirms a correct PIN and rejects a wrong one', () => {
    const hash = hashPin('7392');
    expect(pinMatches('7392', hash)).toBe(true);
    expect(pinMatches('0000', hash)).toBe(false);
    expect(pinMatches('', hash)).toBe(false);
  });
});
