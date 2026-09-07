/**
 * Opening a conversation must never take the app down.
 *
 * The Chat button appears on peers that are NOT connected — in the "Earlier" section it
 * is the only action there is — so the screen has to stand up with no link, no metrics,
 * no capabilities and no messages. That is the state it crashed in on a real phone.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatScreen } from "../screens/ChatScreen";
import { ThemeProvider } from "../theme/ThemeProvider";
import { useAppStore } from "../state/appStore";
import type { Peer } from "../types/Peer";
import type { ChatMessage } from "../types/Message";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const NAV = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  setOptions: jest.fn(),
} as never;

function peer(patch: Partial<Peer>): Peer {
  return {
    peerId: "peer-a",
    peerIdPrefix: "pe",
    displayName: "Jais",
    interests: [],
    languages: [],
    linkId: null,
    role: null,
    state: "disconnected",
    rssi: null,
    lastSeen: Date.now(),
    protocolVersion: null,
    capabilities: null,
    agreedCapabilities: null,
    compatibilityNote: null,
    publicKey: null,
    authenticated: false,
    queuedCount: 0,
    metrics: null,
    gatt: null,
    failure: null,
    firstSeen: Date.now(),
    connectCount: 0,
    attempts: 0,
    failures: 0,
    reconnectAttempt: 0,
    ...patch,
  };
}

/** Trees are torn down after each test; a mounted screen keeps subscriptions alive. */
const mounted: TestRenderer.ReactTestRenderer[] = [];

function message(patch: Partial<ChatMessage>): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    conversationId: 'peer-a',
    originId: 'peer-a',
    senderId: 'peer-a',
    destinationId: 'me',
    text: 'hello',
    timestamp: Date.now(),
    receivedAt: Date.now(),
    direction: 'incoming',
    status: 'received',
    protocolVersion: 1,
    ttl: 1,
    hopCount: 0,
    retryCount: 0,
    ...patch,
  };
}

async function open(peerId: string): Promise<void> {
  const route = {
    key: "chat",
    name: "Chat",
    params: { peerId, displayName: "Jais" },
  } as never;
  await act(async () => {
    mounted.push(
      TestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}>
          <ThemeProvider mode="dark">
            <ChatScreen route={route} navigation={NAV} />
          </ThemeProvider>
        </SafeAreaProvider>,
      ),
    );
  });
}

afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => tree.unmount());
  }
  useAppStore.setState({ peers: [] } as never);
});

it("opens on a peer that is known but out of range", async () => {
  useAppStore.setState({ peers: [peer({ state: "disconnected" })] } as never);
  await expect(open("peer-a")).resolves.toBeUndefined();
});

it("opens on a peer the store has never heard of", async () => {
  await expect(open("peer-ghost")).resolves.toBeUndefined();
});

it("opens on a peer that is mid-reconnect", async () => {
  useAppStore.setState({
    peers: [peer({ state: "connecting", reconnectAttempt: 2 })],
  } as never);
  await expect(open("peer-a")).resolves.toBeUndefined();
});

/**
 * A thread that has actually been used, in every delivery state at once.
 *
 * The screens that crashed on a phone had history in them; an empty conversation
 * exercises almost none of the bubble code. This is the state a real chat is in.
 */
it('opens on a conversation with history in every state', async () => {
  useAppStore.setState({
    peers: [peer({state: 'disconnected'})],
    conversations: {
      'peer-a': [
        message({direction: 'incoming', status: 'received', text: 'hey'}),
        message({direction: 'outgoing', status: 'pending', text: 'waiting'}),
        message({direction: 'outgoing', status: 'sending', text: 'in flight',
          fragmentProgress: {sent: 1, total: 3}}),
        message({direction: 'outgoing', status: 'failed', text: 'did not go'}),
        message({direction: 'outgoing', status: 'received', text: 'delivered',
          deliveredTo: ['peer-a'], recipientCount: 1}),
        // A gap the receiver noticed, and a sender whose clock is hours out.
        message({direction: 'incoming', status: 'received', text: 'after a gap',
          missedBefore: 2, convSeq: 9, clockSkewMs: 4 * 60 * 60 * 1000}),
        message({direction: 'incoming', status: 'received', text: 'x'.repeat(4000)}),
      ],
    },
  } as never);
  await expect(open('peer-a')).resolves.toBeUndefined();
});
