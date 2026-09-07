/**
 * What a message bubble actually says about delivery.
 *
 * The protocol suites prove the bytes move; this proves the screen tells the truth about
 * them. That is a separate risk: the delivery state machine can be perfect while the
 * bubble reports "Delivered" for a write that was merely handed to the radio, and a chat
 * app that overstates delivery is worse than one that understates it.
 *
 * The distinction under test throughout: one tick means the BLE write completed, two
 * means the peer returned an application-level ACK, and nothing but a real transport
 * event moves between them.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {MessageBubble} from '../components/MessageBubble';
import {Icon} from '../components/ui/Icon';
import {ThemeProvider} from '../theme/ThemeProvider';
import type {ChatMessage, MessageStatus} from '../types/Message';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'peer-1',
    originId: 'peer-1',
    senderId: 'peer-1',
    destinationId: 'me',
    text: 'Hello',
    timestamp: 1_700_000_000_000,
    receivedAt: 1_700_000_000_000,
    direction: 'incoming',
    status: 'received',
    protocolVersion: 1,
    ttl: 1,
    hopCount: 0,
    ...overrides,
  } as ChatMessage;
}

/** The delivery icons a bubble renders, by name. */
async function receiptIcons(msg: ChatMessage): Promise<string[]> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ThemeProvider mode="dark">
        <MessageBubble message={msg} onRetry={() => undefined} />
      </ThemeProvider>,
    );
  });
  return tree.root.findAllByType(Icon).map(node => String(node.props.name));
}

/** Every string the bubble renders, flattened, so assertions read as "does it say X". */
async function renderBubble(msg: ChatMessage): Promise<string> {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <MessageBubble message={msg} onRetry={() => {}} />
      </ThemeProvider>,
    );
  });
  return renderer!.root
    .findAllByType(Text)
    .map(node =>
      (Array.isArray(node.props.children)
        ? node.props.children
        : [node.props.children]
      )
        .filter((c: unknown) => typeof c === 'string' || typeof c === 'number')
        .join(''),
    )
    .join(' | ');
}

describe('message bubble', () => {
  it('shows the text of a received message', async () => {
    const rendered = await renderBubble(message({text: 'Signal drops in the lab'}));
    expect(rendered).toContain('Signal drops in the lab');
  });

  it('shows the sender name only in a group', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <MessageBubble message={message()} onRetry={() => {}} senderName="Neha" />
        </ThemeProvider>,
      );
    });
    const text = renderer!.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .flat()
      .join(' ');
    expect(text).toContain('Neha');

    // Without the prop — a one-to-one chat — nothing attributes the message, because
    // the header already names the only person who could have sent it.
    expect(await renderBubble(message())).not.toContain('Neha');
  });

  describe('outgoing delivery states', () => {
    const cases: Array<[MessageStatus, string]> = [
      ['pending', 'Waiting to send'],
      ['sending', 'Sending'],
      ['sent', 'Sent'],
      ['received', 'Delivered'],
      ['failed', 'Failed'],
    ];

    it.each(cases)('reports %s as "%s"', async (status, label) => {
      const rendered = await renderBubble(message({direction: 'outgoing', status}));
      expect(rendered).toContain(label);
    });

    /**
     * The same invariant, now that the mark is an icon rather than a glyph in the text.
     *
     * Asserting on the icon NAME rather than on a character keeps the test tied to the
     * distinction it exists to protect — one tick is a completed write, two is an ACK —
     * instead of to how that distinction happens to be drawn.
     */
    it('shows one tick for a completed write and two only for an ACK', async () => {
      expect(await receiptIcons(message({direction: 'outgoing', status: 'sent'}))).toEqual(
        ['check'],
      );
      expect(
        await receiptIcons(message({direction: 'outgoing', status: 'received'})),
      ).toEqual(['checkDouble']);
    });

    it('never shows a tick on a message that has not left yet', async () => {
      const icons = await receiptIcons(message({direction: 'outgoing', status: 'pending'}));
      expect(icons).not.toContain('check');
      expect(icons).not.toContain('checkDouble');
    });

    it('offers a retry on a failed message', async () => {
      const failed = await renderBubble(
        message({direction: 'outgoing', status: 'failed'}),
      );
      expect(failed).toContain('tap to retry');
    });
  });

  it('reports fragment progress from real frame counts while sending', async () => {
    const rendered = await renderBubble(
      message({
        direction: 'outgoing',
        status: 'sending',
        fragmentProgress: {sent: 3, total: 7},
      } as Partial<ChatMessage>),
    );
    expect(rendered).toContain('Sending 3/7');
  });

  it('counts acknowledgements per member in a group, not a single tick', async () => {
    const rendered = await renderBubble(
      message({
        direction: 'outgoing',
        status: 'sent',
        groupId: 'g:1',
        deliveredTo: ['a'],
        recipientCount: 3,
      } as Partial<ChatMessage>),
    );
    // A lone tick would claim the whole group has it; the fraction is the honest form.
    expect(rendered).toContain('1/3');
  });
});
