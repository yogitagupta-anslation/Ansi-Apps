/**
 * Group messaging over direct links.
 *
 * A group message is one ChatMessage fanned out to N individually-addressed packets, so
 * delivery is per recipient. These tests pin the behaviour that matters: everyone gets
 * exactly one copy, an unreachable member is queued rather than lost, and the message is
 * only "delivered" once every member has acknowledged.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';
import {
  createGroup,
  GroupStore,
  isGroupId,
  parseGroup,
} from '../messaging/Groups';

describe('GroupStore', () => {
  it('creates a prefixed id and always includes the creator', () => {
    const g = createGroup('Team', ['b', 'c'], 'me');
    expect(isGroupId(g.id)).toBe(true);
    expect(g.members.sort()).toEqual(['b', 'c', 'me']);
    expect(g.createdBy).toBe('me');
  });

  it('does not duplicate the creator if already listed', () => {
    const g = createGroup('Team', ['me', 'b'], 'me');
    expect(g.members.filter(m => m === 'me')).toHaveLength(1);
  });

  it('merges membership rather than replacing it', () => {
    const store = new GroupStore();
    const g = createGroup('Team', ['b'], 'me');
    store.upsert(g);
    // A late invite that knows about C must not erase B.
    store.upsert({...g, members: ['me', 'c']});

    expect(store.get(g.id)!.members.sort()).toEqual(['b', 'c', 'me']);
  });

  it('lists recipients excluding ourselves', () => {
    const store = new GroupStore();
    const g = createGroup('Team', ['b', 'c'], 'me');
    store.upsert(g);
    expect(store.recipients(g.id, 'me').sort()).toEqual(['b', 'c']);
  });

  it('rejects a malformed group from the wire', () => {
    expect(parseGroup(null)).toBeNull();
    expect(parseGroup({id: 'not-prefixed', members: []})).toBeNull();
    expect(parseGroup({id: 'g:1', members: 'nope'})).toBeNull();
    expect(parseGroup({id: 'g:1', members: ['a']})?.name).toBe('Group');
  });
});

describe('group messaging', () => {
  let air: VirtualAir;
  let a: VirtualPhone;
  let b: VirtualPhone;
  let c: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    a = new VirtualPhone('deviceA', 'Phone A', air);
    b = new VirtualPhone('deviceB', 'Phone B', air);
    c = new VirtualPhone('deviceC', 'Phone C', air);
  });

  afterEach(() => {
    [a, b, c].forEach(p => p.dispose());
  });

  async function connectAll(): Promise<void> {
    b.startAdvertising();
    c.startAdvertising();
    await a.scan();
    for (const [peer, id] of [
      [b, 'deviceB'],
      [c, 'deviceC'],
    ] as const) {
      await a.peerManager.connect(toCentralLinkId(id));
      await waitFor(() => a.isConnectedTo(peer.peerId), 'A to connect');
    }
  }

  it('shares the group definition with every reachable member', async () => {
    await connectAll();
    const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);

    await waitFor(
      () => b.messages.groups.get(group.id) !== null &&
            c.messages.groups.get(group.id) !== null,
      'B and C to receive the invite',
    );

    expect(b.messages.groups.get(group.id)!.name).toBe('Team');
    expect(c.messages.groups.get(group.id)!.members.sort()).toEqual(
      [a.peerId, b.peerId, c.peerId].sort(),
    );
  });

  it('delivers one copy to each member, filed under the group', async () => {
    await connectAll();
    const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
    await waitFor(() => b.messages.groups.get(group.id) !== null, 'invite');

    await a.messages.sendToGroup(group.id, 'hello everyone');

    await waitFor(
      () =>
        b.messages.getMessages(group.id).length === 1 &&
        c.messages.getMessages(group.id).length === 1,
      'both members to receive it',
    );

    // Filed under the GROUP, not under a one-to-one conversation with A.
    expect(b.messages.getMessages(group.id)[0].text).toBe('hello everyone');
    expect(b.messages.getMessages(a.peerId)).toHaveLength(0);
    expect(c.messages.getMessages(group.id)[0].groupId).toBe(group.id);
  });

  it('reports 2/2 delivered only once every member has acknowledged', async () => {
    await connectAll();
    const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
    await waitFor(() => c.messages.groups.get(group.id) !== null, 'invite');

    const sent = await a.messages.sendToGroup(group.id, 'roll call');
    expect(sent.recipientCount).toBe(2);

    await waitFor(() => {
      const m = a.messages.getMessages(group.id)[0];
      return (m.deliveredTo?.length ?? 0) === 2;
    }, 'both ACKs to come back');

    const message = a.messages.getMessages(group.id)[0];
    expect(message.deliveredTo!.sort()).toEqual([b.peerId, c.peerId].sort());
    // Only now is the whole group message delivered.
    expect(message.status).toBe('received');
  });

  it('queues for an unreachable member and stays short of full delivery', async () => {
    await connectAll();
    const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
    await waitFor(() => c.messages.groups.get(group.id) !== null, 'invite');

    // C leaves before the message is sent.
    await c.transport.disconnect(c.transport.linkIds[0]);
    await waitFor(() => !a.isConnectedTo(c.peerId), 'C to drop');

    await a.messages.sendToGroup(group.id, 'while C is away');

    await waitFor(
      () => b.messages.getMessages(group.id).length === 1,
      'B to receive it',
    );

    // B has it; C does not, and its copy is queued rather than lost.
    expect(c.messages.getMessages(group.id)).toHaveLength(0);
    expect(a.messages.queue.countFor(c.peerId)).toBe(1);

    // B's ACK is a real round trip, so wait for it rather than assuming same-tick.
    await waitFor(
      () => (a.messages.getMessages(group.id)[0].deliveredTo?.length ?? 0) === 1,
      'B to acknowledge',
    );

    const message = a.messages.getMessages(group.id)[0];
    expect(message.deliveredTo).toEqual([b.peerId]);
    expect(message.recipientCount).toBe(2);
    // Not "delivered" — one member still has not received it.
    expect(message.status).not.toBe('received');
  });

  it('delivers the queued copy into the GROUP when the member returns', async () => {
    await connectAll();
    const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
    await waitFor(() => c.messages.groups.get(group.id) !== null, 'invite');

    await c.transport.disconnect(c.transport.linkIds[0]);
    await waitFor(() => !a.isConnectedTo(c.peerId), 'C to drop');
    await a.messages.sendToGroup(group.id, 'catch up');

    await a.peerManager.connect(toCentralLinkId('deviceC'));
    await waitFor(() => a.isConnectedTo(c.peerId), 'C to return');
    await a.messages.flushQueue(c.peerId);

    await waitFor(
      () => c.messages.getMessages(group.id).length === 1,
      'C to receive the queued group message',
    );

    // The group id survived the queue: it must not land in a 1:1 chat with A.
    expect(c.messages.getMessages(group.id)[0].text).toBe('catch up');
    expect(c.messages.getMessages(a.peerId)).toHaveLength(0);

    await waitFor(() => {
      const m = a.messages.getMessages(group.id)[0];
      return (m.deliveredTo?.length ?? 0) === 2;
    }, 'delivery to complete after the flush');
  });

  it('accepts a message for a group it was never invited to', async () => {
    await connectAll();
    const group = await a.messages.createGroup('Ad hoc', [b.peerId]);
    // Wipe B's copy to simulate a lost invite.
    b.messages.groups.remove(group.id);
    expect(b.messages.groups.get(group.id)).toBeNull();

    await a.messages.sendToGroup(group.id, 'you missed the invite');

    await waitFor(
      () => b.messages.getMessages(group.id).length === 1,
      'B to receive it anyway',
    );
    // A minimal group is recorded so the conversation is not silently dropped.
    expect(b.messages.groups.get(group.id)).not.toBeNull();
  });

  it('does not claim delivery for a group with no other members', async () => {
    const group = await a.messages.createGroup('Just me', []);
    const message = await a.messages.sendToGroup(group.id, 'alone');
    expect(message.recipientCount).toBe(0);
    expect(a.messages.queue.total).toBe(0);
  });

  describe('leaving a group', () => {
    it('removes it and clears its history', async () => {
      await connectAll();
      const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
      await waitFor(
        () => b.messages.groups.get(group.id) !== null,
        'B to receive the invite',
      );

      await b.messages.leaveGroup(group.id);

      expect(b.messages.groups.get(group.id)).toBeNull();
      expect(b.messages.hasLeft(group.id)).toBe(true);
      expect(b.conversationWith(group.id)).toHaveLength(0);
    });

    /**
     * The reason leaving needs its own record rather than just forgetting the group: an
     * inbound message for an unknown group re-creates it, so without this the next
     * message anybody sent would silently put us back in.
     */
    it('stays left when another member keeps sending to it', async () => {
      await connectAll();
      const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
      await waitFor(
        () => b.messages.groups.get(group.id) !== null,
        'B to receive the invite',
      );

      await b.messages.leaveGroup(group.id);
      await a.messages.sendToGroup(group.id, 'still talking');
      await waitFor(
        () => c.conversationWith(group.id).length === 1,
        'C to receive it, proving the message really went out',
      );

      expect(b.messages.groups.get(group.id)).toBeNull();
      expect(b.conversationWith(group.id)).toHaveLength(0);
    });

    /**
     * Every member re-shares its groups whenever a peer reconnects, so an invite is not
     * evidence of a deliberate re-add. Treating it as one would drag us back into the
     * group the moment we came back into range.
     */
    it('ignores a re-shared invite for a group it has left', async () => {
      await connectAll();
      const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
      await waitFor(
        () => b.messages.groups.get(group.id) !== null,
        'B to receive the invite',
      );

      await b.messages.leaveGroup(group.id);
      await a.messages.inviteMembers(group);
      await waitFor(
        () => c.messages.groups.get(group.id) !== null,
        'the re-share to have gone out',
      );

      expect(b.messages.groups.get(group.id)).toBeNull();
    });

    it('drops messages still queued for that group', async () => {
      await connectAll();
      const group = await a.messages.createGroup('Team', [b.peerId, c.peerId]);
      await waitFor(
        () => b.messages.groups.get(group.id) !== null,
        'invite delivered',
      );

      // C goes away, so A's copy for C is queued rather than sent.
      await a.peerManager.disconnect(a.peerManager.getPeer(c.peerId)!.linkId!);
      await waitFor(() => !a.isConnectedTo(c.peerId), 'C to be unreachable');
      await a.messages.sendToGroup(group.id, 'for later');
      expect(a.messages.queue.total).toBeGreaterThan(0);

      await a.messages.leaveGroup(group.id);

      // Delivering these later would be sending into a conversation we walked out of.
      expect(a.messages.queue.total).toBe(0);
    });

    it('leaves other groups untouched', async () => {
      await connectAll();
      const one = await a.messages.createGroup('One', [b.peerId]);
      const two = await a.messages.createGroup('Two', [b.peerId]);
      await waitFor(
        () => b.messages.groups.get(one.id) !== null &&
              b.messages.groups.get(two.id) !== null,
        'B to receive both invites',
      );

      await b.messages.leaveGroup(one.id);

      expect(b.messages.groups.get(one.id)).toBeNull();
      expect(b.messages.groups.get(two.id)).not.toBeNull();
      expect(b.messages.hasLeft(two.id)).toBe(false);
    });

    it('restores the left list from storage', () => {
      // Without this the flag dies with the process and the group returns on next launch.
      const fresh = b.messages;
      fresh.hydrateLeftGroups(['g:one', 'g:two']);
      expect(fresh.hasLeft('g:one')).toBe(true);
      expect(fresh.leftGroupIds().sort()).toEqual(['g:one', 'g:two']);
    });
  });
});
