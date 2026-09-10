/**
 * Send Later.
 *
 * The promise a scheduled message makes here is narrower than the one a server-backed
 * messenger makes, and the tests are written around exactly that line: it will not go out
 * BEFORE the chosen time, and when the time comes it takes the ordinary path — delivered
 * if the peer is in range, held in the outbox if not.
 *
 * The two failures worth guarding against are opposites. One is a held message quietly
 * going out early, which is the feature failing at the only thing it does. The other is a
 * held message never going out at all — the timer lost across a restart, or a moment that
 * passed while the app was closed and was then waited for again forever.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';

describe('holding a message for later', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  async function connect(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.identity.peerId), 'A to connect to B');
  }

  it('does not put a held message on the radio', async () => {
    await connect();
    const them = phoneB.identity.peerId;

    const held = phoneA.messages.schedule(them, 'happy birthday', Date.now() + 60_000);
    expect(held.status).toBe('scheduled');
    expect(held.scheduledFor).toBeGreaterThan(Date.now());

    // It is in our thread immediately — you can see it, edit it, cancel it.
    expect(phoneA.messages.getMessages(them).map(m => m.text)).toContain('happy birthday');

    // Give the loopback air every chance to carry it. Nothing should arrive: the message
    // exists, and no send was attempted.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(phoneB.messages.getMessages(phoneA.identity.peerId)).toHaveLength(0);
  });

  it('sends it for real once the time comes', async () => {
    await connect();
    const them = phoneB.identity.peerId;

    // Due almost immediately: the timer is real, so the test waits on it rather than
    // reaching in and firing it by hand.
    phoneA.messages.schedule(them, 'good morning', Date.now() + 20);

    await waitFor(
      () => phoneB.messages.getMessages(phoneA.identity.peerId).length > 0,
      'B to receive the held message once it is due',
    );
    const arrived = phoneB.messages.getMessages(phoneA.identity.peerId);
    expect(arrived[0].text).toBe('good morning');

    // And on our side it is now an ordinary sent message, not a held one.
    const ours = phoneA.messages.getMessages(them);
    expect(ours.some(m => m.status === 'scheduled')).toBe(false);
    expect(ours.some(m => m.text === 'good morning')).toBe(true);
  });

  it('lets it go early when asked, without waiting for the clock', async () => {
    await connect();
    const them = phoneB.identity.peerId;

    const held = phoneA.messages.schedule(them, 'on second thoughts', Date.now() + 600_000);
    await phoneA.messages.releaseScheduled(them, held.id);

    await waitFor(
      () => phoneB.messages.getMessages(phoneA.identity.peerId).length > 0,
      'B to receive the released message',
    );
    expect(phoneA.messages.scheduledMessages()).toHaveLength(0);
  });

  it('moves to a new time without sending anything', async () => {
    await connect();
    const them = phoneB.identity.peerId;

    const held = phoneA.messages.schedule(them, 'later', Date.now() + 60_000);
    const moved = Date.now() + 120_000;
    phoneA.messages.reschedule(them, held.id, moved);

    const [only] = phoneA.messages.scheduledMessages();
    expect(only.message.scheduledFor).toBe(moved);
    expect(phoneB.messages.getMessages(phoneA.identity.peerId)).toHaveLength(0);
  });

  it('cancels by deleting, and stops waiting on it', async () => {
    await connect();
    const them = phoneB.identity.peerId;

    const held = phoneA.messages.schedule(them, 'never mind', Date.now() + 30);
    phoneA.messages.deleteLocal(them, held.id);

    expect(phoneA.messages.scheduledMessages()).toHaveLength(0);
    // Past the moment it would have gone out, nothing did.
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(phoneB.messages.getMessages(phoneA.identity.peerId)).toHaveLength(0);
  });

  it('holds it while the peer is out of range, then queues rather than losing it', async () => {
    // Never connected: due time arrives with nobody to send to. The message must end up
    // in the outbox as pending, which is what every other undeliverable message does —
    // being scheduled earns it no special failure.
    const them = phoneB.identity.peerId;
    phoneA.messages.schedule(them, 'when you are back', Date.now() + 20);

    await waitFor(
      () => phoneA.messages.getMessages(them).some(m => m.status === 'pending'),
      'the released message to land in the outbox',
    );
    expect(phoneA.messages.scheduledMessages()).toHaveLength(0);
  });

  it('sorts what is waiting by when it is due', async () => {
    const them = phoneB.identity.peerId;
    const late = phoneA.messages.schedule(them, 'later', Date.now() + 600_000);
    const soon = phoneA.messages.schedule(them, 'sooner', Date.now() + 300_000);

    expect(phoneA.messages.scheduledMessages().map(s => s.message.id)).toEqual([
      soon.id,
      late.id,
    ]);
  });

  it('refuses a message with nothing in it', () => {
    expect(() =>
      phoneA.messages.schedule(phoneB.identity.peerId, '   ', Date.now() + 1000),
    ).toThrow();
  });
});
