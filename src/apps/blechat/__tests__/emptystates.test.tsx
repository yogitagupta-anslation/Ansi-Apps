/**
 * What each screen says when it has nothing to show.
 *
 * These are the states a first-time user meets first, and the states a working app spends
 * most of its time in — an empty room, an untouched conversation, a search that found
 * nobody. Each one used to answer a different question from the one being asked:
 *
 *  - Nearby declared "Nobody here yet" the instant it opened, which is a verdict on a
 *    sweep that has not happened. Two phones on the same desk both showed it.
 *  - Chats offered no way out of an empty list, on a screen whose whole content is a
 *    sentence telling you to go somewhere else.
 *  - A search with no hits said only that there were no hits, on an app with no directory
 *    to search — which is the actual answer.
 *  - An untouched thread led with "No messages yet", a caption on the problem rather than
 *    help with the hardest moment the app has.
 *
 * The assertions below are about the words, because in an empty state the words ARE the
 * screen.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ChatScreen} from '../screens/ChatScreen';
import {NearbyEmpty} from '../components/NearbyEmpty';
import {ThemeProvider} from '../theme/ThemeProvider';
import {useAppStore} from '../state/appStore';
import type {Peer} from '../types/Peer';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

/** Every string this tree would put in front of somebody, flattened. */
function words(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map(n =>
      (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
        .filter((c: unknown) => typeof c === 'string' || typeof c === 'number')
        .join(''),
    )
    .join(' | ');
}

const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => tree.unmount());
  }
  useAppStore.setState({peers: [], conversations: {}} as never);
});

async function mount(node: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

describe('an empty Nearby', () => {
  it('does not call the room empty while the first sweep is still running', async () => {
    const tree = await mount(
      <NearbyEmpty
        kind="searching"
        firstLook
        queuedCount={0}
        otherDevices={3}
        onPrimary={() => undefined}
      />,
    );
    const shown = words(tree);
    expect(shown).toContain('Looking around');
    expect(shown).toContain('First look takes a few seconds');
    expect(shown).not.toContain('Nobody here yet');
    // Restarting a scan that has not finished spends one of Android's five starts per
    // thirty seconds and makes discovery slower, so the button is not offered yet.
    expect(shown).not.toContain('Look again');
  });

  it('says so plainly once the sweep has had its chance', async () => {
    const tree = await mount(
      <NearbyEmpty
        kind="searching"
        queuedCount={0}
        otherDevices={3}
        onPrimary={() => undefined}
      />,
    );
    const shown = words(tree);
    expect(shown).toContain('Nobody here yet');
    expect(shown).toContain('Look again');
    // The proof that the radio is working, which is the question an empty list raises.
    expect(shown).toContain('3 other Bluetooth devices');
  });

  it('still leads with the radio when Bluetooth is the problem', async () => {
    const tree = await mount(
      <NearbyEmpty
        kind="off"
        firstLook
        queuedCount={2}
        otherDevices={0}
        onPrimary={() => undefined}
      />,
    );
    const shown = words(tree);
    // firstLook is about discovery, not about a switched-off adapter: a radio that is off
    // is off from the first frame and there is nothing to wait for.
    expect(shown).toContain('Turn on Bluetooth');
    expect(shown).toContain('2 messages');
  });
});

function peer(patch: Partial<Peer>): Peer {
  return {
    peerId: 'peer-a',
    peerIdPrefix: 'pe',
    displayName: 'Jaismeet',
    interests: [],
    languages: [],
    linkId: null,
    role: null,
    state: 'connected',
    rssi: -54,
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
    screenshotPolicy: null,
    ...patch,
  };
}

const NAV = {goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn()} as never;

async function openChat(): Promise<TestRenderer.ReactTestRenderer> {
  const route = {
    key: 'chat',
    name: 'Chat',
    params: {peerId: 'peer-a', displayName: 'Jaismeet'},
  } as never;
  return mount(<ChatScreen route={route} navigation={NAV} />);
}

describe('an untouched conversation', () => {
  it('asks for a first message by name', async () => {
    useAppStore.setState({peers: [peer({})]} as never);
    const shown = words(await openChat());
    expect(shown).toContain('Say something to Jaismeet');
    expect(shown).not.toContain('No messages yet');
  });

  it('offers what you have in common as the thing to say', async () => {
    useAppStore.setState({
      peers: [peer({interests: ['Cricket', 'Films']})],
      settings: {...useAppStore.getState().settings, interests: ['Cricket']},
    } as never);
    const shown = words(await openChat());
    expect(shown).toContain('You both like Cricket');
  });

  it('says something true when there is nothing in common', async () => {
    useAppStore.setState({
      peers: [peer({interests: ['Gaming']})],
      settings: {...useAppStore.getState().settings, interests: ['Cricket']},
    } as never);
    const shown = words(await openChat());
    // No invented warmth. The fallback is the one genuinely reassuring fact about this
    // app, which is where the message actually goes.
    expect(shown).not.toContain('You both like');
    expect(shown).toContain('straight to their phone');
  });
});
