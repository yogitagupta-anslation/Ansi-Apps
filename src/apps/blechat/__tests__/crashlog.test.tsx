/**
 * The crash record has to survive the thing that produced it.
 *
 * "The app just closes" has been impossible to act on because a release build takes its
 * in-memory log down with it — by the time anyone can look, the evidence is gone. This is
 * the round trip that fixes that: write on the way down, read it back after the restart,
 * show it somewhere a person can screenshot.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

/**
 * Diagnostics animates its sections in on the native driver, which has no host to talk
 * to under Jest and keeps running after the test ends. The entrance is not what is being
 * tested here — whether the crash reaches the screen is — so it is replaced by its own
 * end state.
 */
jest.mock('../components/Motion', () => {
  const {Pressable, View} = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  return {
    useReduceMotion: () => true,
    FadeIn: ({children}: {children: React.ReactNode}) =>
      React.createElement(View, null, children),
    SendIn: ({children}: {children: React.ReactNode}) =>
      React.createElement(View, null, children),
    Touchable: ({children, ...rest}: {children: React.ReactNode}) =>
      React.createElement(Pressable, rest, children),
  };
});

import {clearCrash, loadCrash, saveCrash} from '../utils/crashLog';
import {DebugScreen} from '../screens/DebugScreen';
import {ThemeProvider} from '../theme/ThemeProvider';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

/** A fresh process reads it back from storage, not from a variable it still holds. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
  await clearCrash();
});

it('keeps the message and the stack', async () => {
  const error = new Error('Cannot read property peerId of undefined');
  saveCrash('fatal', error);
  await flush();

  const record = await loadCrash();
  expect(record?.message).toBe('Cannot read property peerId of undefined');
  expect(record?.kind).toBe('fatal');
  expect(record?.stack.length).toBeGreaterThan(0);
});

it('bounds a stack that would be too big to write', async () => {
  // A component stack runs to thousands of lines, and the write happens at the one
  // moment the process is least likely to survive a big one.
  saveCrash('render', new Error('boom'), 'at Component\n'.repeat(5000));
  await flush();

  const record = await loadCrash();
  expect(record?.stack.length).toBeLessThanOrEqual(4000);
});

it('reports nothing when nothing has crashed', async () => {
  await clearCrash();
  expect(await loadCrash()).toBeNull();
});

it('shows the crash in Diagnostics, where it can be read and reported', async () => {
  saveCrash('render', new Error('Cannot read property peerId of undefined'));
  await flush();

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">
          <DebugScreen
            navigation={{goBack: jest.fn(), navigate: jest.fn()} as never}
            route={{key: 'd', name: 'Debug', params: undefined} as never}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });

  // It lives on the Logs tab, which is where somebody sent looking for it will go.
  const logsTab = tree.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node =>
      node
        .findAllByType(Text)
        .some(t => t.props.children === 'Logs'),
    );
  expect(logsTab).toBeDefined();
  await act(async () => {
    logsTab!.props.onPress();
  });

  const text = tree.root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      const parts = Array.isArray(children) ? children : [children];
      return parts
        .map(part => (typeof part === 'string' || typeof part === 'number' ? String(part) : ''))
        .join('');
    })
    .join(' | ');
  expect(text).toContain('Last crash');
  expect(text).toContain('Cannot read property peerId of undefined');

  act(() => tree.unmount());
});
