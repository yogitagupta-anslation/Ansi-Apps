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

import { SectionList } from "react-native";
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

async function openWith(params: unknown): Promise<void> {
  const route = {key: "chat", name: "Chat", params} as never;
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

/**
 * Opening a conversation must survive a stale tap.
 *
 * Nearby is a live list: a peer can drop out of range, lose its identity or be forgotten
 * between the tap and the mount. Every one of these used to reach the screen as an
 * assumption — a peerId that is definitely there, params that are definitely shaped the
 * way the caller meant. On a phone the failure of any of those does not show an error,
 * it ends the process, because a throw from a render or an event handler in a release
 * build has nowhere to go.
 */
describe("a stale or broken route", () => {
  it("opens when the peer has no identity yet", async () => {
    useAppStore.setState({
      peers: [peer({ peerId: null, displayName: "Jaismeet", state: "handshaking" })],
    } as never);
    await expect(open("peer-a")).resolves.toBeUndefined();
  });

  it("opens when the route carries no params at all", async () => {
    await expect(openWith(undefined)).resolves.toBeUndefined();
  });

  it("opens when the route names neither a peer nor a group", async () => {
    await expect(openWith({ displayName: "Jaismeet" })).resolves.toBeUndefined();
  });

  it("opens when the peer is named but missing from the store", async () => {
    await expect(
      openWith({ peerId: "vanished", displayName: "Jaismeet" }),
    ).resolves.toBeUndefined();
  });

  it("opens when the peer is present but the radio is not", async () => {
    // Bluetooth off, no link, a failure already recorded against the peer.
    useAppStore.setState({
      bluetoothState: "PoweredOff",
      peers: [
        peer({
          state: "failed",
          linkId: null,
          failure: {
            reason: "AndroidGattError",
            phase: "connecting",
            message: "GATT 133",
            timestamp: Date.now(),
          },
        }),
      ],
    } as never);
    await expect(open("peer-a")).resolves.toBeUndefined();
  });

  it("opens when the peer carries live metrics and diagnostics", async () => {
    // The shapes a real connected peer arrives with, which the earlier cases never had.
    useAppStore.setState({
      peers: [
        peer({
          state: "connected",
          linkId: "c:aa:bb:cc:dd:ee",
          role: "central",
          protocolVersion: 1,
          authenticated: true,
          publicKey: "ab".repeat(32),
          metrics: {
            currentUptimeMs: 42_000,
            totalUptimeMs: 90_000,
            connects: 2,
            disconnects: 1,
            packetsTx: 12,
            packetsRx: 9,
            bytesTx: 512,
            bytesRx: 480,
            framesTx: 14,
            framesRx: 11,
            acksReceived: 12,
            acksMissed: 0,
            avgAckLatencyMs: 41,
            worstAckLatencyMs: 96,
            avgRssi: -49,
            latestRssi: -48,
            mtu: 517,
            sendFailures: 0,
            lossRate: 0,
            quality: 92,
          },
          gatt: {
            serviceFound: true,
            rxCharacteristicFound: true,
            txCharacteristicFound: true,
            notificationsEnabled: true,
            mtu: 517,
          },
        }),
      ],
    } as never);
    await expect(open("peer-a")).resolves.toBeUndefined();
  });
});

/**
 * The scroll that closed the app.
 *
 * Every other test here mounts the screen and stops, which is why they all passed while
 * two phones were dying on this: react-test-renderer performs no layout, so
 * onContentSizeChange never fires and the scroll it triggers never runs. The crash was
 * an invariant thrown out of that callback — a layout callback, not a render, so no
 * error boundary was in the way and the process went down.
 *
 * Firing the callback by hand is the difference between a test that mounts the screen
 * and one that exercises it.
 */
it("survives the list reporting its content size", async () => {
  useAppStore.setState({
    peers: [peer({ state: "connected", linkId: "c:aa:bb" })],
    conversations: {
      "peer-a": [
        message({ direction: "incoming", text: "hello" }),
        message({ direction: "outgoing", text: "hi", status: "received" }),
      ],
    },
  } as never);

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="dark">
          <ChatScreen
            route={
              { key: "chat", name: "Chat", params: { peerId: "peer-a", displayName: "Jaismeet" } } as never
            }
            navigation={NAV}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);

  const list = tree.root.findByType(SectionList);
  expect(typeof list.props.onContentSizeChange).toBe("function");
  // The list must be told how to cope when the index cannot be resolved; without this
  // React Native throws instead of reporting.
  expect(typeof list.props.onScrollToIndexFailed).toBe("function");

  await act(async () => {
    list.props.onContentSizeChange(390, 2000);
  });
});
