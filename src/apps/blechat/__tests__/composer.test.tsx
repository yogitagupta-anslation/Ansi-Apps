/**
 * The composer's contract, which changed.
 *
 * It used to be disabled whenever the link was down. It is now open, because
 * `MessageService.send` checks `canReach` and puts the message in the outbox — the
 * transport half of that is already proven in integration.test ("queues a message when
 * there is no route, without claiming it was sent"). What was NOT covered is the screen
 * half: that opening the input actually hands the text over rather than dropping it, and
 * that it still refuses when there is genuinely nothing to address.
 *
 * That distinction is the whole risk of the change. An input that accepts keystrokes and
 * silently discards them is worse than one that refuses them.
 */
import React from 'react';
import {Text, TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

import {MessageInput} from '../components/MessageInput';
import {Icon} from '../components/ui/Icon';
import {ThemeProvider} from '../theme/ThemeProvider';

interface Rendered {
  tree: TestRenderer.ReactTestRenderer;
  text: string;
  icons: string[];
}

async function render(props: Partial<React.ComponentProps<typeof MessageInput>>): Promise<Rendered> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ThemeProvider mode="light">
        <MessageInput
          enabled
          disabledReason="nothing to address"
          onSend={() => undefined}
          {...props}
        />
      </ThemeProvider>,
    );
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
  return {tree, text, icons: tree.root.findAllByType(Icon).map(n => String(n.props.name))};
}

/** Types into the field and fires the submit the keyboard's send key fires. */
async function typeAndSend(tree: TestRenderer.ReactTestRenderer, value: string): Promise<void> {
  const input = tree.root.findByType(TextInput);
  await act(async () => {
    input.props.onChangeText(value);
  });
  await act(async () => {
    input.props.onSubmitEditing();
  });
}

describe('composer', () => {
  it('hands the text over while the peer is out of range', async () => {
    const sent: string[] = [];
    const {tree} = await render({
      queueing: true,
      queueingReason: 'They are out of range',
      onSend: text => sent.push(text),
    });

    await typeAndSend(tree, 'are you there');

    // The point of the change: the keystrokes are not thrown away.
    expect(sent).toEqual(['are you there']);
  });

  it('is editable while queueing', async () => {
    const {tree} = await render({queueing: true, queueingReason: 'out of range'});
    expect(tree.root.findByType(TextInput).props.editable).toBe(true);
  });

  it('says the message will be sent later rather than that it failed', async () => {
    const {text} = await render({
      queueing: true,
      queueingReason: 'Messages send themselves when Neha is back in range.',
    });
    expect(text).toContain('send themselves when Neha is back in range');
    // Reassurance, not an error: nothing here should read as a failure.
    expect(text).not.toMatch(/failed|error|cannot send/i);
  });

  it('shows a clock rather than a send arrow while queueing', async () => {
    const {tree} = await render({queueing: true, queueingReason: 'out of range'});
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('hello');
    });
    const icons = tree.root.findAllByType(Icon).map(n => String(n.props.name));
    // A filled send arrow would promise something that is not happening this second.
    expect(icons).toContain('clock');
    expect(icons).not.toContain('arrowUp');
  });

  it('shows a send arrow when the link is live', async () => {
    const {tree} = await render({queueing: false});
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('hello');
    });
    const icons = tree.root.findAllByType(Icon).map(n => String(n.props.name));
    expect(icons).toContain('arrowUp');
    expect(icons).not.toContain('clock');
  });

  it('refuses when there is nothing to address', async () => {
    const sent: string[] = [];
    const {tree, text} = await render({
      enabled: false,
      disabledReason: 'Say hi on Nearby first',
      onSend: t => sent.push(t),
    });

    expect(tree.root.findByType(TextInput).props.editable).toBe(false);
    expect(text).toContain('Say hi on Nearby first');

    // Even if the submit fires, nothing may leave: there is no peer to queue against,
    // so accepting it would lose the message rather than delay it.
    await typeAndSend(tree, 'hello?');
    expect(sent).toEqual([]);
  });

  it('never sends whitespace', async () => {
    const sent: string[] = [];
    const {tree} = await render({onSend: t => sent.push(t)});
    await typeAndSend(tree, '   ');
    expect(sent).toEqual([]);
  });

  it('clears the field after sending, so a message cannot be sent twice by accident', async () => {
    const sent: string[] = [];
    const {tree} = await render({onSend: t => sent.push(t)});
    await typeAndSend(tree, 'once');
    expect(tree.root.findByType(TextInput).props.value).toBe('');

    await act(async () => {
      tree.root.findByType(TextInput).props.onSubmitEditing();
    });
    expect(sent).toEqual(['once']);
  });
});
