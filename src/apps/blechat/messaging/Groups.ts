import {uuidv4} from '../utils/id';

/**
 * A named set of peers that receive the same message.
 *
 * Delivery is a fan-out over the DIRECT links we hold: one copy per member, each
 * individually addressed and individually acknowledged. There is no relaying yet, so a
 * member you cannot reach does not receive via anybody else — the message waits in the
 * outbox until you can reach them yourself.
 *
 * That has a consequence worth being explicit about: for everyone in a group to see
 * everyone else's messages, every member must be connected to every other member. With
 * relaying (Phase 2) that requirement disappears, and nothing here has to change —
 * `sendToGroup` already addresses each member by peerId, which is exactly what a relayed
 * packet carries.
 */
export interface Group {
  id: string;
  name: string;
  /** peerIds of every member, INCLUDING ourselves. */
  members: string[];
  createdAt: number;
  /** peerId of whoever created it. */
  createdBy: string;
}

/** Group ids are prefixed so a conversation id is unambiguous at a glance. */
export const GROUP_PREFIX = 'g:';

export function isGroupId(conversationId: string): boolean {
  return conversationId.startsWith(GROUP_PREFIX);
}

export function createGroup(
  name: string,
  members: string[],
  createdBy: string,
): Group {
  const unique = Array.from(new Set([...members, createdBy]));
  return {
    id: GROUP_PREFIX + uuidv4(),
    name: name.trim() || 'Group',
    members: unique,
    createdAt: Date.now(),
    createdBy,
  };
}

/** Tolerates a malformed or partial group from the wire. */
export function parseGroup(raw: unknown): Group | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const g = raw as Partial<Group>;
  if (typeof g.id !== 'string' || !isGroupId(g.id)) {
    return null;
  }
  if (!Array.isArray(g.members) || g.members.some(m => typeof m !== 'string')) {
    return null;
  }
  return {
    id: g.id,
    name: typeof g.name === 'string' && g.name ? g.name : 'Group',
    members: Array.from(new Set(g.members as string[])),
    createdAt: typeof g.createdAt === 'number' ? g.createdAt : Date.now(),
    createdBy: typeof g.createdBy === 'string' ? g.createdBy : '',
  };
}

export class GroupStore {
  private groups = new Map<string, Group>();

  upsert(group: Group): void {
    const existing = this.groups.get(group.id);
    if (!existing) {
      this.groups.set(group.id, group);
      return;
    }
    // Membership is a union: an invite that reaches us late must not remove members we
    // already know about, and no member list is authoritative without a server.
    this.groups.set(group.id, {
      ...existing,
      name: group.name || existing.name,
      members: Array.from(new Set([...existing.members, ...group.members])),
    });
  }

  get(id: string): Group | null {
    return this.groups.get(id) ?? null;
  }

  all(): Group[] {
    return Array.from(this.groups.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  /** Members other than us — the actual recipients of a fan-out. */
  recipients(id: string, selfId: string): string[] {
    const group = this.groups.get(id);
    if (!group) {
      return [];
    }
    return group.members.filter(m => m !== selfId);
  }

  remove(id: string): void {
    this.groups.delete(id);
  }

  hydrate(groups: Group[]): void {
    this.groups.clear();
    for (const g of groups) {
      this.groups.set(g.id, g);
    }
  }

  snapshot(): Group[] {
    return this.all();
  }

  get size(): number {
    return this.groups.size;
  }
}
