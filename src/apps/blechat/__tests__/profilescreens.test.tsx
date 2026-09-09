/**
 * The two screens that replaced Settings.
 *
 * Both of them are places where a wrong number or a wrong sentence has consequences off
 * the screen: "Being found" is the only page that can leave the app in a state where
 * nothing will ever happen, and Privacy is where somebody decides whether to trust the
 * claims this app makes about their messages. So what is tested here is the arithmetic
 * and the copy, not the layout.
 */
import React from 'react';
import {Switch, Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {BeingFoundScreen} from '../screens/BeingFoundScreen';
import {PrivacyScreen} from '../screens/PrivacyScreen';
import {ThemeProvider} from '../theme/ThemeProvider';
import {useAppStore} from '../state/appStore';
import {bleChat} from '../services/BleChatService';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

const NAV = {goBack: jest.fn(), navigate: jest.fn()} as never;
const ROUTE = {key: 'r', name: 'BeingFound', params: undefined} as never;

function settings(patch: Record<string, unknown>) {
  useAppStore.setState({
    settings: {...useAppStore.getState().settings, ...patch},
  } as never);
}

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      const parts = Array.isArray(children) ? children : [children];
      return parts
        .map(part => (typeof part === 'string' || typeof part === 'number' ? String(part) : ''))
        .join('');
    })
    .join(' | ');
}

/**
 * Every tree gets torn down after the test that made it.
 *
 * Both screens subscribe to AppState and re-read the lock on resume; a tree left mounted
 * keeps that subscription and re-renders after Jest has pulled the module registry, which
 * surfaces as a require-after-teardown error attached to whichever test ran next.
 */
const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => tree.unmount());
  }
});

async function render(element: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">{element}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

/** Find a pressable by the label screen readers would announce. */
function press(tree: TestRenderer.ReactTestRenderer, label: string): void {
  const node = tree.root.find(
    n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
  );
  act(() => {
    node.props.onPress();
  });
}

describe('Being found', () => {
  let update: jest.SpyInstance;

  beforeEach(() => {
    update = jest.spyOn(bleChat, 'updateSettings').mockResolvedValue(undefined);
  });
  afterEach(() => {
    update.mockRestore();
  });

  it('says so when both halves are off, because then nothing can ever happen', async () => {
    settings({autoAdvertise: false, autoStartScanning: false});
    const tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    expect(textOf(tree)).toContain('nothing can happen');
  });

  it('stays quiet when either half is on', async () => {
    settings({autoAdvertise: false, autoStartScanning: true});
    let tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    expect(textOf(tree)).not.toContain('nothing can happen');

    settings({autoAdvertise: true, autoStartScanning: false});
    tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    expect(textOf(tree)).not.toContain('nothing can happen');
  });

  it('will not step the link budget below one', async () => {
    settings({maxConnections: 1});
    const tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    press(tree, 'Fewer');
    // Zero links is "off", and there is already a switch for that.
    expect(update).toHaveBeenCalledWith({maxConnections: 1});
  });

  it('will not step it past the ceiling', async () => {
    settings({maxConnections: 8});
    const tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    press(tree, 'More');
    expect(update).toHaveBeenCalledWith({maxConnections: 8});
  });

  it('steps in ones in between', async () => {
    settings({maxConnections: 4});
    const tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    press(tree, 'More');
    expect(update).toHaveBeenCalledWith({maxConnections: 5});
    press(tree, 'Fewer');
    expect(update).toHaveBeenCalledWith({maxConnections: 3});
  });

  it('writes each toggle through to settings', async () => {
    settings({autoAdvertise: false});
    const tree = await render(<BeingFoundScreen navigation={NAV} route={ROUTE} />);
    const toggle = tree.root.find(
      n => n.type === Switch && n.props.accessibilityLabel === 'Let people find me',
    );
    act(() => toggle.props.onValueChange(true));
    expect(update).toHaveBeenCalledWith({autoAdvertise: true});
  });
});

describe('Privacy', () => {
  const PRIVACY_ROUTE = {key: 'r', name: 'Privacy', params: undefined} as never;

  afterEach(() => {
    useAppStore.setState({blockedPeerIds: [], securityEvents: []} as never);
  });

  it('names the people you blocked and unblocks the one you pick', async () => {
    const unblock = jest
      .spyOn(bleChat.peerManager, 'unblockPeer')
      .mockImplementation(() => undefined);
    useAppStore.setState({
      blockedPeerIds: ['peer-a'],
      peers: [{peerId: 'peer-a', displayName: 'Ravi'}],
    } as never);

    const tree = await render(<PrivacyScreen navigation={NAV} route={PRIVACY_ROUTE} />);
    expect(textOf(tree)).toContain('Ravi');
    press(tree, 'Unblock Ravi');
    expect(unblock).toHaveBeenCalledWith('peer-a');
    unblock.mockRestore();
  });

  it('states the consequence of having no lock rather than just "off"', async () => {
    const tree = await render(<PrivacyScreen navigation={NAV} route={PRIVACY_ROUTE} />);
    expect(textOf(tree)).toContain('Anyone holding this phone can read your conversations');
  });

  it('reports what security history there is, in words a person can act on', async () => {
    useAppStore.setState({
      securityEvents: [
        {
          id: 'e1',
          at: Date.now(),
          kind: 'authenticationFailed',
          detail: 'Someone claiming to be Ravi could not prove it.',
        },
      ],
    } as never);
    const tree = await render(<PrivacyScreen navigation={NAV} route={PRIVACY_ROUTE} />);
    const text = textOf(tree);
    expect(text).toContain('could not prove it');
    expect(text).not.toContain('authenticationFailed');
  });
});
