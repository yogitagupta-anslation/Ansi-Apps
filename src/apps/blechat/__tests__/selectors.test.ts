/**
 * Regression guard for the blank-screen class of bug.
 *
 * zustand v5 is built on useSyncExternalStore, which compares snapshots with Object.is
 * and applies no implicit shallow equality. A selector that allocates a new array on
 * every call therefore never compares equal to the previous snapshot: React re-renders,
 * the selector allocates again, and the component never finishes rendering. On device
 * that appears as a blank screen with no red box, which is extremely hard to attribute.
 *
 * ChatScreen hit exactly this by selecting `state.conversations[peerId] ?? []` for a
 * peer with no history — the first screen of the two-phone test.
 */
import {selectMessages, type AppState} from '../state/appStore';
import type {ChatMessage} from '../types/Message';

function stateWith(conversations: Record<string, ChatMessage[]>): AppState {
  return {conversations} as AppState;
}

const message: ChatMessage = {
  id: 'm1',
  conversationId: 'peer-1',
  originId: 'peer-1',
  senderId: 'peer-1',
  destinationId: 'me',
  text: 'Hello',
  timestamp: 0,
  receivedAt: 0,
  direction: 'incoming',
  status: 'received',
  protocolVersion: 1,
  ttl: 5,
  hopCount: 0,
  retryCount: 0,
};

describe('selectMessages reference stability', () => {
  it('returns an identical reference for a conversation with no history', () => {
    const state = stateWith({});
    // The exact condition useSyncExternalStore checks between renders.
    expect(selectMessages(state, 'peer-1')).toBe(selectMessages(state, 'peer-1'));
  });

  it('returns an identical reference across distinct state objects', () => {
    // Every unrelated store update (a log line, an RSSI refresh) produces a new state
    // object; the empty result must still be reference-equal or the loop returns.
    expect(selectMessages(stateWith({}), 'peer-1')).toBe(
      selectMessages(stateWith({}), 'peer-2'),
    );
  });

  it('returns an identical reference for a null conversation id', () => {
    const state = stateWith({});
    expect(selectMessages(state, null)).toBe(selectMessages(state, null));
  });

  it('passes the stored array straight through when history exists', () => {
    const stored = [message];
    const state = stateWith({'peer-1': stored});
    expect(selectMessages(state, 'peer-1')).toBe(stored);
  });

  it('never hands back a mutable shared empty array', () => {
    const empty = selectMessages(stateWith({}), 'peer-1');
    expect(empty).toHaveLength(0);
    // Frozen, so an accidental push cannot poison every other conversation.
    expect(Object.isFrozen(empty)).toBe(true);
  });
});
