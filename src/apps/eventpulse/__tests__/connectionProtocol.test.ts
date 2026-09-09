/**
 * ConnectionProtocol — the JSON payload of the three connection messages.
 *
 * The weight of this suite is deliberately lopsided. Encoding is our own bytes
 * going out; decoding is bytes an arbitrary stranger wrote to our RX
 * characteristic. So the encode tests establish the shape and the UTF-8
 * arithmetic, and everything after that is hostile input: malformed frames,
 * wrong types, oversized fields, unknown enum values, unknown extra keys, and
 * payloads designed to be expensive. The contract under all of it is the same
 * one the module's header states — a decoder returns null, it never throws.
 *
 * The byte caps are asserted at the limit, one under and one over, in bytes
 * rather than characters, because the check is a byte budget and a 2- or 4-byte
 * character is where a character-counting implementation would quietly diverge.
 *
 * Only ConnectionProtocol is imported. Nothing here reaches a transport, a
 * database, or react-native.
 */

import {
  CONNECTION_PROTOCOL_VERSION,
  decodeConnectionAccept,
  decodeConnectionReject,
  decodeConnectionRequest,
  encodeConnectionPayload,
  rejectReasonToSend,
} from '../connections/ConnectionProtocol';
import type {
  ConnectionAcceptPayload,
  ConnectionRejectPayload,
  ConnectionRejectReason,
  ConnectionRequestPayload,
} from '../connections/ConnectionProtocol';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

/**
 * An independent UTF-8 encoder, so tests that feed hand-written JSON to a
 * decoder do not route their input through the module under test. If the
 * production encoder were wrong, these bytes would still be right.
 */
function rawBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const point = ch.codePointAt(0);
    if (point === undefined) continue;
    if (point < 0x80) {
      out.push(point);
    } else if (point < 0x800) {
      out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      out.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Length of `text` in UTF-8 bytes, measured independently of the module. */
function utf8Length(text: string): number {
  return rawBytes(text).length;
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

const SENT_AT = 1_700_000_000_000;

type Fields = Record<string, unknown>;

function cardPayload(patch: Fields = {}): Fields {
  return { profileId: 'prof-1', name: 'Ana Lima', ...patch };
}

/**
 * A well-formed request, with `patch` merged over it. Setting a key to
 * `undefined` in `patch` removes it from the wire, because `JSON.stringify`
 * drops undefined values — that is how the "missing field" cases are built.
 */
function requestBytes(patch: Fields = {}): Uint8Array {
  return encodeConnectionPayload({
    v: CONNECTION_PROTOCOL_VERSION,
    requestId: 'req-1',
    card: cardPayload(),
    sentAt: SENT_AT,
    ...patch,
  });
}

function acceptBytes(patch: Fields = {}): Uint8Array {
  return encodeConnectionPayload({
    v: CONNECTION_PROTOCOL_VERSION,
    requestId: 'req-1',
    card: cardPayload(),
    acceptedAt: SENT_AT,
    ...patch,
  });
}

function rejectBytes(patch: Fields = {}): Uint8Array {
  return encodeConnectionPayload({
    v: CONNECTION_PROTOCOL_VERSION,
    requestId: 'req-1',
    reason: 'declined',
    rejectedAt: SENT_AT,
    ...patch,
  });
}

function mustDecodeRequest(bytes: Uint8Array): ConnectionRequestPayload {
  const decoded = decodeConnectionRequest(bytes);
  if (decoded === null) throw new Error('expected these bytes to decode as a request');
  return decoded;
}

function mustDecodeAccept(bytes: Uint8Array): ConnectionAcceptPayload {
  const decoded = decodeConnectionAccept(bytes);
  if (decoded === null) throw new Error('expected these bytes to decode as an accept');
  return decoded;
}

function mustDecodeReject(bytes: Uint8Array): ConnectionRejectPayload {
  const decoded = decodeConnectionReject(bytes);
  if (decoded === null) throw new Error('expected these bytes to decode as a reject');
  return decoded;
}

type Decoder = (bytes: Uint8Array) => object | null;

const DECODERS: Array<[string, Decoder]> = [
  ['decodeConnectionRequest', decodeConnectionRequest],
  ['decodeConnectionAccept', decodeConnectionAccept],
  ['decodeConnectionReject', decodeConnectionReject],
];

/** The documented caps, restated here so a silent change to them fails a test. */
const MAX_NAME_BYTES = 120;
const MAX_FIELD_BYTES = 160;
const MAX_NOTE_BYTES = 500;
const MAX_ID_BYTES = 128;

const ALL_REJECT_REASONS: ConnectionRejectReason[] = [
  'declined',
  'blocked',
  'not_accepting',
  'unknown',
];

/* ------------------------------------------------------------------ *
 * Version constant
 * ------------------------------------------------------------------ */

describe('CONNECTION_PROTOCOL_VERSION', () => {
  it('is 1, the value two independently built phones must already agree on', () => {
    expect(CONNECTION_PROTOCOL_VERSION).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

describe('encodeConnectionPayload', () => {
  it('emits the exact JSON bytes, with no framing of its own', () => {
    const bytes = encodeConnectionPayload({ v: 1, requestId: 'r' });
    expectSameBytes(bytes, rawBytes('{"v":1,"requestId":"r"}'));
  });

  it('spends 1 byte on ASCII, 2 on an accent, 3 on CJK and 4 on an emoji', () => {
    // Two bytes of every length below are the JSON quote pair around the string.
    expect(encodeConnectionPayload('a').length).toBe(3);
    expect(encodeConnectionPayload('é').length).toBe(4);
    expect(encodeConnectionPayload('张').length).toBe(5);
    expect(encodeConnectionPayload('😀').length).toBe(6);
  });

  it('returns a right-sized array rather than the oversized scratch buffer', () => {
    // The implementation allocates json.length * 4 and slices down to what it
    // wrote; a missing slice would show up as trailing zero bytes here.
    const bytes = encodeConnectionPayload('hi');
    expect(bytes.length).toBe(4);
    expect(Array.from(bytes)).toEqual([0x22, 0x68, 0x69, 0x22]);
  });
});

/* ------------------------------------------------------------------ *
 * Round trips
 * ------------------------------------------------------------------ */

describe('request round trip', () => {
  it('preserves every optional field when all of them are present', () => {
    const original: ConnectionRequestPayload = {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      card: {
        profileId: 'prof-xyz',
        name: 'Ana Lima',
        role: 'Staff Engineer',
        company: 'Northwind',
      },
      note: 'We met at the hallway track last year.',
      sentAt: SENT_AT,
    };
    const bytes = encodeConnectionPayload(original);

    expect(mustDecodeRequest(bytes)).toStrictEqual(original);
    // Byte-identical: re-encoding what came out reproduces what went in.
    expectSameBytes(encodeConnectionPayload(mustDecodeRequest(bytes)), bytes);
  });

  it('keeps note, role and company as explicit undefined when all are absent', () => {
    const bytes = encodeConnectionPayload({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      card: { profileId: 'prof-xyz', name: 'Ana Lima' },
      sentAt: SENT_AT,
    });

    expect(mustDecodeRequest(bytes)).toStrictEqual({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      card: {
        profileId: 'prof-xyz',
        name: 'Ana Lima',
        role: undefined,
        company: undefined,
      },
      note: undefined,
      sentAt: SENT_AT,
    });
    expectSameBytes(encodeConnectionPayload(mustDecodeRequest(bytes)), bytes);
  });

  it('carries a note when the sender wrote one and drops the key when they did not', () => {
    const withNote = mustDecodeRequest(requestBytes({ note: 'Following up on the demo.' }));
    const withoutNote = mustDecodeRequest(requestBytes());

    expect(withNote.note).toBe('Following up on the demo.');
    expect(withoutNote.note).toBeUndefined();
  });

  it('carries role and company together, and neither when the card omits both', () => {
    const full = mustDecodeRequest(
      requestBytes({ card: cardPayload({ role: 'Designer', company: 'Acme' }) }),
    );
    const bare = mustDecodeRequest(requestBytes());

    expect(full.card).toStrictEqual({
      profileId: 'prof-1',
      name: 'Ana Lima',
      role: 'Designer',
      company: 'Acme',
    });
    expect(bare.card).toStrictEqual({
      profileId: 'prof-1',
      name: 'Ana Lima',
      role: undefined,
      company: undefined,
    });
  });

  it('carries role alone and company alone', () => {
    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ role: 'PM' }) })).card,
    ).toStrictEqual({ profileId: 'prof-1', name: 'Ana Lima', role: 'PM', company: undefined });
    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ company: 'Acme' }) })).card,
    ).toStrictEqual({
      profileId: 'prof-1',
      name: 'Ana Lima',
      role: undefined,
      company: 'Acme',
    });
  });

  it('trims surrounding whitespace off every string it keeps', () => {
    const decoded = mustDecodeRequest(
      requestBytes({
        requestId: '  req-1  ',
        card: cardPayload({ name: '\t Ana Lima \n', role: '  PM  ', company: ' Acme ' }),
        note: '  hello  ',
      }),
    );

    expect(decoded.requestId).toBe('req-1');
    expect(decoded.card.name).toBe('Ana Lima');
    expect(decoded.card.role).toBe('PM');
    expect(decoded.card.company).toBe('Acme');
    expect(decoded.note).toBe('hello');
  });

  it('accepts a zero and a negative timestamp, which are finite numbers', () => {
    expect(mustDecodeRequest(requestBytes({ sentAt: 0 })).sentAt).toBe(0);
    expect(mustDecodeRequest(requestBytes({ sentAt: -1 })).sentAt).toBe(-1);
  });
});

describe('accept round trip', () => {
  it('preserves the accepter card with role and company present', () => {
    const original: ConnectionAcceptPayload = {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      card: {
        profileId: 'prof-accepter',
        name: 'Bo Chen',
        role: 'Recruiter',
        company: 'Northwind',
      },
      acceptedAt: SENT_AT,
    };
    const bytes = encodeConnectionPayload(original);

    expect(mustDecodeAccept(bytes)).toStrictEqual(original);
    expectSameBytes(encodeConnectionPayload(mustDecodeAccept(bytes)), bytes);
  });

  it('preserves a card with neither role nor company', () => {
    const bytes = encodeConnectionPayload({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      card: { profileId: 'prof-accepter', name: 'Bo Chen' },
      acceptedAt: SENT_AT,
    });

    expect(mustDecodeAccept(bytes)).toStrictEqual({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      card: {
        profileId: 'prof-accepter',
        name: 'Bo Chen',
        role: undefined,
        company: undefined,
      },
      acceptedAt: SENT_AT,
    });
    expectSameBytes(encodeConnectionPayload(mustDecodeAccept(bytes)), bytes);
  });
});

describe('reject round trip', () => {
  it.each(ALL_REJECT_REASONS)('preserves the reason %s exactly', (reason) => {
    const original: ConnectionRejectPayload = {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-abc-123',
      reason,
      rejectedAt: SENT_AT,
    };
    const bytes = encodeConnectionPayload(original);

    expect(mustDecodeReject(bytes)).toStrictEqual(original);
    expectSameBytes(encodeConnectionPayload(mustDecodeReject(bytes)), bytes);
  });

  it('needs no card, unlike a request or an accept', () => {
    expect(mustDecodeReject(rejectBytes())).toStrictEqual({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-1',
      reason: 'declined',
      rejectedAt: SENT_AT,
    });
  });
});

/* ------------------------------------------------------------------ *
 * UTF-8
 * ------------------------------------------------------------------ */

describe('UTF-8 fidelity', () => {
  const NAMES: Array<[string, string, number]> = [
    // Byte lengths spelled out so the cases stay honest about what they exercise:
    // 2-byte accents, 3-byte CJK and en dash, and a 4-byte astral character.
    ['accented Latin', 'José Álvarez-Muñoz', 21],
    ['CJK', '张伟', 6],
    ['an emoji', 'Ana 😀', 8],
    ['mixed scripts and an astral character', 'Łukasz – 中文 🎉', 23],
  ];

  it.each(NAMES)(
    'a name in %s survives encode -> decode unchanged',
    (_label, name, byteLength) => {
      expect(utf8Length(name)).toBe(byteLength);

      const decoded = mustDecodeRequest(requestBytes({ card: cardPayload({ name }) }));

      expect(decoded.card.name).toBe(name);
      expect(decoded.card.name.length).toBe(name.length);
    },
  );

  it('re-encodes a payload full of non-ASCII text to byte-identical bytes', () => {
    const original: ConnectionRequestPayload = {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-é-1',
      card: {
        profileId: 'prof-中-1',
        name: 'José 😀',
        role: 'エンジニア',
        company: 'Café – Nord',
      },
      note: '你好! 🎉 Nice to meet you.',
      sentAt: SENT_AT,
    };
    const bytes = encodeConnectionPayload(original);

    expect(mustDecodeRequest(bytes)).toStrictEqual(original);
    expectSameBytes(encodeConnectionPayload(mustDecodeRequest(bytes)), bytes);
    // And the bytes really are UTF-8, not a private encoding the module only
    // agrees with itself about.
    expectSameBytes(bytes, rawBytes(JSON.stringify(original)));
  });

  it('keeps a surrogate pair intact rather than splitting it into two characters', () => {
    const name = '😀😀';
    const decoded = mustDecodeRequest(requestBytes({ card: cardPayload({ name }) }));

    expect(decoded.card.name).toBe(name);
    expect(Array.from(decoded.card.name).length).toBe(2);
    expect(decoded.card.name.codePointAt(0)).toBe(0x1f600);
  });
});

/* ------------------------------------------------------------------ *
 * Malformed input — every decoder, never a throw
 * ------------------------------------------------------------------ */

const HOSTILE_BYTES: Array<[string, Uint8Array]> = [
  ['empty bytes', new Uint8Array(0)],
  ['a single "{" byte', Uint8Array.from([0x7b])],
  ['a single "1" byte, which parses as a bare number', Uint8Array.from([0x31])],
  ['a single NUL byte', Uint8Array.from([0x00])],
  ['non-JSON text', rawBytes('this is not json')],
  ['raw binary noise', Uint8Array.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f])],
  ['a truncated multi-byte sequence', Uint8Array.from([0xe2, 0x82])],
  ['a lone continuation byte', Uint8Array.from([0x80])],
  ['JSON that is an array', rawBytes('[1,2,3]')],
  ['JSON that is an empty array', rawBytes('[]')],
  ['JSON that is an array of valid-looking payloads', rawBytes('[{"v":1,"requestId":"r"}]')],
  ['JSON that is a number', rawBytes('42')],
  ['JSON that is a string', rawBytes('"hello"')],
  ['JSON that is null', rawBytes('null')],
  ['JSON that is true', rawBytes('true')],
  ['an unterminated object', rawBytes('{"v":1')],
  ['an empty object', rawBytes('{}')],
];

describe.each(DECODERS)('%s on hostile bytes', (_name, decode) => {
  it.each(HOSTILE_BYTES)('returns null, without throwing, for %s', (_label, bytes) => {
    let result: object | null = {};
    expect(() => {
      result = decode(bytes);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

describe('decodeConnectionRequest rejects structurally invalid payloads', () => {
  const BAD_REQUESTS: Array<[string, Uint8Array]> = [
    ['v is missing', requestBytes({ v: undefined })],
    ['v is 0', requestBytes({ v: 0 })],
    ['v is 2', requestBytes({ v: 2 })],
    ['v is 1.5', requestBytes({ v: 1.5 })],
    ['v is the string "1"', requestBytes({ v: '1' })],
    ['v is null', requestBytes({ v: null })],
    ['v is true', requestBytes({ v: true })],
    [
      'v overflows to Infinity',
      rawBytes('{"v":1e400,"requestId":"r","card":{"profileId":"p","name":"A"},"sentAt":1}'),
    ],
    ['requestId is missing', requestBytes({ requestId: undefined })],
    ['requestId is null', requestBytes({ requestId: null })],
    ['requestId is a number', requestBytes({ requestId: 7 })],
    ['requestId is empty', requestBytes({ requestId: '' })],
    ['requestId is whitespace only', requestBytes({ requestId: '   \t\n  ' })],
    ['card is missing', requestBytes({ card: undefined })],
    ['card is null', requestBytes({ card: null })],
    ['card is an array', requestBytes({ card: [] })],
    ['card is a string', requestBytes({ card: 'Ana Lima' })],
    ['card is missing profileId', requestBytes({ card: cardPayload({ profileId: undefined }) })],
    ['card profileId is empty', requestBytes({ card: cardPayload({ profileId: '' }) })],
    ['card profileId is a number', requestBytes({ card: cardPayload({ profileId: 42 }) })],
    ['card is missing name', requestBytes({ card: cardPayload({ name: undefined }) })],
    ['card name is null', requestBytes({ card: cardPayload({ name: null }) })],
    ['card name is a number', requestBytes({ card: cardPayload({ name: 42 }) })],
    ['card name is an object', requestBytes({ card: cardPayload({ name: { first: 'Ana' } }) })],
    ['card name is an array', requestBytes({ card: cardPayload({ name: ['Ana'] }) })],
    ['card name is empty', requestBytes({ card: cardPayload({ name: '' }) })],
    ['card name is whitespace only', requestBytes({ card: cardPayload({ name: '   \t\n  ' }) })],
    ['card name is a single space', requestBytes({ card: cardPayload({ name: ' ' }) })],
    ['sentAt is missing', requestBytes({ sentAt: undefined })],
    ['sentAt is null', requestBytes({ sentAt: null })],
    ['sentAt is a string', requestBytes({ sentAt: '1700000000000' })],
    ['sentAt is a boolean', requestBytes({ sentAt: true })],
    // JSON has no NaN or Infinity literal, so a non-finite timestamp reaches the
    // wire one of two ways: JSON.stringify turns it into null, or a hand-written
    // frame spells it out and either fails to parse or overflows. All refused.
    ['sentAt was NaN and stringified to null', requestBytes({ sentAt: Number.NaN })],
    [
      'sentAt was Infinity and stringified to null',
      requestBytes({ sentAt: Number.POSITIVE_INFINITY }),
    ],
    [
      'sentAt is a literal NaN token',
      rawBytes('{"v":1,"requestId":"r","card":{"profileId":"p","name":"A"},"sentAt":NaN}'),
    ],
    [
      'sentAt overflows to Infinity',
      rawBytes('{"v":1,"requestId":"r","card":{"profileId":"p","name":"A"},"sentAt":1e400}'),
    ],
    [
      'sentAt overflows to -Infinity',
      rawBytes('{"v":1,"requestId":"r","card":{"profileId":"p","name":"A"},"sentAt":-1e400}'),
    ],
  ];

  it.each(BAD_REQUESTS)('returns null when %s', (_label, bytes) => {
    expect(decodeConnectionRequest(bytes)).toBeNull();
  });

  it('accepts the same base payload it rejects with each field broken', () => {
    // Guards the table above: every row must fail for the reason named, not
    // because the baseline was invalid to begin with.
    expect(decodeConnectionRequest(requestBytes())).not.toBeNull();
  });
});

describe('decodeConnectionAccept rejects structurally invalid payloads', () => {
  const BAD_ACCEPTS: Array<[string, Uint8Array]> = [
    ['v is missing', acceptBytes({ v: undefined })],
    ['v is 2', acceptBytes({ v: 2 })],
    ['v is the string "1"', acceptBytes({ v: '1' })],
    ['requestId is missing', acceptBytes({ requestId: undefined })],
    ['requestId is whitespace only', acceptBytes({ requestId: '  ' })],
    ['requestId is a number', acceptBytes({ requestId: 7 })],
    ['card is missing', acceptBytes({ card: undefined })],
    ['card is an array', acceptBytes({ card: [] })],
    ['card is missing profileId', acceptBytes({ card: cardPayload({ profileId: undefined }) })],
    ['card is missing name', acceptBytes({ card: cardPayload({ name: undefined }) })],
    ['card name is a number', acceptBytes({ card: cardPayload({ name: 42 }) })],
    ['card name is whitespace only', acceptBytes({ card: cardPayload({ name: '\t\n ' }) })],
    ['acceptedAt is missing', acceptBytes({ acceptedAt: undefined })],
    ['acceptedAt is a string', acceptBytes({ acceptedAt: 'now' })],
    ['acceptedAt was NaN and stringified to null', acceptBytes({ acceptedAt: Number.NaN })],
    [
      'acceptedAt overflows to Infinity',
      rawBytes('{"v":1,"requestId":"r","card":{"profileId":"p","name":"A"},"acceptedAt":1e400}'),
    ],
    ['a request payload is fed to the accept decoder', requestBytes()],
  ];

  it.each(BAD_ACCEPTS)('returns null when %s', (_label, bytes) => {
    expect(decodeConnectionAccept(bytes)).toBeNull();
  });

  it('accepts the unbroken base payload', () => {
    expect(decodeConnectionAccept(acceptBytes())).not.toBeNull();
  });
});

describe('decodeConnectionReject rejects structurally invalid payloads', () => {
  const BAD_REJECTS: Array<[string, Uint8Array]> = [
    ['v is missing', rejectBytes({ v: undefined })],
    ['v is 2', rejectBytes({ v: 2 })],
    ['v is null', rejectBytes({ v: null })],
    ['requestId is missing', rejectBytes({ requestId: undefined })],
    ['requestId is empty', rejectBytes({ requestId: '' })],
    ['requestId is whitespace only', rejectBytes({ requestId: '   ' })],
    ['requestId is a number', rejectBytes({ requestId: 7 })],
    ['rejectedAt is missing', rejectBytes({ rejectedAt: undefined })],
    ['rejectedAt is a string', rejectBytes({ rejectedAt: 'now' })],
    ['rejectedAt was NaN and stringified to null', rejectBytes({ rejectedAt: Number.NaN })],
    [
      'rejectedAt overflows to Infinity',
      rawBytes('{"v":1,"requestId":"r","reason":"declined","rejectedAt":1e400}'),
    ],
  ];

  it.each(BAD_REJECTS)('returns null when %s', (_label, bytes) => {
    expect(decodeConnectionReject(bytes)).toBeNull();
  });

  it('accepts the unbroken base payload', () => {
    expect(decodeConnectionReject(rejectBytes())).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Byte caps
 * ------------------------------------------------------------------ */

describe('byte caps on identifying fields reject the whole payload', () => {
  it('accepts a name of exactly the cap and rejects one byte more', () => {
    const atCap = 'a'.repeat(MAX_NAME_BYTES);
    const underCap = 'a'.repeat(MAX_NAME_BYTES - 1);
    const overCap = 'a'.repeat(MAX_NAME_BYTES + 1);

    expect(utf8Length(atCap)).toBe(120);
    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ name: underCap }) })).card.name,
    ).toBe(underCap);
    expect(mustDecodeRequest(requestBytes({ card: cardPayload({ name: atCap }) })).card.name).toBe(
      atCap,
    );
    expect(
      decodeConnectionRequest(requestBytes({ card: cardPayload({ name: overCap }) })),
    ).toBeNull();
  });

  it('measures the name cap in bytes, not characters, for 2-byte characters', () => {
    const atCap = 'é'.repeat(60);
    const overCap = 'é'.repeat(61);

    expect(utf8Length(atCap)).toBe(120);
    expect(utf8Length(overCap)).toBe(122);
    expect(atCap.length).toBe(60);

    expect(mustDecodeRequest(requestBytes({ card: cardPayload({ name: atCap }) })).card.name).toBe(
      atCap,
    );
    expect(
      decodeConnectionRequest(requestBytes({ card: cardPayload({ name: overCap }) })),
    ).toBeNull();
    // 120 accented characters is 240 bytes: twice the budget, so refused even
    // though a character count would have waved it through.
    expect(
      decodeConnectionRequest(requestBytes({ card: cardPayload({ name: 'é'.repeat(120) }) })),
    ).toBeNull();
  });

  it('measures the name cap in bytes for 4-byte emoji', () => {
    const atCap = '😀'.repeat(30);
    const overCap = '😀'.repeat(31);

    expect(utf8Length(atCap)).toBe(120);
    expect(mustDecodeRequest(requestBytes({ card: cardPayload({ name: atCap }) })).card.name).toBe(
      atCap,
    );
    expect(
      decodeConnectionRequest(requestBytes({ card: cardPayload({ name: overCap }) })),
    ).toBeNull();
  });

  it('rejects a name far over the cap rather than truncating it', () => {
    expect(
      decodeConnectionRequest(requestBytes({ card: cardPayload({ name: 'n'.repeat(50_000) }) })),
    ).toBeNull();
  });

  it('applies the name cap to the accept card too', () => {
    expect(
      decodeConnectionAccept(acceptBytes({ card: cardPayload({ name: 'a'.repeat(121) }) })),
    ).toBeNull();
    expect(
      mustDecodeAccept(acceptBytes({ card: cardPayload({ name: 'a'.repeat(120) }) })).card.name
        .length,
    ).toBe(120);
  });

  it('accepts a profileId of exactly the cap and rejects one byte more', () => {
    const atCap = 'p'.repeat(MAX_ID_BYTES);
    const overCap = 'p'.repeat(MAX_ID_BYTES + 1);

    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ profileId: 'p'.repeat(127) }) })).card
        .profileId.length,
    ).toBe(127);
    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ profileId: atCap }) })).card.profileId,
    ).toBe(atCap);
    expect(
      decodeConnectionRequest(requestBytes({ card: cardPayload({ profileId: overCap }) })),
    ).toBeNull();
    expect(
      decodeConnectionRequest(
        requestBytes({ card: cardPayload({ profileId: 'p'.repeat(20_000) }) }),
      ),
    ).toBeNull();
  });

  it('accepts a requestId of exactly the cap and rejects one byte more, on all three messages', () => {
    const atCap = 'r'.repeat(MAX_ID_BYTES);
    const overCap = 'r'.repeat(MAX_ID_BYTES + 1);
    const wayOver = 'r'.repeat(20_000);

    expect(mustDecodeRequest(requestBytes({ requestId: 'r'.repeat(127) })).requestId.length).toBe(
      127,
    );
    expect(mustDecodeRequest(requestBytes({ requestId: atCap })).requestId).toBe(atCap);
    expect(decodeConnectionRequest(requestBytes({ requestId: overCap }))).toBeNull();
    expect(decodeConnectionRequest(requestBytes({ requestId: wayOver }))).toBeNull();

    expect(mustDecodeAccept(acceptBytes({ requestId: atCap })).requestId).toBe(atCap);
    expect(decodeConnectionAccept(acceptBytes({ requestId: overCap }))).toBeNull();

    expect(mustDecodeReject(rejectBytes({ requestId: atCap })).requestId).toBe(atCap);
    expect(decodeConnectionReject(rejectBytes({ requestId: overCap }))).toBeNull();
  });
});

describe('byte caps on decorative fields drop the field and keep the payload', () => {
  it('keeps a role of exactly the cap and silently drops one byte more', () => {
    const atCap = 'x'.repeat(MAX_FIELD_BYTES);
    const overCap = 'x'.repeat(MAX_FIELD_BYTES + 1);

    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ role: 'x'.repeat(159) }) })).card.role
        ?.length,
    ).toBe(159);
    expect(mustDecodeRequest(requestBytes({ card: cardPayload({ role: atCap }) })).card.role).toBe(
      atCap,
    );

    // Over the cap the role vanishes but the request survives: an oversized
    // decoration must not cost us a legitimate connection request.
    const oversized = mustDecodeRequest(requestBytes({ card: cardPayload({ role: overCap }) }));
    expect(oversized.card.role).toBeUndefined();
    expect(oversized.card.name).toBe('Ana Lima');
    expect(oversized.requestId).toBe('req-1');
  });

  it('keeps a company of exactly the cap and silently drops one byte more', () => {
    const atCap = 'y'.repeat(MAX_FIELD_BYTES);
    const overCap = 'y'.repeat(MAX_FIELD_BYTES + 1);

    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ company: atCap }) })).card.company,
    ).toBe(atCap);
    expect(
      mustDecodeRequest(requestBytes({ card: cardPayload({ company: overCap }) })).card.company,
    ).toBeUndefined();
  });

  it('drops a role or company that is far over the cap without throwing', () => {
    const decoded = mustDecodeRequest(
      requestBytes({
        card: cardPayload({ role: 'x'.repeat(50_000), company: 'y'.repeat(50_000) }),
      }),
    );

    expect(decoded.card).toStrictEqual({
      profileId: 'prof-1',
      name: 'Ana Lima',
      role: undefined,
      company: undefined,
    });
  });

  it('drops role and company that are the wrong type or blank, keeping the card', () => {
    const decoded = mustDecodeRequest(
      requestBytes({ card: cardPayload({ role: 42, company: '   ' }) }),
    );

    expect(decoded.card.role).toBeUndefined();
    expect(decoded.card.company).toBeUndefined();
    expect(decoded.card.name).toBe('Ana Lima');
  });

  it('keeps a note of exactly the cap and silently drops one byte more', () => {
    const atCap = 'n'.repeat(MAX_NOTE_BYTES);
    const overCap = 'n'.repeat(MAX_NOTE_BYTES + 1);

    expect(mustDecodeRequest(requestBytes({ note: 'n'.repeat(499) })).note?.length).toBe(499);
    expect(mustDecodeRequest(requestBytes({ note: atCap })).note).toBe(atCap);

    const oversized = mustDecodeRequest(requestBytes({ note: overCap }));
    expect(oversized.note).toBeUndefined();
    expect(oversized.sentAt).toBe(SENT_AT);
  });

  it('measures the note cap in bytes, so 250 accented characters fit and 251 do not', () => {
    const atCap = 'é'.repeat(250);
    const overCap = 'é'.repeat(251);

    expect(utf8Length(atCap)).toBe(500);
    expect(mustDecodeRequest(requestBytes({ note: atCap })).note).toBe(atCap);
    expect(mustDecodeRequest(requestBytes({ note: overCap })).note).toBeUndefined();
  });

  it('drops a note far over the cap without throwing or rejecting the request', () => {
    const decoded = mustDecodeRequest(requestBytes({ note: 'n'.repeat(100_000) }));

    expect(decoded.note).toBeUndefined();
    expect(decoded.card.name).toBe('Ana Lima');
  });

  it('drops a note of the wrong type', () => {
    expect(mustDecodeRequest(requestBytes({ note: 42 })).note).toBeUndefined();
    expect(mustDecodeRequest(requestBytes({ note: { text: 'hi' } })).note).toBeUndefined();
    expect(mustDecodeRequest(requestBytes({ note: ['hi'] })).note).toBeUndefined();
    expect(mustDecodeRequest(requestBytes({ note: null })).note).toBeUndefined();
    expect(mustDecodeRequest(requestBytes({ note: '   ' })).note).toBeUndefined();
  });

  it('an accept ignores a note entirely, since accepts carry none', () => {
    const decoded = mustDecodeAccept(acceptBytes({ note: 'n'.repeat(100_000) }));

    expect(decoded).toStrictEqual({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-1',
      card: { profileId: 'prof-1', name: 'Ana Lima', role: undefined, company: undefined },
      acceptedAt: SENT_AT,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Reject reasons
 * ------------------------------------------------------------------ */

describe('reject reasons are never trusted verbatim', () => {
  const UNKNOWN_REASONS: Array<[string, unknown]> = [
    ['an invented reason', 'because_i_said_so'],
    ['a reason in the wrong case', 'DECLINED'],
    ['a reason with padding', ' declined '],
    ['a number', 7],
    ['a boolean', true],
    ['null', null],
    ['an object', { reason: 'declined' }],
    ['an array holding a valid reason', ['declined']],
    ['an empty string', ''],
  ];

  it.each(UNKNOWN_REASONS)('decodes %s as "unknown"', (_label, reason) => {
    expect(mustDecodeReject(rejectBytes({ reason })).reason).toBe('unknown');
  });

  it('decodes a missing reason as "unknown" rather than failing the payload', () => {
    const decoded = mustDecodeReject(rejectBytes({ reason: undefined }));

    expect(decoded.reason).toBe('unknown');
    expect(decoded.requestId).toBe('req-1');
  });

  it.each(ALL_REJECT_REASONS)('passes the known reason %s through unchanged', (reason) => {
    expect(mustDecodeReject(rejectBytes({ reason })).reason).toBe(reason);
  });
});

describe('rejectReasonToSend', () => {
  /**
   * Why 'blocked' and 'not_accepting' both leave as a plain 'declined':
   * a phone that answered "you are blocked" would confirm to the person being
   * avoided that they had been seen and singled out — exactly the signal a
   * harasser is fishing for. 'not_accepting' leaks nearly as much, since in
   * practice it is set with a particular person in mind. Both collapse into the
   * ordinary decline, which is indistinguishable from a routine no.
   */
  it('turns a block into an ordinary decline', () => {
    expect(rejectReasonToSend('blocked')).toBe('declined');
  });

  it('turns "not accepting" into an ordinary decline', () => {
    expect(rejectReasonToSend('not_accepting')).toBe('declined');
  });

  it('passes "declined" through unchanged', () => {
    expect(rejectReasonToSend('declined')).toBe('declined');
  });

  it('passes "unknown" through unchanged', () => {
    expect(rejectReasonToSend('unknown')).toBe('unknown');
  });

  it('maps the entire reason space to exactly declined, declined, declined, unknown', () => {
    expect(ALL_REJECT_REASONS.map(rejectReasonToSend)).toEqual([
      'declined',
      'declined',
      'declined',
      'unknown',
    ]);
  });

  it('has no input at all that produces "blocked" on the wire', () => {
    // Exhaustive over the union: it has only four inhabitants, and none of them
    // survives as 'blocked'.
    for (const reason of ALL_REJECT_REASONS) {
      expect(rejectReasonToSend(reason)).not.toBe('blocked');
    }
  });

  it('is idempotent, so a re-sent rejection cannot leak more than the first', () => {
    for (const reason of ALL_REJECT_REASONS) {
      const once = rejectReasonToSend(reason);
      expect(rejectReasonToSend(once)).toBe(once);
    }
  });

  it('end to end, a blocked rejection arrives at the peer reading "declined"', () => {
    const onWire = rejectReasonToSend('blocked');
    const bytes = rejectBytes({ reason: onWire });

    expect(mustDecodeReject(bytes).reason).toBe('declined');
    // And the word never appears in the bytes that leave the phone.
    expect(Array.from(bytes).join(',')).not.toContain(Array.from(rawBytes('blocked')).join(','));
  });
});

/* ------------------------------------------------------------------ *
 * Forward compatibility
 * ------------------------------------------------------------------ */

describe('forward compatibility', () => {
  it('ignores unknown top-level fields in a request', () => {
    const decoded = mustDecodeRequest(
      requestBytes({ avatarUrl: 'https://example.invalid/a.png', ttl: 30, tags: ['a', 'b'] }),
    );

    expect(decoded).toStrictEqual({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-1',
      card: { profileId: 'prof-1', name: 'Ana Lima', role: undefined, company: undefined },
      note: undefined,
      sentAt: SENT_AT,
    });
  });

  it('ignores unknown card fields', () => {
    const decoded = mustDecodeRequest(
      requestBytes({
        card: cardPayload({ email: 'ana@example.invalid', pronouns: 'she/her', avatar: null }),
      }),
    );

    expect(decoded.card).toStrictEqual({
      profileId: 'prof-1',
      name: 'Ana Lima',
      role: undefined,
      company: undefined,
    });
  });

  it('ignores unknown fields on an accept and a reject', () => {
    expect(mustDecodeAccept(acceptBytes({ mood: 'delighted' })).requestId).toBe('req-1');
    expect(mustDecodeReject(rejectBytes({ explanation: 'busy', retryAfter: 60 })).reason).toBe(
      'declined',
    );
  });

  it('ignores a "__proto__" key rather than letting it reach the result prototype', () => {
    const bytes = rawBytes(
      '{"v":1,"requestId":"r","card":{"profileId":"p","name":"A"},"sentAt":1,"__proto__":{"polluted":true}}',
    );
    const decoded = mustDecodeRequest(bytes);

    expect(decoded.requestId).toBe('r');
    expect(Object.prototype.hasOwnProperty.call(decoded, 'polluted')).toBe(false);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  });
});

/* ------------------------------------------------------------------ *
 * Expensive payloads
 * ------------------------------------------------------------------ */

describe('expensive payloads are refused rather than fatal', () => {
  it('survives 5000 levels of nested arrays', () => {
    const bytes = rawBytes('['.repeat(5000) + ']'.repeat(5000));

    expect(() => decodeConnectionRequest(bytes)).not.toThrow();
    expect(decodeConnectionRequest(bytes)).toBeNull();
    expect(decodeConnectionAccept(bytes)).toBeNull();
    expect(decodeConnectionReject(bytes)).toBeNull();
  });

  it('survives 5000 levels of nested objects', () => {
    const bytes = rawBytes('{"a":'.repeat(5000) + '1' + '}'.repeat(5000));

    expect(() => decodeConnectionRequest(bytes)).not.toThrow();
    expect(decodeConnectionRequest(bytes)).toBeNull();
    expect(decodeConnectionAccept(bytes)).toBeNull();
    expect(decodeConnectionReject(bytes)).toBeNull();
  });

  it('survives a deeply nested value hanging off an otherwise valid request', () => {
    const nested = '['.repeat(2000) + ']'.repeat(2000);
    const bytes = rawBytes(
      '{"v":1,"requestId":"r","card":{"profileId":"p","name":"A"},"sentAt":1,"junk":' + nested + '}',
    );

    // Whether the parser accepts this depth is an engine detail; not throwing is
    // not. Either outcome is fine as long as it is one of the two documented
    // ones: a decoded request, or null.
    const attempt = (): ConnectionRequestPayload | null => decodeConnectionRequest(bytes);

    expect(attempt).not.toThrow();
    const decoded = attempt();
    expect(decoded === null || decoded.requestId === 'r').toBe(true);
  });

  it('decodes a valid request carrying a 200 KB unknown field, keeping only the known ones', () => {
    const decoded = mustDecodeRequest(requestBytes({ junk: 'z'.repeat(200_000) }));

    expect(decoded).toStrictEqual({
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-1',
      card: { profileId: 'prof-1', name: 'Ana Lima', role: undefined, company: undefined },
      note: undefined,
      sentAt: SENT_AT,
    });
  });

  it('returns null, without throwing, for 200 KB of non-JSON bytes', () => {
    const bytes = rawBytes('z'.repeat(200_000));

    expect(() => decodeConnectionRequest(bytes)).not.toThrow();
    expect(decodeConnectionRequest(bytes)).toBeNull();
  });

  it('returns null, without throwing, for a large array of objects', () => {
    const bytes = rawBytes('[' + '{"v":1},'.repeat(9_999) + '{"v":1}]');

    expect(() => decodeConnectionReject(bytes)).not.toThrow();
    expect(decodeConnectionReject(bytes)).toBeNull();
  });
});
