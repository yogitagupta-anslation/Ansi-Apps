/**
 * The check before you hand a stranger a way to reach you off this app.
 *
 * The asymmetry drives every case below: a false positive costs one tap on "Send anyway",
 * a false negative costs a phone number that cannot be unsent — there is no server here
 * holding a copy to delete. So the detector is tuned to catch, and the tests that matter
 * most are the evasions (spaces, dashes, words instead of digits) and the ordinary
 * sentences that must NOT trip it, because a guard that cries wolf gets tapped through
 * without being read, which is the same as not having one.
 */
import {describeFindings, findSensitive, hasSensitive} from '../security/ContentGuard';

const kinds = (text: string) => findSensitive(text).map(f => f.kind);

describe('phone numbers', () => {
  it('catches the ways people actually type one', () => {
    expect(kinds('call me on 9876543210')).toContain('phone');
    expect(kinds('+91 98765 43210')).toContain('phone');
    expect(kinds('(555) 123-4567')).toContain('phone');
    expect(kinds('555.123.4567')).toContain('phone');
    expect(kinds('my number is +1-555-123-4567 ok')).toContain('phone');
  });

  it('catches a number spelled out to get around a filter', () => {
    // Somebody who writes it in words has understood there is a check and gone round it,
    // which is exactly the moment worth interrupting.
    expect(kinds('nine eight seven six five four three two one zero')).toContain('phone');
  });

  it('leaves ordinary numbers alone', () => {
    // Too short to ring, and the commonest thing in a chat.
    expect(hasSensitive('see you at 5')).toBe(false);
    expect(hasSensitive('meet at 10:30 by gate 4')).toBe(false);
    expect(hasSensitive('it was 1999 or 2000')).toBe(false);
    expect(hasSensitive('bench 3, second row')).toBe(false);
  });
});

describe('the other ways out of the app', () => {
  it('catches an email, however it is disguised', () => {
    expect(kinds('reach me at ravi@example.com')).toContain('email');
    expect(kinds('ravi (at) example.com')).toContain('email');
  });

  it('catches a handle and a named platform', () => {
    expect(kinds('add me @ravi_photos')).toContain('handle');
    expect(kinds('my insta is ravi.jpg')).toContain('social');
    expect(kinds('https://t.me/ravi')).toContain('social');
    expect(kinds('snap: ravi123')).toContain('social');
  });

  it('catches payment details, which are almost never meant for a stranger', () => {
    expect(kinds('4111 1111 1111 1111')).toContain('payment');
    expect(kinds('send it to ravi@okaxis')).toContain('payment');
  });

  it('catches a street address', () => {
    expect(kinds('12 Brigade Road, second floor')).toContain('location');
  });

  it('does not fire on an ordinary conversation', () => {
    expect(hasSensitive('hey, are you in the lab?')).toBe(false);
    expect(hasSensitive('signal drops when I walk over')).toBe(false);
    expect(hasSensitive('great, see you there')).toBe(false);
    expect(hasSensitive('I liked that talk about x-rays')).toBe(false);
  });
});

describe('what the sheet is told', () => {
  it('reports each distinct thing once, not each match', () => {
    const found = findSensitive('9876543210 and also 9876543210');
    expect(found).toHaveLength(1);
  });

  it('does not report one span twice under two names', () => {
    // An address with digits in it is an email, not an email AND a phone number.
    const found = findSensitive('ravi2024@example.com');
    expect(found.map(f => f.kind)).toEqual(['email']);
  });

  it('reads as a sentence when several things are in one message', () => {
    const found = findSensitive('ravi@example.com or 9876543210');
    expect(describeFindings(found)).toBe('an email address and a phone number');
  });

  it('is not order-dependent between calls', () => {
    // These are module-level /g regexes; a shared lastIndex between calls would make one
    // check depend on the one before it.
    const first = findSensitive('9876543210');
    const second = findSensitive('9876543210');
    expect(second).toEqual(first);
  });
});
