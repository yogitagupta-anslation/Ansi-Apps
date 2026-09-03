import type {
  DiscoveredAdvertisement,
  GattDiagnostics,
  LinkId,
  LinkRole,
  LinkState,
} from './BLE';

export interface TransportLinkEvent {
  linkId: LinkId;
  role: LinkRole;
}

export interface TransportLinkDownEvent extends TransportLinkEvent {
  reason: string | null;
}

export interface TransportDataEvent {
  linkId: LinkId;
  data: Uint8Array;
}

export type TransportDiscoveredEvent = DiscoveredAdvertisement & {linkId: LinkId};

/** Progress through the connection state machine, before the link is up. */
export interface TransportPhaseEvent {
  linkId: LinkId;
  phase: LinkState;
}

/**
 * The slice of a transport that PeerManager needs.
 *
 * Declared as an interface rather than the concrete BLETransport so that peers/ has no
 * dependency on ble/. That keeps the layering honest, lets a Wi-Fi Direct transport drop
 * in unchanged, and makes the whole discovery/handshake/link-lifecycle path testable
 * off-device against an in-memory transport.
 */
export interface PeerLinkTransport {
  onLinkUp(cb: (e: TransportLinkEvent) => void): () => void;
  onLinkDown(cb: (e: TransportLinkDownEvent) => void): () => void;
  onDiscovered(cb: (e: TransportDiscoveredEvent) => void): () => void;
  /** Fires for each stage of connecting, so the UI can show where a link actually is. */
  onLinkPhase(cb: (e: TransportPhaseEvent) => void): () => void;

  connect(linkId: LinkId): Promise<LinkId>;
  /**
   * Abandon an attempt that is still in progress.
   *
   * Distinct from disconnect(): a cancelled attempt must not be retried, and the peer is
   * not "unreachable" — the user simply changed their mind. Without this, tapping Connect
   * by accident leaves the row stuck on "Connecting" for the full timeout and then
   * through every retry.
   */
  cancelConnect(linkId: LinkId): Promise<void>;
  disconnect(linkId: LinkId): Promise<void>;

  getGatt(linkId: LinkId): GattDiagnostics | null;
}

/**
 * The only surface the messaging layer is allowed to know about.
 *
 * Deliberately addressed by LinkId (a transport address) rather than peerId (an
 * application identity): the transport cannot know an application identity, because
 * that identity is established by a handshake which itself travels over the transport.
 * PeerManager owns the peerId <-> linkId mapping.
 *
 * A future WifiDirectTransport / WindowsBleTransport implements this same interface and
 * nothing in messaging/ has to change.
 */
export interface ITransport {
  readonly name: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  startScanning(): Promise<void>;
  stopScanning(): Promise<void>;

  /** Open a link to something we discovered. Resolves with the established LinkId. */
  connect(linkId: LinkId): Promise<LinkId>;
  disconnect(linkId: LinkId): Promise<void>;

  /**
   * Fragmentation happens below this call; `data` may be any length.
   *
   * `onProgress`, when supplied, fires after each fragment is actually written — never a
   * fake ramp on a timer. Optional and additive: every existing caller that omits it
   * behaves exactly as before.
   */
  send(
    linkId: LinkId,
    data: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void>;

  onLinkUp(cb: (e: TransportLinkEvent) => void): () => void;
  onLinkDown(cb: (e: TransportLinkEvent) => void): () => void;
  onData(cb: (e: TransportDataEvent) => void): () => void;
}
