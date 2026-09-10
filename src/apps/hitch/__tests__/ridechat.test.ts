/**
 * Chat between the two people on a ride.
 *
 * What matters here is not that messages appear — it is what happens when the link does
 * not cooperate, because a Bluetooth chat between two people fifty metres apart spends a
 * meaningful share of its life disconnected. So most of this is about the outbox, the
 * delivery states, and the difference between "it left this phone" and "they have it".
 *
 * The outbox and the message model are imported from BLE Chat rather than rewritten, which
 * these tests also serve to prove: if that import ever breaks, this fails.
 */
import {RideChat} from '../services/rideChat';
import {decodeMessage} from '../ble/protocol';
import type {ChatMessage} from '../../blechat/types/Message';

function chatWithLink() {
  const sent: string[] = [];
  const chat = new RideChat('peer-a');
  let seen: ChatMessage[] = [];
  chat.subscribe(messages => {
    seen = messages;
  });
  const connect = (ok = true) =>
    chat.setLink(async frame => {
      sent.push(frame);
      return ok;
    });
  return {chat, sent, connect, latest: () => seen};
}

describe('sending while connected', () => {
  it('shows the message immediately, then marks it sent', async () => {
    const {chat, sent, connect, latest} = chatWithLink();
    connect();
    await chat.post('Where are you?');

    expect(latest()).toHaveLength(1);
    expect(latest()[0].text).toBe('Where are you?');
    // "sent" means the write completed on this phone. Nothing yet says they have it.
    expect(latest()[0].status).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('puts a real chat frame on the wire', async () => {
    const {chat, sent, connect} = chatWithLink();
    connect();
    await chat.post('Near the gate');
    const decoded = decodeMessage(sent[0]);
    expect(decoded).toMatchObject({t: 'CHAT', text: 'Near the gate'});
  });

  it('marks it failed when the write is refused', async () => {
    const {chat, connect, latest} = chatWithLink();
    connect(false);
    await chat.post('hello');
    expect(latest()[0].status).toBe('failed');
  });

  it('ignores an empty message rather than sending a blank bubble', async () => {
    const {chat, sent, connect, latest} = chatWithLink();
    connect();
    await chat.post('   ');
    expect(latest()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe('the outbox', () => {
  it('holds what you type while the link is down', async () => {
    const {chat, sent, latest} = chatWithLink();
    // No link attached at all — the state somebody is in while the rider is round a corner.
    await chat.post("I'm at the main gate");
    expect(latest()[0].status).toBe('pending');
    expect(chat.queuedCount).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('sends it by itself when the link comes back', async () => {
    const {chat, sent, connect, latest} = chatWithLink();
    await chat.post('waiting outside');
    expect(sent).toHaveLength(0);

    connect();
    // setLink flushes; give the promise chain a turn to settle.
    await new Promise(r => setTimeout(r, 0));

    expect(sent).toHaveLength(1);
    expect(latest()[0].status).toBe('sent');
    expect(chat.queuedCount).toBe(0);
  });

  it('keeps them in the order they were written', async () => {
    const {chat, sent, connect} = chatWithLink();
    await chat.post('first');
    await chat.post('second');
    connect();
    await new Promise(r => setTimeout(r, 0));

    const texts = sent.map(f => (decodeMessage(f) as {text: string}).text);
    expect(texts).toEqual(['first', 'second']);
  });

  it('puts an in-flight message back in the queue when the link drops', async () => {
    const {chat, latest} = chatWithLink();
    // A send that never resolves, which is what a link dying mid-write looks like.
    chat.setLink(() => new Promise<boolean>(() => undefined));
    void chat.post('mid-sentence');
    await new Promise(r => setTimeout(r, 0));
    expect(latest()[0].status).toBe('sending');

    chat.setLink(null);
    expect(latest()[0].status).toBe('pending');
  });
});

describe('receiving', () => {
  it('adds their message and answers with an acknowledgement', () => {
    const {chat, latest} = chatWithLink();
    const incoming = Buffer.from(
      JSON.stringify({t: 'CHAT', v: 1, id: 'm1', text: 'Near the gate', at: Date.now()}),
    ).toString('base64');

    const reply = chat.receive(incoming);

    expect(latest()).toHaveLength(1);
    expect(latest()[0].direction).toBe('incoming');
    expect(decodeMessage(reply!)).toMatchObject({t: 'ACK', id: 'm1'});
  });

  it('turns sent into delivered when their acknowledgement arrives', async () => {
    const {chat, sent, connect, latest} = chatWithLink();
    connect();
    await chat.post('on my way');
    expect(latest()[0].status).toBe('sent');

    const id = (decodeMessage(sent[0]) as {id: string}).id;
    chat.receive(Buffer.from(JSON.stringify({t: 'ACK', v: 1, id})).toString('base64'));

    // The distinction the whole receipt exists for.
    expect(latest()[0].status).toBe('received');
  });

  it('does not double up on a retransmission', () => {
    const {chat, latest} = chatWithLink();
    const frame = Buffer.from(
      JSON.stringify({t: 'CHAT', v: 1, id: 'same', text: 'hello', at: 1}),
    ).toString('base64');

    chat.receive(frame);
    const reply = chat.receive(frame);

    expect(latest()).toHaveLength(1);
    // Still acknowledged — the repeat means our first ACK did not arrive.
    expect(decodeMessage(reply!)).toMatchObject({t: 'ACK'});
  });

  it('ignores rubbish off the link without throwing', () => {
    const {chat, latest} = chatWithLink();
    for (const junk of ['', 'not base64!!', Buffer.from('{}').toString('base64')]) {
      expect(() => chat.receive(junk)).not.toThrow();
    }
    expect(latest()).toHaveLength(0);
  });
});

describe(`the conversation's lifetime`, () => {
  it('is thrown away with the ride', async () => {
    const {chat, connect, latest} = chatWithLink();
    connect();
    await chat.post('see you');
    expect(latest()).toHaveLength(1);

    chat.dispose();
    // Nothing persists across rides: the conversation was about reaching one kerb.
    expect(chat.getMessages()).toHaveLength(0);
    expect(chat.isConnected).toBe(false);
  });
});
