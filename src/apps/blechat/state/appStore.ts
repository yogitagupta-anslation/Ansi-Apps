import {useMemo} from 'react';
import {create} from 'zustand';
import {bleChat, type PeripheralStatus} from '../services/BleChatService';
import type {SchedulerSnapshot} from '../peers/ConnectionScheduler';
import {LINK_BUDGET_DEFAULT} from '../config/constants';
import type {PermissionResult} from '../ble/BLEPermissions';
import type {RouterCounters} from '../messaging/MessageRouter';
import {storage, DEFAULT_SETTINGS, type AppSettings} from '../storage/LocalStorage';
import type {BluetoothState} from '../types/BLE';
import type {ChatMessage} from '../types/Message';
import type {Peer, PeerIdentity} from '../types/Peer';
import type {Group} from '../messaging/Groups';
import type {SecurityEvent} from '../security/SecurityLog';
import type {IdentityAssessment} from '../security/IdentityWatch';
import type {Packet} from '../types/Packet';
import {logger, type LogEntry} from '../utils/logger';
import {stripPrefix} from '../utils/linkId';
import type {SessionMetrics} from '../peers/LinkMetrics';

type SessionSnapshot = ReturnType<SessionMetrics['snapshot']>;

/**
 * A BLE device seen while scanning — chat peer or not.
 *
 * Kept separate from `Peer`: a Peer is something we have an application relationship
 * with, whereas this is just "something advertising nearby".
 */
export interface DiscoveredDevice {
  linkId: string;
  /** Transport address without the role prefix, as shown in the UI. */
  address: string;
  name: string | null;
  rssi: number | null;
  lastSeen: number;
  isChatPeer: boolean;
  isConnectable: boolean | null;
  serviceUuids: string[];
}

export interface AppState {
  ready: boolean;
  initError: string | null;

  identity: PeerIdentity | null;
  settings: AppSettings;

  bluetoothState: BluetoothState;
  permission: PermissionResult;
  peripheral: PeripheralStatus;
  scanning: boolean;

  peers: Peer[];
  devices: DiscoveredDevice[];
  groups: Group[];
  /** peerIds this device refuses to handshake with. */
  blockedPeerIds: string[];
  /** peerIds manually confirmed out-of-band — see `storage.loadVerifiedPeers`. */
  verifiedPeerIds: string[];
  /** Pinned peers — a display preference only, sorted first wherever peers are listed. */
  favoritePeerIds: string[];
  /** Security observations, newest first. Empty is the normal, healthy case. */
  securityEvents: SecurityEvent[];
  /** peerId -> what was noticed about that identity, for the warning banners. */
  identityAlerts: Record<string, IdentityAssessment>;
  conversations: Record<string, ChatMessage[]>;
  /** Conversation id -> messages received since it was last opened. */
  unread: Record<string, number>;
  /** Held / dialling / waiting links, and the budget the radio actually granted. */
  links: SchedulerSnapshot;

  counters: RouterCounters;
  session: SessionSnapshot;
  queuedTotal: number;
  lastPacket: {direction: 'tx' | 'rx'; packet: Packet; linkId: string} | null;
  logs: LogEntry[];
}

export const useAppStore = create<AppState>(() => ({
  ready: false,
  initError: null,

  identity: null,
  settings: {...DEFAULT_SETTINGS},

  bluetoothState: 'Unknown',
  permission: {state: 'unknown', denied: [], blocked: []},
  peripheral: {
    available: false,
    advertising: false,
    capabilities: null,
    error: null,
  },
  scanning: false,

  peers: [],
  devices: [],
  groups: [],
  blockedPeerIds: [],
  verifiedPeerIds: [],
  securityEvents: [],
  identityAlerts: {},
  favoritePeerIds: [],
  conversations: {},
  unread: {},
  links: {
    requestedBudget: LINK_BUDGET_DEFAULT,
    effectiveBudget: LINK_BUDGET_DEFAULT,
    budgetLearned: false,
    held: [],
    dialling: [],
    waiting: [],
  },

  counters: {
    tx: 0,
    rx: 0,
    ack: 0,
    failed: 0,
    duplicates: 0,
    forwarded: 0,
    dropped: 0,
    replayed: 0,
    spoofed: 0,
  },
  lastPacket: null,
  logs: [],
  session: {
    durationMs: 0,
    messagesSent: 0,
    messagesReceived: 0,
    bytesTx: 0,
    bytesRx: 0,
    reconnects: 0,
    avgAckLatencyMs: null,
    avgRssi: null,
  },
  queuedTotal: 0,
}));

const set = useAppStore.setState;

/**
 * Live device registry. Held outside the store because advertisements arrive many times
 * a second; the sampler below publishes a snapshot once a second instead.
 */
const deviceRegistry = new Map<string, DiscoveredDevice>();

/** A device not heard from for this long has left the area. */
const DEVICE_STALE_MS = 15_000;

let wired = false;

/**
 * Bridges the service layer's event buses into React state.
 *
 * This is the ONLY place the two worlds meet: no component subscribes to a BLE event and
 * no service knows React exists.
 */
export function wireStore(): void {
  if (wired) {
    return;
  }
  wired = true;

  bleChat.bus.on('ready', () => set({ready: true}));
  bleChat.bus.on('identity', identity => set({identity: {...identity}}));
  bleChat.bus.on('settings', settings => set({settings}));
  bleChat.bus.on('permission', permission => set({permission}));
  bleChat.bus.on('peripheralStatus', peripheral => set({peripheral}));
  bleChat.bus.on('bluetoothState', bluetoothState =>
    set({bluetoothState, scanning: bleChat.transport.isScanning}),
  );

  bleChat.peerManager.bus.on('peersChanged', peers => set({peers}));
  bleChat.peerManager.bus.on('blockedPeersChanged', blockedPeerIds =>
    set({blockedPeerIds}),
  );

  // Every advertisement refreshes the device registry. Batched into the 1s sampler
  // below rather than setting state per advertisement, which arrive continuously.
  bleChat.transport.bus.on('deviceSeen', adv => {
    deviceRegistry.set(adv.linkId, {
      linkId: adv.linkId,
      address: stripPrefix(adv.linkId),
      name: adv.advertisedName ?? adv.deviceName,
      rssi: adv.rssi,
      lastSeen: adv.timestamp,
      isChatPeer: adv.isChatPeer,
      isConnectable: adv.isConnectable,
      serviceUuids: adv.serviceUuids,
    });
  });

  bleChat.bus.on('links', links => set({links}));
  bleChat.bus.on('securityEvent', () =>
    set({securityEvents: bleChat.securityLog.all()}),
  );
  bleChat.bus.on('identityAssessed', assessment =>
    set({
      identityAlerts: {
        ...useAppStore.getState().identityAlerts,
        [assessment.peerId]: assessment,
      },
    }),
  );
  bleChat.messages.bus.on('unreadChanged', unread => set({unread}));
  bleChat.messages.bus.on('messagesChanged', ({conversationId, messages}) => {
    set(state => ({
      conversations: {...state.conversations, [conversationId]: messages},
    }));
  });

  bleChat.router.bus.on('counters', counters => set({counters}));
  bleChat.router.bus.on('lastPacket', lastPacket => set({lastPacket}));

  bleChat.messages.bus.on('groupsChanged', groups => set({groups}));

  bleChat.messages.bus.on('queueChanged', () => {
    set({queuedTotal: bleChat.messages.queue.total});
  });

  // Scanning state and the session clock are continuous values rather than events, so
  // they are sampled instead of pushed.
  setInterval(() => {
    const scanning = bleChat.transport.isScanning;
    if (useAppStore.getState().scanning !== scanning) {
      set({scanning});
    }
    const now = Date.now();
    for (const [linkId, device] of deviceRegistry) {
      if (now - device.lastSeen > DEVICE_STALE_MS) {
        deviceRegistry.delete(linkId);
      }
    }
    set({
      session: bleChat.session.snapshot(),
      peers: bleChat.peerManager.getPeers(),
      devices: Array.from(deviceRegistry.values()),
    });
  }, 1000);

  logger.bus.on('entry', entry => {
    set(state => {
      const logs = [...state.logs, entry];
      return {logs: logs.length > 300 ? logs.slice(-300) : logs};
    });
  });
  logger.bus.on('cleared', () => set({logs: []}));

  set({logs: logger.getEntries()});
}

export async function initApp(): Promise<void> {
  wireStore();
  try {
    await bleChat.init();
    set({
      ready: true,
      identity: bleChat.getIdentity(),
      settings: bleChat.getSettings(),
      permission: bleChat.getPermission(),
      peripheral: bleChat.getPeripheralStatus(),
      bluetoothState: bleChat.getBluetoothState(),
      peers: bleChat.peerManager.getPeers(),
      blockedPeerIds: bleChat.peerManager.blockedPeers(),
      verifiedPeerIds: await storage.loadVerifiedPeers(),
      favoritePeerIds: await storage.loadFavoritePeers(),
      securityEvents: bleChat.securityLog.all(),
      groups: bleChat.messages.groups.all(),
      unread: bleChat.messages.unreadCounts(),
      links: bleChat.getLinkStatus(),
      conversations: Object.fromEntries(
        bleChat.messages
          .getConversationIds()
          .map(id => [id, bleChat.messages.getMessages(id)]),
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('App', `init failed: ${message}`);
    set({initError: message});
  }
}

// ---- selectors ----------------------------------------------------------

/**
 * Shared frozen empties.
 *
 * zustand v5 sits on useSyncExternalStore and compares snapshots with Object.is, with no
 * implicit shallow equality. A selector that builds a fresh array on every call therefore
 * never compares equal, React re-renders, the selector runs again, and the component
 * spins forever — which surfaces as a blank screen with no red box, because the render
 * never completes. Returning one stable reference is what breaks that cycle.
 *
 * The same reason is why derived arrays below are computed with useMemo OUTSIDE the
 * selector rather than inside it.
 */
const EMPTY_MESSAGES = Object.freeze([]) as unknown as ChatMessage[];

/**
 * Pure and stable: for a conversation with no history it returns the SAME array object
 * every time, which is what keeps useSyncExternalStore from looping. Extracted from the
 * hook so the invariant can be asserted in a test.
 */
export function selectMessages(
  state: AppState,
  conversationId: string | null,
): ChatMessage[] {
  if (!conversationId) {
    return EMPTY_MESSAGES;
  }
  return state.conversations[conversationId] ?? EMPTY_MESSAGES;
}

export function useConnectedPeers(): Peer[] {
  const peers = useAppStore(s => s.peers);
  return useMemo(() => peers.filter(p => p.state === 'connected'), [peers]);
}

export function useMessages(conversationId: string | null): ChatMessage[] {
  return useAppStore(s => selectMessages(s, conversationId));
}

export function usePeer(peerId: string | null): Peer | null {
  return useAppStore(
    s => s.peers.find(p => p.peerId === peerId) ?? null,
  );
}

export function useBluetoothReady(): boolean {
  return useAppStore(s => s.bluetoothState === 'PoweredOn');
}

/**
 * Record that the user compared identity fingerprints with this peer in person and
 * confirmed they match. Purely a local trust marker — nothing is sent to the peer, and
 * nothing about the transport changes; it only changes what the UI tells this user.
 */
export function markPeerVerified(peerId: string): void {
  const next = Array.from(
    new Set([...useAppStore.getState().verifiedPeerIds, peerId]),
  );
  set({verifiedPeerIds: next});
  void storage.saveVerifiedPeers(next);
  // Worth a permanent record: it is the moment the user took responsibility for
  // trusting this identity, and a later impersonation warning refers back to it.
  bleChat.recordSecurityEvent(
    'peerVerified',
    'You compared security codes in person and confirmed they match.',
    {peerId, displayName: nameOf(peerId)},
  );
}

export function unmarkPeerVerified(peerId: string): void {
  const next = useAppStore.getState().verifiedPeerIds.filter(id => id !== peerId);
  set({verifiedPeerIds: next});
  void storage.saveVerifiedPeers(next);
  bleChat.recordSecurityEvent(
    'verificationRevoked',
    'You removed the verification for this identity.',
    {peerId, displayName: nameOf(peerId)},
  );
}

/** Best-effort display name for a peerId, for the security history. */
function nameOf(peerId: string): string | undefined {
  return useAppStore.getState().peers.find(p => p.peerId === peerId)?.displayName ??
    undefined;
}

/** Pin or unpin a peer — purely local display ordering, nothing the peer ever sees. */
export function toggleFavoritePeer(peerId: string): void {
  const current = useAppStore.getState().favoritePeerIds;
  const next = current.includes(peerId)
    ? current.filter(id => id !== peerId)
    : [...current, peerId];
  set({favoritePeerIds: next});
  void storage.saveFavoritePeers(next);
}
