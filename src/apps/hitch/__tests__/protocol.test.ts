/**
 * The three messages that arrange a ride between two phones.
 *
 * Phase 3's wire format. Two properties matter more than anything else here:
 *
 *  1. IT FITS IN ONE FRAME. The whole design rests on a request being small enough for a
 *     single GATT write, because that removes fragmentation, reassembly, ordering and
 *     retransmission along with every failure they bring. If a field is added later that
 *     breaks that, this suite fails rather than the link quietly truncating.
 *  2. IT NEVER THROWS ON RUBBISH. Frames arrive from a stranger's phone into a radio
 *     callback. An exception there takes the link down, so a malformed frame has to be
 *     "not a message" rather than an error.
 */
import {
  MAX_FRAME_BYTES,
  decodeMessage,
  frameBytes,
  encodeMessage,
  fitsOneFrame,
  newRequestId,
  type RideRequestMessage,
} from '../ble/protocol';

const REQUEST: RideRequestMessage = {
  t: 'REQUEST',
  v: 1,
  id: 'abc12345',
  from: 'Yogita',
  fromId: '62119f21',
  mode: 'ride',
  kind: 'auto',
  pickup: 'Main Gate',
  drop: 'Cyber Hub',
  km: 8.4,
  fare: 120,
};

describe('a ride request on the wire', () => {
  it('survives the round trip', () => {
    const decoded = decodeMessage(encodeMessage(REQUEST));
    expect(decoded).toEqual(REQUEST);
  });

  it('carries a parcel when there is one', () => {
    const parcelRequest: RideRequestMessage = {
      ...REQUEST,
      mode: 'parcel',
      parcel: {size: 'medium', contents: 'documents', receiver: 'Ankit'},
    };
    const decoded = decodeMessage(encodeMessage(parcelRequest));
    expect(decoded).toEqual(parcelRequest);
  });

  it('fits in one write, even at every field\'s maximum', () => {
    // The load-bearing assertion. Long names, long place names, a parcel description —
    // everything at once, which is the worst case a real request can be.
    const worst: RideRequestMessage = {
      ...REQUEST,
      from: 'x'.repeat(100),
      fromId: 'f'.repeat(64),
      pickup: 'p'.repeat(200),
      drop: 'd'.repeat(200),
      mode: 'parcel',
      parcel: {
        size: 'large',
        contents: 'c'.repeat(200),
        receiver: 'r'.repeat(100),
      },
    };
    const encoded = encodeMessage(worst);
    expect(fitsOneFrame(encoded)).toBe(true);
    // Bytes on the radio, not characters in the base64 string — the native module decodes
    // before it writes, so the string is a third larger than what is transmitted.
    expect(frameBytes(encoded)).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  it('caps every field on the way out rather than trusting the caller', () => {
    const decoded = decodeMessage(
      encodeMessage({...REQUEST, from: 'y'.repeat(100), pickup: 'z'.repeat(100)}),
    ) as RideRequestMessage;
    expect(decoded.from.length).toBeLessThanOrEqual(24);
    expect(decoded.pickup.length).toBeLessThanOrEqual(40);
  });

  it('bounds numbers a rider is shown', () => {
    // A fare of NaN or 1e9 in a decision card is worse than no number.
    const mad = decodeMessage(
      encodeMessage({...REQUEST, km: 1e9, fare: Number.NaN}),
    ) as RideRequestMessage;
    expect(Number.isFinite(mad.km)).toBe(true);
    expect(mad.km).toBeLessThanOrEqual(500);
    expect(Number.isFinite(mad.fare)).toBe(true);
  });

  it('survives non-ASCII in a name', () => {
    const decoded = decodeMessage(
      encodeMessage({...REQUEST, from: 'योगिता'}),
    ) as RideRequestMessage;
    expect(decoded.from).toBe('योगिता');
  });
});

describe('answers', () => {
  it('round-trips an accept with the vehicle a passenger will look for', () => {
    const decoded = decodeMessage(
      encodeMessage({
        t: 'ACCEPT',
        v: 1,
        id: 'abc12345',
        from: 'Imran',
        plate: 'HR 30 JN 8646',
        model: 'Bajaj RE',
        colour: 'Black & yellow',
      }),
    );
    expect(decoded).toMatchObject({t: 'ACCEPT', plate: 'HR 30 JN 8646'});
  });

  it('round-trips a decline, with and without a reason', () => {
    expect(decodeMessage(encodeMessage({t: 'DECLINE', v: 1, id: 'a'}))).toMatchObject({
      t: 'DECLINE',
    });
    const withWhy = decodeMessage(
      encodeMessage({t: 'DECLINE', v: 1, id: 'a', why: 'On another ride'}),
    );
    expect(withWhy).toMatchObject({why: 'On another ride'});
  });
});

describe('frames that are not messages', () => {
  it('returns null instead of throwing, for everything a street can produce', () => {
    const rubbish = [
      '',
      'not base64 at all!!',
      Buffer.from('{}').toString('base64'),
      Buffer.from('null').toString('base64'),
      Buffer.from('[]').toString('base64'),
      Buffer.from('{"t":"REQUEST"}').toString('base64'),
      Buffer.from('{"t":"UNKNOWN","id":"x"}').toString('base64'),
      Buffer.from('{"id":"x"}').toString('base64'),
      Buffer.from('not json').toString('base64'),
    ];
    for (const frame of rubbish) {
      expect(() => decodeMessage(frame)).not.toThrow();
      expect(decodeMessage(frame)).toBeNull();
    }
  });

  it('rejects a request with no route in it', () => {
    // Pickup and destination are the two things the rider's decision turns on.
    const noRoute = Buffer.from(
      JSON.stringify({t: 'REQUEST', id: 'x', from: 'A'}),
    ).toString('base64');
    expect(decodeMessage(noRoute)).toBeNull();
  });

  it('falls back rather than trusting an unknown vehicle kind', () => {
    const odd = Buffer.from(
      JSON.stringify({t: 'REQUEST', id: 'x', pickup: 'a', drop: 'b', kind: 'hovercraft'}),
    ).toString('base64');
    const decoded = decodeMessage(odd) as RideRequestMessage;
    expect(['bike', 'auto', 'cab', 'other']).toContain(decoded.kind);
  });
});

describe('request ids', () => {
  it('are distinct, so a stale reply cannot be mistaken for this one', () => {
    const ids = new Set(Array.from({length: 500}, newRequestId));
    expect(ids.size).toBeGreaterThan(490);
  });
});
