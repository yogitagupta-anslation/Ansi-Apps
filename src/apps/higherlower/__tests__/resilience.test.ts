import { TestRoom } from './support/room';
import { decode, encode, MAX_PAYLOAD, Msg } from '../ble/protocol';
import { Reassembler, toFrames } from '../ble/framing';
import { DEFAULT_ATT_MTU } from '../ble/constants';
import { MIN_CAPACITY } from '../ble/constants';

/**
 * The ugly cases.
 *
 * A party game over a 10-metre radio spends a lot of its life in the failure
 * modes: somebody walks out of range mid-round, two people land on the number
 * in the same breath, a notification arrives twice, a fragment goes missing.
 * None of that is exotic — it is Tuesday — so it is tested here rather than
 * discovered on a table with four phones on it.
 *
 * Every test drives the real HostRoom, the real protocol and the real
 * fragmentation. Only the antenna is fake.
 */

describe('a joiner leaves during the lobby', () => {
  it('frees the seat and tells the others, whether they said goodbye or vanished', () => {
    const room = new TestRoom({ capacity: 4 });
    const ava = room.join('Ava');
    const kenji = room.join('Kenji');
    const rosa = room.join('Rosa');

    expect(room.device('Kenji').names).toEqual(['Ava', 'Priya', 'Rosa']);
    expect(room.host.playerCount).toBe(4);
    expect(room.host.isFull).toBe(true);

    // Ava leaves politely; Kenji's phone goes flat.
    ava.device.send({ t: 'bye', id: ava.device.id });
    room.drop(kenji.link);

    expect(room.host.playerCount).toBe(2);
    expect(room.host.isFull).toBe(false);
    // Rosa's roster reflects both departures, and neither leaves a ghost.
    expect(room.device('Rosa').names).toEqual(['Priya']);
    expect(room.hostDevice.names).toEqual(['Rosa']);
  });

  it('lets the next phone take the seat that was freed', () => {
    const room = new TestRoom({ capacity: 2 });
    const ava = room.join('Ava');
    const kenji = room.join('Kenji');
    expect(kenji.device.rejected).toBe(true); // room was full

    room.drop(ava.link);
    const rosa = room.join('Rosa');

    expect(rosa.device.rejected).toBe(false);
    expect(room.host.playerCount).toBe(2);
  });
});

describe('a joiner leaves during the race', () => {
  it('closes the round rather than waiting forever on a phone that has gone', () => {
    const room = new TestRoom({ capacity: 3 });
    const ava = room.join('Ava');
    room.join('Kenji');
    room.start(42);

    room.device('Ava').guess(50);
    room.device('Kenji').guess(25);

    // Ava walks out of range mid-round with the number unfound.
    room.drop(ava.link);

    // Her lane is gone from every board, so nobody is left waiting on it.
    expect(room.hostDevice.race.racers.map((r) => r.name).sort()).toEqual(['Kenji', 'Priya']);
    expect(room.device('Kenji').race.racers.some((r) => r.name === 'Ava')).toBe(false);

    // And the round can still finish and be won by somebody present.
    room.hostDevice.guess(42, 80);
    room.device('Kenji').guess(42, 140);
    room.end();

    expect(room.hostDevice.race.status).toBe('finished');
    // The point is that the two survivors agree, not who it is.
    expect(new Set(room.present.map((d) => d.winner))).toEqual(new Set(['host-1']));
  });

  it('keeps the guesses of a player who left out of everyone else’s board', () => {
    const room = new TestRoom({ capacity: 3 });
    const ava = room.join('Ava');
    room.join('Kenji');
    room.start(42);

    room.device('Ava').guess(50);
    room.drop(ava.link);

    const kenjiSees = room.device('Kenji').race.racers.map((r) => r.id);
    expect(kenjiSees).not.toContain('p-ava');
  });
});

describe('the host leaves', () => {
  it('tells every joiner, rather than leaving them staring at a live lobby', () => {
    const room = new TestRoom({ capacity: 4 });
    const ava = room.join('Ava');
    const kenji = room.join('Kenji');

    // The host's phone goes. Each joiner's link dies independently.
    room.drop(ava.link);
    room.drop(kenji.link);

    for (const joiner of [ava, kenji]) {
      expect(joiner.device.errors).toContain('link lost');
      // The host is out of their roster: nobody is still holding a start button.
      expect(joiner.device.roster.has('host-1')).toBe(false);
    }
  });

  it('is distinguishable from a full room — one is an error, the other is a no', () => {
    const room = new TestRoom({ capacity: MIN_CAPACITY });
    const ava = room.join('Ava');
    const kenji = room.join('Kenji');

    expect(kenji.device.rejected).toBe(true);
    expect(kenji.device.errors).toEqual([]);

    room.drop(ava.link);
    expect(ava.device.rejected).toBe(false);
    expect(ava.device.errors).toContain('link lost');
  });
});

describe('two people land on the number at almost the same moment', () => {
  it('gives every phone the same winner, not whichever one it heard first', () => {
    const room = new TestRoom({ capacity: 3 });
    room.join('Ava');
    room.join('Kenji');
    room.start(42);

    // Ava is 2ms ahead. Over a relay, Kenji's phone may well see its own
    // finish before it sees hers.
    room.device('Ava').guess(42, 120);
    room.device('Kenji').guess(42, 122);

    const winners = room.devices.map((d) => d.winner);
    expect(new Set(winners).size).toBe(1);
    expect(winners[0]).toBe('p-ava');
  });

  it('lets the host settle it when the two orderings genuinely disagree', () => {
    const room = new TestRoom({ capacity: 3 });
    const ava = room.join('Ava');
    const kenji = room.join('Kenji');
    room.start(42);

    // Kenji's finish is held back, so his own board sees him first.
    ava.up.faults.hold = true;
    room.device('Ava').guess(42, 100);
    room.device('Kenji').guess(42, 130);

    expect(kenji.device.winner).toBe('p-kenji'); // his board, briefly wrong
    ava.up.faults.hold = false;
    ava.up.flush();

    // Once Ava's guess lands, the earlier finish takes it on every board.
    expect(new Set(room.devices.map((d) => d.winner))).toEqual(new Set(['p-ava']));
  });

  it('crowns the nearest guess in sudden death, where nobody has to be right', () => {
    const room = new TestRoom({ capacity: 3 });
    room.join('Ava');
    room.join('Kenji');
    room.start(42, 'sudden');

    room.device('Ava').guess(50); // 8 away
    room.device('Kenji').guess(45); // 3 away
    room.hostDevice.guess(20); // 22 away
    room.end();

    expect(new Set(room.devices.map((d) => d.winner))).toEqual(new Set(['p-kenji']));
  });
});

describe('a packet arrives twice', () => {
  it('does not count the guess twice', () => {
    const room = new TestRoom({ capacity: 3 });
    const ava = room.join('Ava', { duplicate: true });
    room.join('Kenji');
    room.start(42);

    room.device('Ava').guess(50);

    // Ava made one guess. Every board must say one.
    for (const d of room.devices) {
      const lane = d.race.racers.find((r) => r.id === 'p-ava');
      expect(lane?.guesses).toHaveLength(1);
    }
  });

  it('does not seat a duplicated hello twice', () => {
    const room = new TestRoom({ capacity: 4 });
    room.join('Ava', { duplicate: true });

    expect(room.host.playerCount).toBe(2);
    expect(room.hostDevice.names).toEqual(['Ava']);
  });

  it('does not let a repeated finish overwrite the real one', () => {
    const room = new TestRoom({ capacity: 3 });
    room.join('Ava', { duplicate: true });
    room.join('Kenji');
    room.start(42);

    room.device('Ava').guess(42, 100);
    room.device('Kenji').guess(42, 200);

    expect(new Set(room.devices.map((d) => d.winner))).toEqual(new Set(['p-ava']));
  });
});

describe('a packet arrives late', () => {
  it('ignores a guess belonging to a round that has already ended', () => {
    const room = new TestRoom({ capacity: 3 });
    const ava = room.join('Ava');
    room.join('Kenji');
    room.start(42, 'speed', 'r-1');

    // Ava's guess is stuck in the air while the round finishes without her.
    ava.up.faults.hold = true;
    room.device('Ava').guess(30);

    room.device('Kenji').guess(42);
    room.hostDevice.guess(42);
    room.end('r-1');

    // A new round opens, and only now does the stale packet land.
    room.start(77, 'speed', 'r-2');
    ava.up.faults.hold = false;
    ava.up.flush();

    // It carried r-1, so nothing in r-2 moved because of it.
    const lane = room.hostDevice.race.racers.find((r) => r.id === 'p-ava');
    expect(lane?.guesses ?? []).toHaveLength(0);
  });

  it('survives fragments arriving out of order by dropping the message, not the link', () => {
    const room = new TestRoom({ capacity: 3 }, DEFAULT_ATT_MTU);
    const ava = room.join('Ava');
    room.start(42);

    // A 'go' at the smallest MTU is several fragments; reverse them.
    ava.up.faults.reverse = true;
    room.device('Ava').guess(50);
    ava.up.faults.reverse = false;

    // The scrambled message was discarded rather than half-applied...
    const lane = room.hostDevice.race.racers.find((r) => r.id === 'p-ava');
    expect(lane?.guesses ?? []).toHaveLength(0);

    // ...and the very next message on the same link is fine.
    room.device('Ava').guess(25);
    const after = room.hostDevice.race.racers.find((r) => r.id === 'p-ava');
    expect(after?.guesses).toHaveLength(1);
    expect(after?.guesses[0].value).toBe(25);
  });
});

describe('a packet arrives broken', () => {
  it('drops a corrupted message and keeps the link', () => {
    const room = new TestRoom({ capacity: 3 });
    const ava = room.join('Ava');
    room.start(42);

    ava.up.faults.corrupt = true;
    room.device('Ava').guess(50);
    ava.up.faults.corrupt = false;

    room.device('Ava').guess(25);
    const lane = room.hostDevice.race.racers.find((r) => r.id === 'p-ava');
    expect(lane?.guesses).toHaveLength(1);
    expect(lane?.guesses[0].value).toBe(25);
  });

  it('drops a message with a hole in it rather than delivering half of one', () => {
    const room = new TestRoom({ capacity: 3 }, DEFAULT_ATT_MTU);
    const ava = room.join('Ava');
    room.start(42);

    ava.up.faults.dropFragment = 1;
    room.device('Ava').guess(50);
    ava.up.faults.dropFragment = undefined;

    const lane = room.hostDevice.race.racers.find((r) => r.id === 'p-ava');
    expect(lane?.guesses ?? []).toHaveLength(0);
  });

  it('refuses a well-formed message that lies about its own shape', () => {
    // The decoder is the only thing between a stray packet and the rules of the
    // round, so it rejects rather than defaults.
    expect(decode('{"t":"go","rid":"r-1","lo":1,"hi":"lots","tg":42}')).toBeNull();
    expect(decode('{"t":"g","rid":"r-1","id":"p-ava"}')).toBeNull();
    expect(decode('{"t":"rdy","id":"p-ava","r":"yes"}')).toBeNull();
    expect(decode('[]')).toBeNull();
    expect(decode('')).toBeNull();
  });

  it('will not put an oversized message on the air in the first place', () => {
    const huge: Msg = { t: 'hello', id: 'p-ava', nm: 'n'.repeat(MAX_PAYLOAD) };
    expect(() => encode(huge)).toThrow(/too large/);
  });

  it('ignores a guess for a racer nobody has met', () => {
    const room = new TestRoom({ capacity: 3 });
    room.join('Ava');
    room.start(42);

    // A packet naming a player who is not in the round changes nothing.
    room.hostDevice.apply({ t: 'g', rid: 'r-1', id: 'p-ghost', v: 50 });
    expect(room.hostDevice.race.racers.some((r) => r.id === 'p-ghost')).toBe(false);
  });
});

describe('somebody arrives after the round has started', () => {
  it('is turned away rather than dropped onto a board with no number', () => {
    const room = new TestRoom({ capacity: 8 });
    room.join('Ava');
    room.start(42);

    const latecomer = room.join('Rosa');

    expect(latecomer.device.rejected).toBe(true);
    expect(room.host.isFull).toBe(false); // there was a seat; the round was the problem
    expect(room.host.playerCount).toBe(2);
    // Nobody mid-round is told about a player who never got in.
    expect(room.device('Ava').names).toEqual(['Priya']);
  });

  it('lets them in once the round is over', () => {
    const room = new TestRoom({ capacity: 8 });
    room.join('Ava');
    room.start(42);
    room.join('Rosa');

    room.host.setPlaying(false); // back in the lobby
    const second = room.join('Rosa');

    expect(second.device.rejected).toBe(false);
    expect(room.host.playerCount).toBe(3);
  });
});

describe('a full eight-player room', () => {
  it('seats seven joiners and refuses the eighth', () => {
    const room = new TestRoom({ capacity: 8 });
    const names = ['Ava', 'Kenji', 'Rosa', 'Milo', 'Nina', 'Theo', 'Sam'];
    const seated = names.map((n) => room.join(n));

    expect(room.host.playerCount).toBe(8);
    expect(room.host.isFull).toBe(true);
    seated.forEach((j) => expect(j.device.rejected).toBe(false));

    const eighth = room.join('Zoe');
    expect(eighth.device.rejected).toBe(true);
    expect(room.host.playerCount).toBe(8);
  });

  it('gives all eight the same roster and the same winner', () => {
    const room = new TestRoom({ capacity: 8 });
    ['Ava', 'Kenji', 'Rosa', 'Milo', 'Nina', 'Theo', 'Sam'].forEach((n) => room.join(n));
    room.start(42);

    // Everyone sees seven other lanes on their own board.
    room.devices.forEach((d) => expect(d.race.racers).toHaveLength(8));

    room.device('Nina').guess(42, 90);
    room.devices.forEach((d) => expect(d.winner).toBe('p-nina'));
  });

  it('relays one guess to the other seven and never back to the sender', () => {
    const room = new TestRoom({ capacity: 8 });
    const joiners = ['Ava', 'Kenji', 'Rosa', 'Milo', 'Nina', 'Theo', 'Sam'].map((n) => room.join(n));
    room.start(42);
    joiners.forEach((j) => (j.down.sent.length = 0));

    room.device('Ava').guess(50);

    const ava = joiners[0];
    expect(ava.down.sent.filter((m) => m.t === 'g')).toHaveLength(0);
    joiners.slice(1).forEach((j) => {
      expect(j.down.sent.filter((m) => m.t === 'g' && m.id === 'p-ava')).toHaveLength(1);
    });
  });
});

describe('reconnection', () => {
  it('seats a returning player once, not twice', () => {
    const room = new TestRoom({ capacity: 4 });
    const ava = room.join('Ava');
    room.join('Kenji');
    expect(room.host.playerCount).toBe(3);

    room.drop(ava.link);
    expect(room.host.playerCount).toBe(2);

    // Same phone, same player id, new link.
    const back = room.join('Ava');
    expect(back.device.rejected).toBe(false);
    expect(room.host.playerCount).toBe(3);
    expect(room.hostDevice.names).toEqual(['Ava', 'Kenji']);
  });

  it('catches the returning player up on who is in the room', () => {
    const room = new TestRoom({ capacity: 4 });
    const ava = room.join('Ava');
    const kenji = room.join('Kenji');
    kenji.device.send({ t: 'rdy', id: kenji.device.id, r: true });

    room.drop(ava.link);
    const back = room.join('Ava');

    // The whole room, host included, and Kenji's ready state with it.
    expect(back.device.names).toEqual(['Kenji', 'Priya']);
    expect(back.device.roster.get('host-1')?.isHost).toBe(true);
    expect(back.device.roster.get('p-kenji')?.ready).toBe(true);
  });

  it('does not resurrect a lane in a round the returning player missed', () => {
    const room = new TestRoom({ capacity: 4 });
    const ava = room.join('Ava');
    room.join('Kenji');
    room.start(42);

    room.drop(ava.link);
    const back = room.join('Ava');

    // The door is shut mid-round, so she waits it out rather than joining a
    // board whose target she was never sent.
    expect(back.device.rejected).toBe(true);
    expect(room.hostDevice.race.racers.some((r) => r.id === 'p-ava')).toBe(false);
  });
});

describe('the reassembler, directly', () => {
  it('recovers on the next clean message after any of the above', () => {
    const guess: Msg = { t: 'g', rid: 'r-1', id: 'p-ava', v: 4242 };

    for (const wreck of ['out-of-order', 'hole', 'garbage'] as const) {
      const r = new Reassembler();
      const frames = toFrames(encode(guess), DEFAULT_ATT_MTU);
      expect(frames.length).toBeGreaterThan(1);

      if (wreck === 'out-of-order') [...frames].reverse().forEach((f) => r.accept(f));
      if (wreck === 'hole') frames.filter((_f, i) => i !== 1).forEach((f) => r.accept(f));
      if (wreck === 'garbage') r.accept('!!!!');

      let out: string | null = null;
      for (const f of frames) out = r.accept(f);
      expect(out === null ? null : decode(out)).toEqual(guess);
    }
  });
});
