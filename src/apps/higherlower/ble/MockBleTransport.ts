import { Difficulty } from '../types/game';
import { judge, makeTarget, parGuesses } from '../game/engine';
import { AiBrain, createAi, GuessLike } from '../game/ai';
import { decode, encode, Msg } from './protocol';
import { BleState, BleTransport, DiscoveredRoom, RoomInfo, Unsubscribe } from './transport';

const PEER_NAMES = ['Ava', 'Milo', 'Priya', 'Kenji', 'Rosa', 'Theo', 'Nina', 'Sam'];
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'normal', 'hard'];

/** Ranges a simulated host might be advertising. */
const SIM_RANGES = [
  { min: 1, max: 10 },
  { min: 1, max: 100 },
  { min: 1, max: 100 },
  { min: 1, max: 1000 },
];

/** Round-trip time a short BLE notification actually takes, roughly. */
const LATENCY_MS: [number, number] = [45, 170];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split('');
  return Array.from({ length: 4 }, () => pick(alphabet)).join('');
}

interface SimPeer {
  id: string;
  name: string;
  brain: AiBrain;
  guesses: GuessLike[];
  roundId: string | null;
  /** Paused while the link is down; their guesses resume on reconnect. */
  offline: boolean;
  /** Guesses this peer is allowed, from the round's rules. */
  limit: number | null;
  target: number;
  range: { min: number; max: number };
  startedAt: number;
}

/**
 * A stand-in for the radio.
 *
 * It fakes the parts of BLE that matter to the game -- discovery delay, signal
 * strength, connection churn, per-message latency, and peers that keep playing
 * whether or not you are looking at them -- so the whole multiplayer flow can be
 * exercised on one device with no dev build. Everything it emits travels through
 * the same encode/decode protocol a real link would use, so swapping in a
 * hardware driver changes nothing above this file.
 */
export class MockBleTransport implements BleTransport {
  readonly deviceId = `dev-${Math.random().toString(36).slice(2, 8)}`;
  readonly label = 'Simulated BLE';

  private state: BleState = 'off';
  private stateSubs = new Set<(s: BleState) => void>();
  private msgSubs = new Set<(m: Msg, from: string) => void>();

  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** Per-sender delivery clock: notifications on one connection stay in order. */
  private deliverAt = new Map<string, number>();
  private peers: SimPeer[] = [];
  private room: RoomInfo | null = null;
  private hosting = false;
  private simRoundQueued = false;
  private scanRooms: DiscoveredRoom[] = [];

  constructor() {
    this.later(() => this.setState('idle'), 350);
  }

  // ---------------------------------------------------------------- plumbing

  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.deliverAt.clear();
  }

  private setState(next: BleState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateSubs.forEach((cb) => cb(next));
  }

  /**
   * Delivers a message up to the app as if it had arrived over the air.
   *
   * Each sender gets its own delivery clock. A real link will not reorder two
   * notifications from the same peer, and the game leans on that: a peer's
   * winning guess has to land before the 'win' that follows it.
   */
  private deliver(msg: Msg, fromId: string): void {
    const now = Date.now();
    const at = Math.max(now, this.deliverAt.get(fromId) ?? 0) + randomBetween(LATENCY_MS);
    this.deliverAt.set(fromId, at);
    this.later(() => {
      const roundTripped = decode(encode(msg));
      if (!roundTripped) return;
      this.msgSubs.forEach((cb) => cb(roundTripped, fromId));
    }, at - now);
  }

  private spawnPeer(name?: string): SimPeer {
    const used = new Set(this.peers.map((p) => p.name));
    const chosen = name ?? PEER_NAMES.find((n) => !used.has(n)) ?? `Player ${this.peers.length + 2}`;
    return {
      id: `peer-${Math.random().toString(36).slice(2, 8)}`,
      name: chosen,
      brain: createAi(pick(DIFFICULTIES)),
      guesses: [],
      roundId: null,
      offline: false,
      limit: null,
      target: 0,
      range: { min: 1, max: 100 },
      startedAt: 0,
    };
  }

  private addPeer(): void {
    if (this.peers.length >= 3) return;
    const peer = this.spawnPeer();
    this.peers.push(peer);
    this.deliver({ t: 'hello', id: peer.id, nm: peer.name }, peer.id);
    // Peers settle in and mark themselves ready a beat later.
    this.later(() => this.deliver({ t: 'rdy', id: peer.id, r: true }, peer.id), 900 + Math.random() * 1800);
  }

  // ------------------------------------------------------------ BleTransport

  getState(): BleState {
    return this.state;
  }

  onStateChange(cb: (s: BleState) => void): Unsubscribe {
    this.stateSubs.add(cb);
    cb(this.state);
    return () => {
      this.stateSubs.delete(cb);
    };
  }

  onMessage(cb: (m: Msg, from: string) => void): Unsubscribe {
    this.msgSubs.add(cb);
    return () => {
      this.msgSubs.delete(cb);
    };
  }

  async startHosting(room: RoomInfo): Promise<void> {
    this.room = room;
    this.hosting = true;
    this.setState('advertising');
    // Nearby devices trickle in rather than all appearing at once.
    this.later(() => this.addPeer(), 1600 + Math.random() * 1600);
    this.later(() => this.addPeer(), 4200 + Math.random() * 2600);
    this.later(() => this.setState('connected'), 1700);
  }

  startScan(cb: (rooms: DiscoveredRoom[]) => void): Unsubscribe {
    this.setState('scanning');
    this.scanRooms = [];
    let cancelled = false;

    const emit = () => cb([...this.scanRooms]);

    const discover = (delay: number) => {
      this.later(() => {
        if (cancelled) return;
        const taken = this.scanRooms.map((r) => r.hostName);
        const free = PEER_NAMES.filter((n) => !taken.includes(n));
        this.scanRooms.push({
          id: `room-${Math.random().toString(36).slice(2, 8)}`,
          code: makeRoomCode(),
          hostName: free.length ? pick(free) : `Player ${this.scanRooms.length + 1}`,
          players: 1 + Math.floor(Math.random() * 3),
          rssi: -45 - Math.floor(Math.random() * 40),
          range: pick(SIM_RANGES),
        });
        emit();
      }, delay);
    };

    discover(1100 + Math.random() * 900);
    discover(2600 + Math.random() * 1600);
    discover(5200 + Math.random() * 2600);

    // Signal strength wobbles the way it does when people move around a room.
    const drift = setInterval(() => {
      if (cancelled || this.scanRooms.length === 0) return;
      this.scanRooms = this.scanRooms.map((r) => ({
        ...r,
        rssi: Math.max(-95, Math.min(-38, r.rssi + Math.round((Math.random() * 2 - 1) * 6))),
      }));
      emit();
    }, 1400);

    return () => {
      cancelled = true;
      clearInterval(drift);
      if (this.state === 'scanning') this.setState('idle');
    };
  }

  async join(roomId: string, playerName: string): Promise<void> {
    const found = this.scanRooms.find((r) => r.id === roomId);
    this.room = {
      id: roomId,
      code: found?.code ?? makeRoomCode(),
      hostName: found?.hostName ?? 'Host',
      range: found?.range ?? { min: 1, max: 100 },
    };
    this.hosting = false;
    this.simRoundQueued = false;

    // The host, plus whoever else was already in the room.
    this.peers = [this.spawnPeer(this.room.hostName)];
    const others = Math.max(0, (found?.players ?? 2) - 2);
    for (let i = 0; i < others; i += 1) this.peers.push(this.spawnPeer());

    this.later(() => {
      this.setState('connected');
      this.peers.forEach((p, i) => {
        this.deliver({ t: 'hello', id: p.id, nm: p.name }, p.id);
        this.later(
          () => this.deliver({ t: 'rdy', id: p.id, r: true }, p.id),
          700 + i * 500 + Math.random() * 1200,
        );
      });
      this.deliver({ t: 'hello', id: this.deviceId, nm: playerName }, this.deviceId);
    }, 900 + Math.random() * 700);
  }

  async leave(): Promise<void> {
    this.clearTimers();
    this.peers = [];
    this.room = null;
    this.hosting = false;
    this.simRoundQueued = false;
    this.setState('idle');
  }

  /**
   * Outbound. Real peers would receive this over a characteristic write; the
   * simulated ones react to it directly -- a 'go' starts them guessing, a 'win'
   * or 'end' stops them.
   */
  async send(msg: Msg): Promise<void> {
    encode(msg); // surfaces oversized payloads exactly as a real link would

    if (msg.t === 'go') {
      // Survival and sudden death cap what a peer may try, same as the players.
      const limit =
        msg.md === 'sudden' ? 1 : (msg.mf ?? []).includes('limited') ? parGuesses({ min: msg.lo, max: msg.hi }) : null;
      this.peers.forEach((peer) => {
        peer.limit = limit;
        peer.roundId = msg.rid;
        peer.target = msg.tg;
        peer.range = { min: msg.lo, max: msg.hi };
        peer.guesses = [];
        peer.offline = false;
        peer.startedAt = Date.now();
        this.schedulePeerGuess(peer);
      });
      return;
    }

    // Only the round closing stops them. Someone else finding the number does
    // not: every simulated player keeps hunting until they get there too.
    if (msg.t === 'end') {
      this.peers.forEach((peer) => {
        peer.roundId = null;
      });
      this.simRoundQueued = false;
      return;
    }

    // When we are the one who joined, the simulated host is the one holding the
    // start button -- it opens a round shortly after we say we are ready.
    if (msg.t === 'rdy' && msg.r && !this.hosting && this.room && !this.simRoundQueued) {
      this.simRoundQueued = true;
      this.later(() => this.startSimulatedRound(), 2000 + Math.random() * 1800);
    }
  }

  /** The simulated host opening a round: same 'go' a real host would send. */
  private startSimulatedRound(): void {
    const room = this.room;
    const host = this.peers[0];
    if (!room || this.hosting || !host) return;

    const rid = `r-${Math.random().toString(36).slice(2, 8)}`;
    const target = makeTarget(room.range);
    this.deliver({ t: 'go', rid, lo: room.range.min, hi: room.range.max, tg: target, md: 'speed', mf: [] }, host.id);

    this.peers.forEach((peer) => {
      peer.limit = null;
      peer.roundId = rid;
      peer.target = target;
      peer.range = room.range;
      peer.guesses = [];
      peer.startedAt = Date.now();
      this.schedulePeerGuess(peer);
    });
  }

  /**
   * Radios drop. One peer per round loses the link for a few seconds, so the
   * reconnect path is something you see rather than something you hope works.
   */
  private maybeDropPeer(peer: SimPeer): void {
    if (peer.offline || Math.random() > 0.25) return;
    peer.offline = true;
    this.deliver({ t: 'off', id: peer.id }, peer.id);
    this.later(() => {
      peer.offline = false;
      this.deliver({ t: 'on', id: peer.id }, peer.id);
      this.schedulePeerGuess(peer);
    }, 3000 + Math.random() * 3000);
  }

  /** Drives one simulated opponent's next guess and relays it back. */
  private schedulePeerGuess(peer: SimPeer): void {
    const roundId = peer.roundId;
    if (!roundId) return;

    this.later(() => {
      if (peer.roundId !== roundId) return; // round ended while it was thinking
      if (peer.offline) return; // link is down; resumes when it returns

      const value = peer.brain.nextGuess(peer.range, peer.guesses);
      const verdict = judge(value, peer.target);
      peer.guesses.push({ value, verdict });

      this.deliver({ t: 'g', rid: roundId, id: peer.id, v: value }, peer.id);

      // A guess is also a chance for the radio to misbehave.
      if (peer.guesses.length === 2) this.maybeDropPeer(peer);

      // Peers are chatty about their own luck.
      if (Math.random() < 0.18) {
        const emoji = verdict === 'correct' ? '🔥' : pick(['😂', '😱', '🤦', '👀']);
        this.deliver({ t: 'rx', id: peer.id, e: emoji }, peer.id);
      }

      if (peer.limit !== null && peer.guesses.length >= peer.limit && verdict !== 'correct') {
        peer.roundId = null; // out of guesses, same as an eliminated player
        return;
      }

      if (verdict === 'correct') {
        this.deliver(
          { t: 'fin', rid: roundId, id: peer.id, n: peer.guesses.length, ms: Date.now() - peer.startedAt },
          peer.id,
        );
        peer.roundId = null;
        return;
      }
      this.schedulePeerGuess(peer);
    }, peer.brain.thinkMs());
  }

  /** Releases every timer. Call on unmount. */
  destroy(): void {
    this.clearTimers();
    this.stateSubs.clear();
    this.msgSubs.clear();
    this.peers = [];
    this.state = 'off';
  }
}
