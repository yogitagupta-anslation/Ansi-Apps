/**
 * Deleting a conversation, and finding one.
 *
 * Both are about telling the truth. The confirmation has to say how far "delete"
 * actually reaches — this phone, and no further, because there is no server and the
 * other side already has the bytes. And a search box that offers to search "names and
 * messages" has to search the messages, not just the last line of each thread.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ConfirmSheet} from '../components/ConfirmSheet';
import {ThemeProvider} from '../theme/ThemeProvider';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

async function render(props: Partial<React.ComponentProps<typeof ConfirmSheet>> = {}) {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">
          <ConfirmSheet
            visible
            title="Delete this conversation?"
            body="3 messages with Jaismeet will be removed from this phone. Jaismeet keeps their copy — there is no server to delete it from, and this cannot be undone."
            confirmLabel="Delete for me"
            onConfirm={() => undefined}
            onCancel={() => undefined}
            {...props}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  const text = tree.root
    .findAllByType(Text)
    .map(n => (typeof n.props.children === 'string' ? n.props.children : ''))
    .join(' | ');
  return {tree, text};
}

describe('the delete confirmation', () => {
  it('names the reach of the deletion, not just the act', async () => {
    const {text} = await render();
    // The part people get wrong about a serverless app.
    expect(text).toContain('keeps their copy');
    expect(text).toContain('cannot be undone');
  });

  it('puts the verb on the button rather than "OK"', async () => {
    const {text} = await render();
    expect(text).toContain('Delete for me');
    expect(text).not.toContain('OK');
  });

  it('offers cancel, and makes tapping away mean cancel', async () => {
    const cancelled: string[] = [];
    const {tree, text} = await render({onCancel: () => cancelled.push('x')});
    expect(text).toContain('Cancel');

    // The scrim: the safe outcome is the one that happens by accident.
    const scrim = tree.root.find(
      n => n.props.accessibilityLabel === 'Cancel' && !!n.props.onPress,
    );
    act(() => scrim.props.onPress());
    expect(cancelled).toHaveLength(1);
  });

  it('confirms only when the destructive button is pressed', async () => {
    const done: string[] = [];
    const {tree} = await render({onConfirm: () => done.push('x')});
    const button = tree.root
      .findAll(n => typeof n.props.onPress === 'function')
      .find(n =>
        n.findAllByType(Text).some(t => t.props.children === 'Delete for me'),
      );
    expect(button).toBeDefined();
    act(() => button!.props.onPress());
    expect(done).toEqual(['x']);
  });
});
