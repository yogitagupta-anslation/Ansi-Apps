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
      ['pending', 'Queued'],
      ['sending', 'Sending'],
      ['sent', 'Sent'],
      ['received', 'Delivered'],
      ['failed', 'Failed'],
    ];

    it.each(cases)('reports %s as "%s"', async (status, label) => {
      const rendered = await renderBubble(message({direction: 'outgoing', status}));
      expect(rendered).toContain(label);
    });

    it('shows one tick for a completed write and two only for an ACK', async () => {
      const sent = await renderBubble(message({direction: 'outgoing', status: 'sent'}));
      expect(sent).toContain('✓');
      expect(sent).not.toContain('✓✓');

      const acked = await renderBubble(
        message({direction: 'outgoing', status: 'received'}),
      );
      expect(acked).toContain('✓✓');
    });

    it('never shows a tick on a message that has not left yet', async () => {
      const queued = await renderBubble(
        message({direction: 'outgoing', status: 'pending'}),
      );
      expect(queued).not.toContain('✓');
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
