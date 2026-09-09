import { decode, encode, MAX_PAYLOAD, Msg } from '../ble/protocol';

/**
 * Both ends of a real link are separate installs that may not be the same
 * build. Everything here is about that: a message either survives the round
 * trip exactly, or it is rejected outright — a half-parsed 'go' would open a
 * round with a target nobody can reach.
 */

const roundTrip = (msg: Msg): Msg | null => decode(encode(msg));

describe('protocol', () => {
  it('marks which hello came from the host', () => {
    const host: Msg = { t: 'hello', id: 'p-abc123', nm: 'Priya', h: true };
    expect(roundTrip(host)).toEqual(host);

    const peer: Msg = { t: 'hello', id: 'p-def456', nm: 'Kenji' };
    const decoded = roundTrip(peer);
    expect(decoded).toEqual(peer);
    // Absent rather than false: only the host ever sets it.
    expect(decoded && 'h' in decoded).toBe(false);
  });

  it('carries the room the host actually opened, not the one advertised', () => {
    const room: Msg = { t: 'room', ct: 'K7QM', hn: 'Priya', cap: 6, lo: 1, hi: 10000 };
    expect(roundTrip(room)).toEqual(room);
  });

  it('turns a joiner away from a full room', () => {
    expect(roundTrip({ t: 'full' })).toEqual({ t: 'full' });
  });

  it('rejects a room message missing a field rather than defaulting it', () => {
    expect(decode('{"t":"room","ct":"K7QM","hn":"Priya","cap":4}')).toBeNull();
    expect(decode('{"t":"room","ct":"K7QM","hn":"Priya","cap":"four","lo":1,"hi":100}')).toBeNull();
  });

  it('rejects a hello with no name rather than seating an anonymous player', () => {
    expect(decode('{"t":"hello","id":"p-abc123"}')).toBeNull();
  });

  it('drops a garbled packet instead of throwing on it', () => {
    expect(decode('{ not json')).toBeNull();
    expect(decode('null')).toBeNull();
    expect(decode('{"t":"nonsense"}')).toBeNull();
  });

  it('refuses to put an oversized message on the air', () => {
    const huge: Msg = { t: 'hello', id: 'p-abc123', nm: 'n'.repeat(MAX_PAYLOAD) };
    expect(() => encode(huge)).toThrow(/too large/);
  });
});
