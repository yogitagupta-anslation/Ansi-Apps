/**
 * The three things the Connections screen must never get wrong.
 *
 * Each of these is a correctness rule that happens to be rendered. A Chat
 * button on an unanswered request invites someone into a conversation that
 * cannot exist; "Connected · nearby" derived from the radar tells them a
 * message will send when it will not; and an outgoing request rendered from its
 * stored card shows a person their own name under "Awaiting reply".
 *
 * All three are pure functions of values the screen already has, so they are
 * pinned here rather than in a render test the bare-node project cannot run.
 */

import {
  chatAllowed,
  chatEnabled,
  connectedStatus,
  rowIdentity,
  sectionFor,
} from '../connections/connectionPresentation';
import type { ConnectionCard } from '../connections/ConnectionProtocol';
import type { ConnectionState } from '../types';

const THEIR_CARD: ConnectionCard = {
  profileId: 'ep_ANJA',
  name: 'Anja Park',
  role: 'Product Manager',
  company: 'Sable',
};

/** What an outgoing request actually stores: OUR card, not theirs. */
const MY_CARD: ConnectionCard = {
  profileId: 'ep_ME',
  name: 'Jaismeet Kaur',
  role: 'Software Engineer',
  company: 'Anslation',
};

const EVERY_STATE: ConnectionState[] = [
  'none',
  'outgoing_pending',
  'incoming_pending',
  'connected',
  'declined',
  'cancelled',
  'expired',
  'failed',
];

/* ------------------------------------------------------------------ *
 * 1. Sections
 * ------------------------------------------------------------------ */

describe('sectionFor', () => {
  it('files each pending direction under its own heading', () => {
    expect(sectionFor('incoming_pending')).toBe('requests');
    expect(sectionFor('outgoing_pending')).toBe('awaiting');
    expect(sectionFor('connected')).toBe('connected');
  });

  it('lists nothing for a state that is not a live relationship', () => {
    // A declined or expired request is not a row. It used to be counted in a
    // heading while rendering nothing, which is how "Awaiting reply · 1" ended
    // up sitting above an empty space.
    for (const state of ['none', 'declined', 'cancelled', 'expired', 'failed'] as ConnectionState[]) {
      expect(sectionFor(state)).toBeNull();
    }
  });

  it('assigns every state in the union exactly one answer', () => {
    for (const state of EVERY_STATE) {
      const section = sectionFor(state);
      expect(section === null || ['requests', 'awaiting', 'connected'].includes(section)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. Chat is only ever offered on an accepted connection
 * ------------------------------------------------------------------ */

describe('chatAllowed', () => {
  it('allows chat once the connection is accepted', () => {
    expect(chatAllowed('connected')).toBe(true);
  });

  it('refuses chat for every other state', () => {
    /*
     * The four the brief names explicitly — incoming, outgoing, rejected and
     * unaccepted — plus the rest of the union, so a new member cannot quietly
     * inherit a Chat button.
     */
    for (const state of EVERY_STATE.filter((s) => s !== 'connected')) {
      expect(chatAllowed(state)).toBe(false);
    }
  });

  it('refuses chat on an incoming request even though a link exists', () => {
    // The link is real during a pending exchange — that is how the request
    // arrived. Liveness still does not grant chat; the accepted state does.
    expect(chatAllowed('incoming_pending')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 2b. Chat needs BOTH the relationship and the link
 * ------------------------------------------------------------------ */

describe('chatEnabled', () => {
  it('is true only when accepted and a live link exists', () => {
    expect(chatEnabled('connected', true)).toBe(true);
  });

  it('is false for an accepted person who is out of range', () => {
    // The relationship survives; the link is what went away.
    expect(chatEnabled('connected', false)).toBe(false);
  });

  it('is false for a pending request even with a live link', () => {
    /*
     * The case that matters most. A link IS open during a pending exchange —
     * that is how the request travelled — so liveness alone would put a Chat
     * button on a request nobody has accepted.
     */
    expect(chatEnabled('incoming_pending', true)).toBe(false);
    expect(chatEnabled('outgoing_pending', true)).toBe(false);
  });

  it('is false for every terminal state, live or not', () => {
    for (const state of ['declined', 'cancelled', 'expired', 'failed', 'none'] as ConnectionState[]) {
      expect(chatEnabled(state, true)).toBe(false);
      expect(chatEnabled(state, false)).toBe(false);
    }
  });

  it('comes back on its own when an accepted person returns to range', () => {
    /*
     * No new request, no re-accept: the same `connected` state, a link that
     * dropped and returned. This is the whole of "coming back into range".
     */
    const state: ConnectionState = 'connected';
    expect(chatEnabled(state, true)).toBe(true);
    expect(chatEnabled(state, false)).toBe(false);
    expect(chatEnabled(state, true)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 3. "Nearby" is a link, never the radar
 * ------------------------------------------------------------------ */

describe('connectedStatus', () => {
  it('says nearby only when a message could actually go out', () => {
    expect(connectedStatus(true)).toEqual({ label: 'Connected · nearby', live: true });
  });

  it('says away when there is no live link', () => {
    expect(connectedStatus(false)).toEqual({ label: 'Connected · away', live: false });
  });

  it('never claims nearby from anything but the link flag', () => {
    /*
     * The failure this exists to prevent: someone visible on the radar, three
     * metres away, with no connectable link — "Connected · nearby" there is a
     * promise the next tap cannot keep.
     */
    const radarSaysClose = true;
    const linkIsOpen = false;
    void radarSaysClose;
    expect(connectedStatus(linkIsOpen).label).toBe('Connected · away');
  });
});

/* ------------------------------------------------------------------ *
 * 4. Whose card is it
 * ------------------------------------------------------------------ */

describe('rowIdentity', () => {
  it('never renders our own card back at us on an outgoing request', () => {
    // The bug this forecloses: "Awaiting reply — Jaismeet Kaur", i.e. the user
    // waiting for a reply from themselves.
    const identity = rowIdentity({ state: 'outgoing_pending', card: MY_CARD });
    expect(identity.name).toBeNull();
    expect(identity.detail).toBeNull();
  });

  it('renders their card on an incoming request', () => {
    // An inbound request carries the sender's card, so it is safe and it is the
    // only thing this phone knows about them offline.
    expect(rowIdentity({ state: 'incoming_pending', card: THEIR_CARD })).toEqual({
      name: 'Anja Park',
      detail: 'Product Manager · Sable',
    });
  });

  it('renders their card on an accepted connection', () => {
    expect(rowIdentity({ state: 'connected', card: THEIR_CARD }).name).toBe('Anja Park');
  });

  it('prefers the directory over the stored card', () => {
    const identity = rowIdentity({
      state: 'connected',
      card: THEIR_CARD,
      directoryName: 'Anja Park',
      directoryRole: 'Head of Product',
      directoryCompany: 'Sable',
    });
    expect(identity.detail).toBe('Head of Product · Sable');
  });

  it('uses the directory even on an outgoing request, because that answer is theirs', () => {
    const identity = rowIdentity({
      state: 'outgoing_pending',
      card: MY_CARD,
      directoryName: 'Anja Park',
      directoryRole: 'Product Manager',
    });
    expect(identity.name).toBe('Anja Park');
    expect(identity.detail).toBe('Product Manager');
  });

  it('returns null rather than inventing a name', () => {
    expect(rowIdentity({ state: 'connected', card: null })).toEqual({ name: null, detail: null });
  });

  it('omits an empty detail instead of rendering a stray separator', () => {
    const identity = rowIdentity({
      state: 'connected',
      card: { profileId: 'ep_X', name: 'Sam' },
    });
    expect(identity.name).toBe('Sam');
    expect(identity.detail).toBeNull();
  });

  it('drops a blank role without leaving the separator behind', () => {
    const identity = rowIdentity({
      state: 'connected',
      card: { profileId: 'ep_X', name: 'Sam', role: '   ', company: 'Sable' },
    });
    expect(identity.detail).toBe('Sable');
  });
});
