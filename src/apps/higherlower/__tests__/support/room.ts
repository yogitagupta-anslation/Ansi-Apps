import { HostRoom, RoomSettings } from '../../ble/hostRoom';
import { Reassembler, toFrames } from '../../ble/framing';
import { decode, encode, Msg } from '../../ble/protocol';
import { REQUESTED_MTU } from '../../ble/constants';
import { emptyRace, raceReducer, RaceState, summarize } from '../../game/raceState';
import { resolveRules } from '../../game/modifiers';
import { RaceMode, RoundSummary } from '../../types/game';

/**
 * A room with the radio taken out and a wire I can abuse.
 *
 * Everything here is the real thing except the antenna: real `HostRoom`, real
 * `encode`/`decode`, real fragmentation and reassembly. What replaces the radio
 * is a `Wire` that can do the four things a radio does when it is having a bad
 * day -- drop a fragment, deliver one twice, deliver them out of order, or hand
 * over bytes that are not what was sent.
 *
 * That matters because the interesting failures in this app are not "does the
 * host relay" -- they are "what does each phone believe once the link has
 * misbehaved". So every device here keeps its own `RaceState`, driven the same
 * way MultiplayerGameScreen drives it, and the assertions are about what a
 * player would actually see on their board.
 */

export interface WireFaults {
  /** Deliver every frame twice. A radio re-notifying is not hypothetical. */
  duplicate?: boolean;
  /** Swallow the fragment at this index of the next message. */
  dropFragment?: number;
  /** Hold frames until `flush()` is called. */
  hold?: boolean;
  /** Flip a byte in the payload of every frame. */
  corrupt?: boolean;
  /** Deliver this message's frames back to front. */
  reverse?: boolean;
}

type Sink = (base64: string) => void;

/** One direction of one link. Fragments in, fragments out, faults in between. */
class Wire {
  faults: WireFaults = {};
  private held: string[] = [];
  /** Everything that ever went over it, for assertions about traffic. */
  readonly sent: Msg[] = [];

  constructor(
    private readonly sink: Sink,
    private readonly mtu: number,
  ) {}

  send(msg: Msg): void {
    this.sent.push(msg);
    let frames = toFrames(encode(msg), this.mtu);

    if (this.faults.dropFragment !== undefined) {
      const at = this.faults.dropFragment;
      frames = frames.filter((_f, i) => i !== at);
    }
    if (this.faults.reverse) frames = [...frames].reverse();
    if (this.faults.corrupt) frames = frames.map(flipAByte);
    if (this.faults.duplicate) frames = frames.flatMap((f) => [f, f]);

    if (this.faults.hold) {
      this.held.push(...frames);
      return;
    }
    frames.forEach((f) => this.sink(f));
  }

  /** Releases everything held, in the order it was queued. */
  flush(): void {
    const queued = this.held;
    this.held = [];
    queued.forEach((f) => this.sink(f));
  }

  /** Releases held frames in reverse -- a late packet arriving after a newer one. */
  flushReversed(): void {
    const queued = this.held.reverse();
    this.held = [];
    queued.forEach((f) => this.sink(f));
  }
}

/** Corrupts the payload without touching the fragment header. */
function flipAByte(base64: string): string {
  // Mangling the base64 alphabet is the honest version of a bad byte: it is
  // what a decoder actually receives when the radio hands over garbage.
  const chars = base64.split('');
  const at = Math.min(2, chars.length - 1);
  chars[at] = chars[at] === 'A' ? 'B' : 'A';
  return chars.join('');
}

/**
 * One phone's view of the room.
 *
 * The roster and the race are kept exactly as BleProvider and
 * MultiplayerGameScreen keep them, because the question these tests ask is what
 * a player sees -- not what a data structure holds.
 */
export class Device {
  readonly id: string;
  readonly name: string;
  /** Who this phone believes is in the room, in arrival order. */
  readonly roster = new Map<string, { name: string; ready: boolean; isHost: boolean }>();
  race: RaceState = emptyRace;
  roundId = '';
  /** Errors the transport would have surfaced to the UI. */
  readonly errors: string[] = [];
  /** Set when this phone was told the room is full. */
  rejected = false;

  private reassembler = new Reassembler();
  private onSend: ((msg: Msg) => void) | null = null;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  attach(send: (msg: Msg) => void): void {
    this.onSend = send;
  }

  /** A frame off the wire. Reassembled, decoded, applied -- or dropped. */
  accept(base64: string): void {
    const text = this.reassembler.accept(base64);
    if (text === null) return;
    const msg = decode(text);
    if (!msg) {
      this.errors.push('malformed');
      return;
    }
    this.apply(msg);
  }

  /** The roster and race bookkeeping, mirroring the provider and game screen. */
  apply(msg: Msg): void {
    switch (msg.t) {
      case 'hello':
        if (msg.id === this.id) return;
        if (!this.roster.has(msg.id)) {
          this.roster.set(msg.id, { name: msg.nm, ready: false, isHost: msg.h === true });
        }
        return;

      case 'bye':
        this.roster.delete(msg.id);
        this.race = raceReducer(this.race, { type: 'removeRacer', racerId: msg.id });
        return;

      case 'rdy': {
        const peer = this.roster.get(msg.id);
        if (peer) peer.ready = msg.r;
        return;
      }

      case 'full':
        this.rejected = true;
        return;

      case 'go':
        this.startRound(msg.rid, msg.lo, msg.hi, msg.tg, (msg.md as RaceMode) ?? 'speed');
        return;

      case 'g':
        if (msg.rid !== this.roundId) return;
        this.race = raceReducer(this.race, {
          type: 'guess',
          racerId: msg.id,
          value: msg.v,
          now: this.race.startedAt + 1,
        });
        return;

      case 'fin':
        if (msg.rid !== this.roundId) return;
        this.race = raceReducer(this.race, { type: 'finished', racerId: msg.id, at: msg.ms });
        return;

      case 'end':
        if (msg.rid !== this.roundId) return;
        // The host's verdict travels with the call and is adopted verbatim,
        // exactly as MultiplayerGameScreen does it.
        this.race = raceReducer(this.race, { type: 'end', winnerId: msg.id });
        return;

      default:
        return;
    }
  }

  /** Seeds the board from whoever this phone currently believes is here. */
  startRound(rid: string, lo: number, hi: number, target: number, mode: RaceMode): void {
    this.roundId = rid;
    const racers = [
      { id: this.id, name: this.name, kind: 'you' as const },
      ...Array.from(this.roster.entries()).map(([id, p]) => ({
        id,
        name: p.name,
        kind: 'peer' as const,
      })),
    ];
    this.race = raceReducer(this.race, {
      type: 'start',
      range: { min: lo, max: hi },
      target,
      racers,
      now: 1_000,
      rules: resolveRules({ min: lo, max: hi }, []),
      mode,
    });
  }

  send(msg: Msg): void {
    this.onSend?.(msg);
  }

  /**
   * Make a guess the way the game screen does: judge it locally for instant
   * feedback, relay the raw value, and report a finish separately.
   */
  guess(value: number, atMs = 10): void {
    this.race = raceReducer(this.race, {
      type: 'guess',
      racerId: this.id,
      value,
      now: this.race.startedAt + atMs,
    });
    this.send({ t: 'g', rid: this.roundId, id: this.id, v: value });
    if (value === this.race.target) {
      const me = this.race.racers.find((r) => r.id === this.id);
      this.send({
        t: 'fin',
        rid: this.roundId,
        id: this.id,
        n: me?.guesses.length ?? 1,
        ms: atMs,
      });
    }
  }

  get summary(): RoundSummary {
    return summarize(this.race);
  }

  /** Who this phone thinks won, once the mode has had its say. */
  get winner(): string | null {
    return this.summary.winnerId;
  }

  get names(): string[] {
    return Array.from(this.roster.values()).map((p) => p.name).sort();
  }
}

export interface JoinResult {
  device: Device;
  link: string;
  /** Host -> joiner. */
  down: Wire;
  /** Joiner -> host. */
  up: Wire;
}

const DEFAULTS: RoomSettings = {
  code: 'K7QM',
  hostName: 'Priya',
  capacity: 4,
  range: { min: 1, max: 100 },
};

/** A host, its joiners, and the wires between them. */
export class TestRoom {
  readonly hostDevice: Device;
  readonly host: HostRoom;
  readonly joiners: JoinResult[] = [];
  advertRefreshes = 0;

  private nextLink = 0;
  private readonly dropped = new Set<string>();

  constructor(
    settings: Partial<RoomSettings> = {},
    private readonly mtu: number = REQUESTED_MTU,
  ) {
    const resolved = { ...DEFAULTS, ...settings };
    this.hostDevice = new Device('host-1', resolved.hostName);

    this.host = new HostRoom('host-1', resolved, {
      toPeer: (link, msg) => this.wireFor(link)?.down.send(msg),
      // The host's own tree sees a relayed message exactly as a joiner does.
      local: (msg) => this.hostDevice.apply(msg),
      advertChanged: () => {
        this.advertRefreshes += 1;
      },
    });

    // Anything the host itself says goes out to everybody and is applied here.
    this.hostDevice.attach((msg) => {
      this.host.broadcast(msg);
    });
  }

  private wireFor(link: string): JoinResult | undefined {
    return this.joiners.find((j) => j.link === link);
  }

  /** Brings a phone into range and lets it introduce itself. */
  join(name: string, faults: WireFaults = {}): JoinResult {
    const link = `link-${this.nextLink++}`;
    const device = new Device(`p-${name.toLowerCase()}`, name);

    const down = new Wire((frame) => device.accept(frame), this.mtu);
    const up = new Wire((frame) => this.hostAccept(link, frame), this.mtu);
    up.faults = faults;

    device.attach((msg) => up.send(msg));

    const result: JoinResult = { device, link, down, up };
    this.joiners.push(result);

    device.send({ t: 'hello', id: device.id, nm: name });
    return result;
  }

  /** Reassembly is per link on the host too, so each keeps its own. */
  private hostInbound = new Map<string, Reassembler>();

  private hostAccept(link: string, base64: string): void {
    let r = this.hostInbound.get(link);
    if (!r) {
      r = new Reassembler();
      this.hostInbound.set(link, r);
    }
    const text = r.accept(base64);
    if (text === null) return;
    const msg = decode(text);
    if (msg) this.host.receive(link, msg);
  }

  /** The link died. The host notices; the joiner is told nothing. */
  drop(link: string): void {
    this.dropped.add(link);
    this.hostInbound.delete(link);
    this.host.disconnect(link);
    const joiner = this.wireFor(link);
    if (joiner) {
      // What NativeBleTransport.onHostGone does on the joiner's side.
      joiner.device.errors.push('link lost');
      joiner.device.apply({ t: 'bye', id: 'host-1' });
    }
  }

  /** The host opens a round, the way LobbyScreen and the game screen do. */
  start(target: number, mode: RaceMode = 'speed', rid = 'r-1'): void {
    this.host.setPlaying(true);
    const { range } = this.host.room;
    this.hostDevice.startRound(rid, range.min, range.max, target, mode);
    this.host.broadcast({ t: 'go', rid, lo: range.min, hi: range.max, tg: target, md: mode });
  }

  /** The host calls the round, which is what settles a photo finish. */
  end(rid = 'r-1'): void {
    this.hostDevice.race = raceReducer(this.hostDevice.race, { type: 'end' });
    this.host.broadcast({ t: 'end', rid, id: this.hostDevice.winner ?? '' });
  }

  /** Every phone that ever joined, host first — including ones that have left. */
  get devices(): Device[] {
    return [this.hostDevice, ...this.joiners.map((j) => j.device)];
  }

  /**
   * The phones still in the room.
   *
   * A device whose link died keeps whatever it last believed, which is correct
   * — it has no way to learn anything more — but it is not part of "everyone
   * agrees", because it is not part of everyone any more.
   */
  get present(): Device[] {
    return [
      this.hostDevice,
      ...this.joiners.filter((j) => !this.dropped.has(j.link) && !j.device.rejected).map((j) => j.device),
    ];
  }

  device(name: string): Device {
    const found = this.devices.find((d) => d.name === name);
    if (!found) throw new Error(`No device called ${name}`);
    return found;
  }
}
