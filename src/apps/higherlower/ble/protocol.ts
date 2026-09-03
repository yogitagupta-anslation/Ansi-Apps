/**
 * Wire protocol for the BLE link.
 *
 * Every message is a small JSON object with one-or-two-character keys, because
 * a BLE characteristic write has to fit inside the negotiated MTU (as little as
 * 20 bytes of payload on older stacks, ~180 after a successful MTU request).
 * `encode` refuses to emit anything larger than MAX_PAYLOAD so an oversized
 * message is caught here rather than silently truncated by the radio.
 */

export const MAX_PAYLOAD = 180;

export type Msg =
  /** Peer announces itself after connecting to a room. */
  | { t: 'hello'; id: string; nm: string }
  /** Peer is leaving the room. */
  | { t: 'bye'; id: string }
  /** Lobby ready-state toggle. */
  | { t: 'rdy'; id: string; r: boolean }
  /**
   * Host opens a round. The target travels with it: each device judges its own
   * player's guesses locally so the feedback is instant instead of waiting on a
   * round trip. Peers are trusted — this is a party game over a 10m radio.
   */
  | {
      t: 'go';
      rid: string;
      lo: number;
      hi: number;
      tg: number;
      /** Race mode: how the winner is decided. */
      md?: string;
      /** Modifier ids the host switched on. */
      mf?: string[];
    }
  /** A guess, relayed so every screen can watch the opponents close in. */
  | { t: 'g'; rid: string; id: string; v: number }
  /**
   * "I found it", with the guess count and elapsed ms. Everyone sends one when
   * they get there -- it reports a finish, it does not stop anybody else. The
   * earliest one is the winner.
   */
  | { t: 'fin'; rid: string; id: string; n: number; ms: number }
  /** Host closes the round once the room is done; `id` is the winner. */
  | { t: 'end'; rid: string; id: string }
  /** A reaction someone tapped, so it can pop on every screen. */
  | { t: 'rx'; id: string; e: string }
  /**
   * Link to this player dropped or came back. Distinct from 'bye': they did not
   * leave, so their result is kept and their lane says "reconnecting".
   */
  | { t: 'off'; id: string }
  | { t: 'on'; id: string };

export function encode(msg: Msg): string {
  const json = JSON.stringify(msg);
  if (json.length > MAX_PAYLOAD) {
    throw new Error(`BLE payload too large (${json.length} > ${MAX_PAYLOAD}): ${msg.t}`);
  }
  return json;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parses an inbound payload. Anything malformed returns null rather than
 * throwing — a garbled notification should drop a packet, not kill the round.
 */
export function decode(raw: string): Msg | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const m = parsed as Record<string, unknown>;

  switch (m.t) {
    case 'hello':
      return isStr(m.id) && isStr(m.nm) ? { t: 'hello', id: m.id, nm: m.nm } : null;
    case 'bye':
      return isStr(m.id) ? { t: 'bye', id: m.id } : null;
    case 'rdy':
      return isStr(m.id) && typeof m.r === 'boolean' ? { t: 'rdy', id: m.id, r: m.r } : null;
    case 'go': {
      if (!(isStr(m.rid) && isNum(m.lo) && isNum(m.hi) && isNum(m.tg))) return null;
      const mf = Array.isArray(m.mf) && m.mf.every(isStr) ? (m.mf as string[]) : undefined;
      return { t: 'go', rid: m.rid, lo: m.lo, hi: m.hi, tg: m.tg, ...(isStr(m.md) ? { md: m.md } : {}), ...(mf ? { mf } : {}) };
    }
    case 'g':
      return isStr(m.rid) && isStr(m.id) && isNum(m.v) ? { t: 'g', rid: m.rid, id: m.id, v: m.v } : null;
    case 'fin':
      return isStr(m.rid) && isStr(m.id) && isNum(m.n) && isNum(m.ms)
        ? { t: 'fin', rid: m.rid, id: m.id, n: m.n, ms: m.ms }
        : null;
    case 'end':
      return isStr(m.rid) && isStr(m.id) ? { t: 'end', rid: m.rid, id: m.id } : null;
    case 'off':
      return isStr(m.id) ? { t: 'off', id: m.id } : null;
    case 'on':
      return isStr(m.id) ? { t: 'on', id: m.id } : null;
    case 'rx':
      // Cap the emoji length: a reaction is one glyph, not a payload.
      return isStr(m.id) && isStr(m.e) && m.e.length <= 8 ? { t: 'rx', id: m.id, e: m.e } : null;
    default:
      return null;
  }
}
