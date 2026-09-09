import { Range } from '../types/game';
import { Msg } from './protocol';

/**
 * Everything the host decides, with no radio in sight.
 *
 * BLE gives a star and nothing else: joiners can see the host and cannot see
 * each other. So one device has to be the room -- hold the roster, relay
 * between links, tell the fourth phone that the third took the last seat, and
 * catch a newcomer up on who is already standing there. None of that is radio
 * work; it is the rules of a room, and it is where the bugs live.
 *
 * Keeping it here means it can be exercised without pretending to have a radio:
 * feed it the messages three phones would send and assert what each of them is
 * told. `NativeBleTransport` supplies the only two things it genuinely cannot
 * know -- how to reach a link, and when one dies.
 */

export interface RoomSettings {
  code: string;
  hostName: string;
  capacity: number;
  range: Range;
}

export interface HostRoomOutbox {
  /** Send to one link. */
  toPeer(centralId: string, msg: Msg): void;
  /** Hand a message to this device's own subscribers, as if it arrived. */
  local(msg: Msg, fromCentralId: string): void;
  /** The advertised player count or state changed. */
  advertChanged(): void;
}

interface Peer {
  playerId: string;
  name: string;
  ready: boolean;
}

/** Long enough to recognise, short enough to leave the packet some room. */
const NAME_MAX = 18;
export const trimName = (name: string): string => name.trim().slice(0, NAME_MAX) || 'Player';

export class HostRoom {
  /** Central address -> the player behind it. Absent until their 'hello'. */
  private peers = new Map<string, Peer>();
  private settings: RoomSettings;
  private playing = false;

  constructor(
    private readonly hostId: string,
    settings: RoomSettings,
    private readonly out: HostRoomOutbox,
  ) {
    this.settings = settings;
  }

  get room(): RoomSettings {
    return this.settings;
  }

  /** Everyone who has introduced themselves, plus the host. */
  get playerCount(): number {
    return 1 + this.peers.size;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isFull(): boolean {
    return this.playerCount >= this.settings.capacity;
  }

  /** Links to notify, in arrival order. */
  get links(): string[] {
    return Array.from(this.peers.keys());
  }

  setCapacity(capacity: number): void {
    this.settings = { ...this.settings, capacity };
    this.out.advertChanged();
    this.broadcast(this.describe());
  }

  /**
   * Once a round is open the door shuts. A phone that connected mid-race would
   * have no target and nothing to guess at, so it is turned away with the same
   * message a full room sends.
   */
  setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.out.advertChanged();
  }

  describe(): Msg {
    const { code, hostName, capacity, range } = this.settings;
    return {
      t: 'room',
      ct: code,
      hn: trimName(hostName),
      cap: capacity,
      lo: range.min,
      hi: range.max,
    };
  }

  /** One message arriving from a joiner. */
  receive(centralId: string, msg: Msg): void {
    if (msg.t === 'hello') {
      this.admit(centralId, msg.id, msg.nm);
      return;
    }

    const peer = this.peers.get(centralId);
    if (!peer) return; // never introduced itself; nothing to relay on its behalf

    if (msg.t === 'rdy') peer.ready = msg.r;
    if (msg.t === 'bye') {
      this.peers.delete(centralId);
      this.out.advertChanged();
    }

    this.relay(msg, centralId);
    this.out.local(msg, centralId);
  }

  /**
   * A joiner introducing itself. This is the only place a room can fill up: the
   * host is the only device that can see everybody, so it is the only one that
   * can say no.
   */
  private admit(centralId: string, playerId: string, name: string): void {
    const existing = this.peers.get(centralId);

    if (!existing) {
      if (this.playing || this.isFull) {
        this.out.toPeer(centralId, { t: 'full' });
        return;
      }
      this.peers.set(centralId, { playerId, name: trimName(name), ready: false });
    } else {
      // A second hello on a live link is a re-introduction, not a new seat.
      existing.playerId = playerId;
      existing.name = trimName(name);
    }

    // What the newcomer needs before anything else: whose room this is, and who
    // is already standing in it. Ordering matters -- a 'rdy' for a player they
    // have not met yet would be dropped.
    this.out.toPeer(centralId, this.describe());
    this.out.toPeer(centralId, {
      t: 'hello',
      id: this.hostId,
      nm: trimName(this.settings.hostName),
      h: true,
    });
    this.peers.forEach((peer, id) => {
      if (id === centralId) return;
      this.out.toPeer(centralId, { t: 'hello', id: peer.playerId, nm: peer.name });
      if (peer.ready) this.out.toPeer(centralId, { t: 'rdy', id: peer.playerId, r: true });
    });

    const hello: Msg = { t: 'hello', id: playerId, nm: trimName(name) };
    this.relay(hello, centralId);
    this.out.local(hello, centralId);
    this.out.advertChanged();
  }

  /**
   * A link died. Distinct from 'bye': they did not choose to go, but from the
   * room's point of view the seat is free either way.
   */
  disconnect(centralId: string): void {
    const peer = this.peers.get(centralId);
    if (!peer) return;

    this.peers.delete(centralId);
    const bye: Msg = { t: 'bye', id: peer.playerId };
    this.relay(bye, centralId);
    this.out.local(bye, centralId);
    this.out.advertChanged();
  }

  /** Everything the host itself says goes to every phone in the room. */
  broadcast(msg: Msg): void {
    this.relay(msg, null);
  }

  /** The link belonging to one player, for a message meant only for them. */
  linkFor(playerId: string): string | null {
    let found: string | null = null;
    this.peers.forEach((peer, centralId) => {
      if (peer.playerId === playerId) found = centralId;
    });
    return found;
  }

  private relay(msg: Msg, exceptCentralId: string | null): void {
    this.peers.forEach((_peer, centralId) => {
      if (centralId === exceptCentralId) return;
      this.out.toPeer(centralId, msg);
    });
  }
}
