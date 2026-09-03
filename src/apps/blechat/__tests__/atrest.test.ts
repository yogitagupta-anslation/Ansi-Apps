import {
  AtRestDecryptError,
  decryptString,
  encryptString,
  generateStorageKey,
  isEncrypted,
  storageKeyFromHex,
  storageKeyToHex,
} from '../crypto/AtRestCrypto';

describe('at-rest encryption', () => {
  it('round-trips stored JSON', () => {
    const key = generateStorageKey();
    const payload = JSON.stringify([{text: 'queued message', to: 'peer-1'}]);
    const stored = encryptString(payload, key);
    expect(decryptString(stored, key)).toBe(payload);
  });

  it('leaves no readable message text in the stored value', () => {
    const key = generateStorageKey();
    const stored = encryptString(
      JSON.stringify([{text: 'the codeword is albatross'}]),
      key,
    );
    expect(stored).not.toContain('albatross');
    expect(stored).not.toContain('codeword');
    expect(stored).not.toContain('text');
  });

  it('produces different ciphertext each time, so repeats are not detectable', () => {
    const key = generateStorageKey();
    const a = encryptString('same', key);
    const b = encryptString('same', key);
    expect(a).not.toBe(b);
    expect(decryptString(a, key)).toBe('same');
    expect(decryptString(b, key)).toBe('same');
  });

  it('refuses to decrypt with the wrong key rather than returning garbage', () => {
    const stored = encryptString('secret', generateStorageKey());
    expect(() => decryptString(stored, generateStorageKey())).toThrow(
      AtRestDecryptError,
    );
  });

  it('detects tampering with a stored record', () => {
    const key = generateStorageKey();
    const stored = encryptString('transfer 100', key);
    // Flip a hex digit in the ciphertext body.
    const flipped =
      stored.slice(0, stored.length - 4) +
      (stored[stored.length - 4] === 'a' ? 'b' : 'a') +
      stored.slice(stored.length - 3);
    expect(() => decryptString(flipped, key)).toThrow(AtRestDecryptError);
  });

  it('reads back a record written before encryption existed', () => {
    // Upgrade path: an existing user's queued messages must not vanish.
    const legacy = JSON.stringify([{text: 'written by an older build'}]);
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptString(legacy, generateStorageKey())).toBe(legacy);
  });

  it('round-trips the storage key through hex', () => {
    const key = generateStorageKey();
    const restored = storageKeyFromHex(storageKeyToHex(key));
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual(Array.from(key));
  });

  it('rejects a malformed stored key instead of using a truncated one', () => {
    expect(storageKeyFromHex('abcd')).toBeNull();
    expect(storageKeyFromHex(null)).toBeNull();
    expect(storageKeyFromHex('zz'.repeat(32))).toBeNull();
  });

  it('rejects a structurally malformed encrypted record', () => {
    expect(() => decryptString('enc1:onlyonepart', generateStorageKey())).toThrow(
      AtRestDecryptError,
    );
  });

  it('handles a large conversation history', () => {
    const key = generateStorageKey();
    const big = JSON.stringify(
      Array.from({length: 500}, (_, i) => ({id: i, text: `message number ${i}`})),
    );
    expect(decryptString(encryptString(big, key), key)).toBe(big);
  });
});
