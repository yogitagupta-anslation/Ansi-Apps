/**
 * What the Connections screen is allowed to say about a connection.
 *
 * Three rules live here rather than inside the screen, because each one is a
 * correctness rule wearing presentation clothes, and the screen is a `.tsx` the
 * bare-node `eventpulse` Jest project cannot load.
 *
 *  1. Chat is offered for an accepted connection and nothing else. Not for a
 *     request you sent, not for one you received, not for one that was declined.
 *  2. "Nearby" means a live Bluetooth link exists, never that the radar can see
 *     them. Someone can be three metres away and completely unreachable — the
 *     radar is a beacon and the connection is a separate connectable service.
 *  3. An outgoing request carries OUR card, not theirs. Rendering it would show
 *     someone their own name under "Awaiting reply".
 *
 * Nothing here reads a store, a radio or a clock; everything is passed in.
 */

import type { ConnectionCard } from './ConnectionProtocol';
import { canOpenChat } from './ConversationService';
import type { ConnectionState } from '../types';

/** Which of the screen's three lists a connection belongs to, if any. */
export type ConnectionSection = 'requests' | 'awaiting' | 'connected' | null;

export function sectionFor(state: ConnectionState): ConnectionSection {
  if (state === 'incoming_pending') return 'requests';
  if (state === 'outgoing_pending') return 'awaiting';
  if (state === 'connected') return 'connected';
  return null;
}

/**
 * May this row offer Chat?
 *
 * Delegates rather than re-deriving: `canOpenChat` is the gate the Connection
 * Space itself uses, and two answers to one question is how a Chat button ends
 * up on a request nobody has accepted yet.
 */
export function chatAllowed(state: ConnectionState): boolean {
  return canOpenChat(state);
}

/**
 * May this row's Chat be pressed right now?
 *
 * Two separate facts, and both are required. `chatAllowed` is the persisted
 * relationship — nothing opens a conversation with someone who has not accepted,
 * however close they are standing. `live` is a GATT link, which is what a
 * message actually travels on.
 *
 * The pair is what makes coming back into range work without a new request: the
 * relationship never lapsed, so when the link returns this flips back to true on
 * its own and the button wakes up.
 */
export function chatEnabled(state: ConnectionState, live: boolean): boolean {
  return chatAllowed(state) && live;
}

export interface ConnectedStatus {
  label: string;
  /** True only when a message could actually leave the radio right now. */
  live: boolean;
}

/**
 * The status line on an accepted connection.
 *
 * `live` must come from `queries.canChat` — a live GATT link — and never from
 * `queries.nearbyFor`, which only says their advertisement was seen recently.
 * The row's own proximity meta keeps speaking the radar's language separately;
 * these two are deliberately different vocabularies so neither has to lie for
 * the other.
 */
export function connectedStatus(live: boolean): ConnectedStatus {
  return live
    ? { label: 'Connected · nearby', live: true }
    : { label: 'Connected · away', live: false };
}

export interface RowIdentity {
  /** Null when this phone genuinely has no name for them. */
  name: string | null;
  /** "Role · Company", or null when neither is known. */
  detail: string | null;
}

export interface IdentitySource {
  state: ConnectionState;
  /** The card stored on the connection. Whose card it is depends on direction. */
  card?: ConnectionCard | null;
  directoryName?: string | null;
  directoryRole?: string | null;
  directoryCompany?: string | null;
}

/**
 * Who to show on a row, and who never to show.
 *
 * The directory answer is always theirs, so it wins when present. The stored
 * card is only theirs once they have answered: `writeConnection` stamps
 * `myCard()` onto an outgoing request when it goes out, and only an accept
 * replaces it with the far side's. So for `outgoing_pending` the card is
 * skipped entirely and the row stays honestly unnamed.
 */
export function rowIdentity(source: IdentitySource): RowIdentity {
  const detailFrom = (role?: string | null, company?: string | null): string | null =>
    [role, company].filter((part): part is string => Boolean(part && part.trim())).join(' · ') ||
    null;

  if (source.directoryName) {
    return {
      name: source.directoryName,
      detail: detailFrom(source.directoryRole, source.directoryCompany),
    };
  }

  const cardIsTheirs = source.state !== 'outgoing_pending';
  if (cardIsTheirs && source.card?.name) {
    return {
      name: source.card.name,
      detail: detailFrom(source.card.role, source.card.company),
    };
  }

  return { name: null, detail: null };
}
