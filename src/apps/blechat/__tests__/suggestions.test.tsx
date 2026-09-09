/**
 * One-tap replies.
 *
 * The rules are simple on purpose — there is no model here and nothing to ask — so what
 * has to be right is WHEN they appear. A row of chips that is always there stops being a
 * suggestion and becomes chrome, and one that offers a reply to your own message is
 * plainly wrong. Those are the cases below.
 */
import React from 'react';
import {Text, TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

import {SafeAreaProvider} from 'react-native-safe-area-context';

import {MessageInput} from '../components/MessageInput';
import {OPENERS, suggestionsFor} from '../config/suggestions';
import {ThemeProvider} from '../theme/ThemeProvider';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

describe('what to suggest', () => {
  it('opens a conversation that has not started', () => {
    expect(suggestionsFor({threadEmpty: true, lastIncoming: null})).toEqual(OPENERS);
  });

  it('says nothing when our own message was last', () => {
    // Suggesting a reply to yourself is noise, and worse, it invites a double message.
    expect(suggestionsFor({threadEmpty: false, lastIncoming: null})).toEqual([]);
  });

  it('answers a question rather than acknowledging it', () => {
    const replies = suggestionsFor({
      threadEmpty: false,
      lastIncoming: 'are you coming?',
    });
    expect(replies).toContain('Yes');
    expect(replies).not.toContain('Okay!');
  });

  it('greets back, thanks back, and helps with "where"', () => {
    const greet = suggestionsFor({threadEmpty: false, lastIncoming: 'hey'});
    expect(greet.join(' ')).toMatch(/hi|hey/i);

    const thanks = suggestionsFor({threadEmpty: false, lastIncoming: 'thanks!'});
    expect(thanks).toContain('Anytime');

    const where = suggestionsFor({threadEmpty: false, lastIncoming: 'where are you'});
    expect(where).toContain('On my way');
  });

  it('falls back to plain acknowledgements', () => {
    expect(suggestionsFor({threadEmpty: false, lastIncoming: 'the room is upstairs'}))
      .toEqual(['Okay!', 'Noted!', '👍']);
  });

  it('is not thrown by an empty or odd message', () => {
    expect(suggestionsFor({threadEmpty: false, lastIncoming: '   '}).length).toBeGreaterThan(0);
    expect(suggestionsFor({threadEmpty: false, lastIncoming: '🙂'}).length).toBeGreaterThan(0);
  });
});

describe('the chips in the composer', () => {
  async function render(props: Partial<React.ComponentProps<typeof MessageInput>>) {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ThemeProvider mode="light">
          <MessageInput enabled onSend={() => undefined} {...props} />
        </ThemeProvider>,
      );
    });
    const shown = tree.root
      .findAllByType(Text)
      .map(n => (typeof n.props.children === 'string' ? n.props.children : ''))
      .join(' | ');
    return {tree, shown};
  }

  it('sends the phrase as written, in one tap', async () => {
    const sent: string[] = [];
    const {tree} = await render({suggestions: ['Okay!'], onSend: t => sent.push(t)});

    const chip = tree.root.find(
      n => n.props.accessibilityLabel === 'Send "Okay!"' && !!n.props.onPress,
    );
    act(() => chip.props.onPress());
    expect(sent).toEqual(['Okay!']);
  });

  it('gets out of the way once there is something typed', async () => {
    const {tree, shown} = await render({suggestions: ['Okay!', 'Noted!']});
    expect(shown).toContain('Okay!');

    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('I will be there');
    });
    const after = tree.root
      .findAllByType(Text)
      .map(n => (typeof n.props.children === 'string' ? n.props.children : ''))
      .join(' | ');
    expect(after).not.toContain('Okay!');
  });

  it('offers nothing when there is nobody to send to', async () => {
    const {shown} = await render({enabled: false, suggestions: ['Okay!']});
    expect(shown).not.toContain('Okay!');
  });
});

/**
 * Editing, and the line it must not cross.
 *
 * There is no edit packet in the protocol. Changing a message the other phone already
 * has would leave two people reading different words with no way to tell — so the option
 * exists only while the message is still ours, and the test that matters is the one
 * asserting it is absent the rest of the time.
 */
describe('editing a message', () => {
  const base = {
    id: 'm1',
    conversationId: 'p',
    originId: 'p',
    senderId: 'me',
    destinationId: 'p',
    text: 'hello',
    timestamp: Date.now(),
    receivedAt: Date.now(),
    direction: 'outgoing' as const,
    protocolVersion: 1,
    ttl: 1,
    hopCount: 0,
    retryCount: 0,
  };

  async function labels(status: string) {
    const {MessageActionsSheet} = require('../components/MessageActionsSheet');
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">
          <MessageActionsSheet
            message={{...base, status}}
            onClose={() => undefined}
            onCopy={() => undefined}
            onRetry={() => undefined}
            onDelete={() => undefined}
            onEdit={() => undefined}
          />
        </ThemeProvider>
        </SafeAreaProvider>,
      );
    });
    return tree.root
      .findAllByType(Text)
      .map(n => (typeof n.props.children === 'string' ? n.props.children : ''))
      .join(' | ');
  }

  it('is offered while the message is still on this phone', async () => {
    expect(await labels('pending')).toContain('Edit');
    expect(await labels('failed')).toContain('Edit');
  });

  it('is never offered once the other phone has it', async () => {
    expect(await labels('sent')).not.toContain('Edit');
    expect(await labels('received')).not.toContain('Edit');
  });

  it('shows what happened to the message, with times', async () => {
    const shown = await labels('received');
    expect(shown).toContain('Written');
    expect(shown).toContain('Left this phone');
    expect(shown).toContain('Their phone confirmed it');
  });
});
