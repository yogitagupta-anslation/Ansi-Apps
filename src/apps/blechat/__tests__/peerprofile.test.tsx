/**
 * The card you get when you tap somebody.
 *
 * It opens from two places, and the difference between them is the whole reason this
 * needs a test. From Nearby, "Open chat" is the point of the card and takes the fill.
 * From inside the conversation there is nowhere to go, so no primary action is passed —
 * and the row used to render as two bare circles against the left edge with the rest of
 * the width empty, which is what made the sheet look broken. With no primary, the two
 * remaining actions share the width and carry their labels.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {PeerProfileSheet} from '../components/PeerProfileSheet';
import {ThemeProvider} from '../theme/ThemeProvider';
import type {Peer} from '../types/Peer';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function peer(patch: Partial<Peer> = {}): Peer {
  return {
    peerId: 'f85818bd95dd0feb1122334455667788',
    peerIdPrefix: 'f858',
    displayName: 'Jaismeet',
    interests: ['Music', 'Coding', 'Gaming'],
    languages: [],
    linkId: 'c:aa',
    role: 'central',
    state: 'connected',
    rssi: -54,
    lastSeen: Date.now(),
    protocolVersion: 4,
    capabilities: null,
    agreedCapabilities: null,
    compatibilityNote: null,
    publicKey: null,
    authenticated: true,
    queuedCount: 0,
    metrics: null,
    gatt: {
      serviceFound: true,
      rxCharacteristicFound: true,
      txCharacteristicFound: true,
      notificationsEnabled: true,
      mtu: 517,
    },
    failure: null,
    firstSeen: Date.now(),
    connectCount: 1,
    attempts: 1,
    failures: 0,
    reconnectAttempt: 0,
    ...patch,
  };
}

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => tree.unmount());
  }
});

async function open(
  props: Partial<React.ComponentProps<typeof PeerProfileSheet>> = {},
): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">
          <PeerProfileSheet
            visible
            peer={peer()}
            myInterests={['Music', 'Coding']}
            blocked={false}
            onClose={() => undefined}
            onBlock={() => undefined}
            {...props}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

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

it('leads with the person, then what you have in common, then the radio', async () => {
  const shown = words(await open({onOpenChat: () => undefined}));
  const person = shown.indexOf('Jaismeet');
  const common = shown.indexOf('SHARED INTERESTS');
  const radio = shown.indexOf('CONNECTION');
  expect(person).toBeGreaterThanOrEqual(0);
  // Signal strength is the footnote to the reason you opened the card, not the headline.
  expect(common).toBeGreaterThan(person);
  expect(radio).toBeGreaterThan(common);
});

it('says where they are, not just that they are connected', async () => {
  const shown = words(await open());
  expect(shown).toContain('Connected · very close');
});

it('gives the action row a filled verb when there is somewhere to go', async () => {
  const shown = words(await open({onOpenChat: () => undefined}));
  expect(shown).toContain('Open chat');
  // The other two stay as circles beside it, so no duplicate labels.
  expect(shown).not.toContain('Favourite');
});

it('fills the row with labelled halves when there is not', async () => {
  // Opened from inside the conversation: no onOpenChat. This is the case that rendered
  // as two lonely circles.
  const shown = words(await open());
  expect(shown).not.toContain('Open chat');
  expect(shown).toContain('Favourite');
  expect(shown).toContain('Block');
});

it('names the packet size for what it is', async () => {
  const shown = words(await open());
  // The app fragments, so there is no "message size limit" to report — what the number
  // actually describes is how much goes out in one write.
  expect(shown).toContain('517 bytes');
  expect(shown).not.toContain('Message size limit');
});
