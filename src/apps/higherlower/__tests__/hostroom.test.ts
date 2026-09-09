import { HostRoom, RoomSettings } from '../ble/hostRoom';
import { Msg } from '../ble/protocol';

/**
 * Three phones in a room, with the radio taken out.
 *
 * BLE gives the host a separate link to each joiner and gives the joiners
 * nothing to each other, so everything anybody except the host sees is a
 * consequence of what the host chose to forward. That makes this the one place
 * where "did Kenji see Ava's guess?" is a question with a testable answer
 * rather than a question about where two people were standing.
 */

const SETTINGS: RoomSettings = {
  code: 'K7QM',
  hostName: 'Priya',
  capacity: 3,
  range: { min: 1, max: 100 },
};

interface Sent {
  to: string;
  msg: Msg;
}

function makeRoom(settings: Partial<RoomSettings> = {}) {
  const sent: Sent[] = [];
  const local: Msg[] = [];
  let advertRefreshes = 0;

  const room = new HostRoom('host-1', { ...SETTINGS, ...settings }, {
    toPeer: (to, msg) => sent.push({ to, msg }),
    local: (msg) => local.push(msg),
    advertChanged: () => {
      advertRefreshes += 1;
    },
  });

  return {
    room,
    sent,
    local,
    adverts: () => advertRefreshes,
    to: (link: string) => sent.filter((s) => s.to === link).map((s) => s.msg),
    clear: () => {
      sent.length = 0;
      local.length = 0;
    },
  };
}

const hello = (id: string, nm: string): Msg => ({ t: 'hello', id, nm });

describe('a room, from the host’s side', () => {
  it('tells a newcomer whose room this is before anything else', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));

    const [first, second] = h.to('link-a');
    expect(first).toEqual({ t: 'room', ct: 'K7QM', hn: 'Priya', cap: 3, lo: 1, hi: 100 });
    // The host identifies itself explicitly. Guessing from the advertised name
    // is how a joiner ends up thinking nobody holds the start button.
    expect(second).toEqual({ t: 'hello', id: 'host-1', nm: 'Priya', h: true });
  });

  it('catches the second joiner up on the first', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-a', { t: 'rdy', id: 'p-ava', r: true });
    h.clear();

    h.room.receive('link-b', hello('p-kenji', 'Kenji'));

    const seen = h.to('link-b');
    expect(seen).toContainEqual({ t: 'hello', id: 'p-ava', nm: 'Ava' });
    // Ready state travels with the roster, or Kenji sees Ava as still deciding.
    expect(seen).toContainEqual({ t: 'rdy', id: 'p-ava', r: true });
    // Ava hears about Kenji at the same time.
    expect(h.to('link-a')).toContainEqual({ t: 'hello', id: 'p-kenji', nm: 'Kenji' });
  });

  it('relays one joiner’s guess to the others and to itself', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    h.clear();

    const guess: Msg = { t: 'g', rid: 'r-1', id: 'p-ava', v: 50 };
    h.room.receive('link-a', guess);

    expect(h.to('link-b')).toEqual([guess]);
    // Never back to the phone that sent it: its own lane is already up to date.
    expect(h.to('link-a')).toEqual([]);
    expect(h.local).toEqual([guess]);
  });

  it('sends what the host itself says to everybody', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    h.clear();

    const go: Msg = { t: 'go', rid: 'r-1', lo: 1, hi: 100, tg: 42 };
    h.room.broadcast(go);

    expect(h.to('link-a')).toEqual([go]);
    expect(h.to('link-b')).toEqual([go]);
  });

  it('turns away the phone that arrives one seat too late', () => {
    const h = makeRoom({ capacity: 3 });
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    expect(h.room.isFull).toBe(true);
    h.clear();

    h.room.receive('link-c', hello('p-rosa', 'Rosa'));

    expect(h.to('link-c')).toEqual([{ t: 'full' }]);
    // Nobody else is told about a player who never got in.
    expect(h.to('link-a')).toEqual([]);
    expect(h.room.playerCount).toBe(3);
  });

  it('frees the seat when somebody leaves, and lets the next phone have it', () => {
    const h = makeRoom({ capacity: 3 });
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    h.room.receive('link-b', { t: 'bye', id: 'p-kenji' });
    h.clear();

    h.room.receive('link-c', hello('p-rosa', 'Rosa'));

    expect(h.to('link-c')).not.toContainEqual({ t: 'full' });
    expect(h.room.playerCount).toBe(3);
    expect(h.to('link-a')).toContainEqual({ t: 'hello', id: 'p-rosa', nm: 'Rosa' });
  });

  it('raising the room size lets in the phone it just refused', () => {
    const h = makeRoom({ capacity: 2 });
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    expect(h.to('link-b')).toEqual([{ t: 'full' }]);

    h.clear();
    h.room.setCapacity(4);
    // Everyone already in is told the room changed shape.
    expect(h.to('link-a')).toContainEqual({ t: 'room', ct: 'K7QM', hn: 'Priya', cap: 4, lo: 1, hi: 100 });

    h.clear();
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    expect(h.to('link-b')).not.toContainEqual({ t: 'full' });
    expect(h.room.playerCount).toBe(3);
  });

  it('shuts the door once a round is under way', () => {
    const h = makeRoom({ capacity: 4 });
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.setPlaying(true);
    h.clear();

    h.room.receive('link-c', hello('p-rosa', 'Rosa'));

    // Not full — just no use to somebody with no target to guess at.
    expect(h.room.isFull).toBe(false);
    expect(h.to('link-c')).toEqual([{ t: 'full' }]);
  });

  it('reports a dropped link as a departure, so the lane is not left waiting', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-b', hello('p-kenji', 'Kenji'));
    h.clear();

    h.room.disconnect('link-a');

    expect(h.to('link-b')).toEqual([{ t: 'bye', id: 'p-ava' }]);
    expect(h.local).toEqual([{ t: 'bye', id: 'p-ava' }]);
    expect(h.room.playerCount).toBe(2);
  });

  it('ignores a link that starts talking before it says who it is', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.clear();

    h.room.receive('link-x', { t: 'g', rid: 'r-1', id: 'p-ghost', v: 50 });

    expect(h.sent).toEqual([]);
    expect(h.local).toEqual([]);
    expect(h.room.playerCount).toBe(2);
  });

  it('treats a second hello on a live link as a re-introduction, not a new seat', () => {
    const h = makeRoom({ capacity: 2 });
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.receive('link-a', hello('p-ava', 'Ava the Second'));

    expect(h.room.playerCount).toBe(2);
    expect(h.to('link-a')).toContainEqual({ t: 'room', ct: 'K7QM', hn: 'Priya', cap: 2, lo: 1, hi: 100 });
  });

  it('refreshes the advertisement whenever the seat count changes', () => {
    const h = makeRoom();
    const before = h.adverts();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    h.room.disconnect('link-a');
    // Both directions matter: a room that still advertises a full house after
    // somebody left is a room nobody tries to join.
    expect(h.adverts()).toBe(before + 2);
  });

  it('finds the link behind a player, for a message meant only for them', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Ava'));
    expect(h.room.linkFor('p-ava')).toBe('link-a');
    expect(h.room.linkFor('p-nobody')).toBeNull();
  });

  it('trims a name that would not fit on the wire', () => {
    const h = makeRoom();
    h.room.receive('link-a', hello('p-ava', 'Bartholomew Featherstonehaugh'));
    expect(h.local).toEqual([{ t: 'hello', id: 'p-ava', nm: 'Bartholomew Feathe' }]);
  });
});
