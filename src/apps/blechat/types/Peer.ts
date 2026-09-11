import type {ScreenshotPolicy} from '../security/ScreenPolicy';
import type {LinkMetricsSnapshot} from '../peers/LinkMetrics';
import type {
  LinkId,
  LinkRole,
  LinkState,
  GattDiagnostics,
  LinkFailure,
} from './BLE';

/** Stable, application-level identity. Independent of Bluetooth hardware addresses. */
export interface PeerIdentity {
  /** sha256(publicKey)[:16], hex. A commitment to the key, not a random string. */
  peerId: string;
  displayName: string;
  /** Ed25519 public key, hex. Shared with peers. */
  publicKey: string;
  /** Ed25519 private key, hex. NEVER transmitted. */
  privateKey: string;
}

import type {Capabilities} from '../messaging/Negotiation';

/** One source of truth for the capability set. */
export type PeerCapabilities = Capabilities;
export type {Capabilities};

export type SignalStrength = 'strong' | 'medium' | 'weak' | 'unknown';

/** A peer we have seen advertising, connected to, or both. */
export interface Peer {
  /** Application identity. Null until the HELLO handshake completes. */
  peerId: string | null;
  /** Short hex prefix parsed from the advertisement, available before connecting. */
  peerIdPrefix: string | null;
  displayName: string | null;
  /** Interests this peer shared during the handshake. Empty until then. */
  interests: string[];
  /** Languages this peer shared during the handshake. Empty until then. */
  languages: string[];
  linkId: LinkId | null;
  role: LinkRole | null;
  state: LinkState;
  rssi: number | null;
  lastSeen: number;
  /** Version this link settled on, which may be lower than either side's maximum. */
  protocolVersion: number | null;
  /** What the peer claims it can do. */
  capabilities: PeerCapabilities | null;
  /** Intersection of theirs and ours — what this link can actually use. */
  agreedCapabilities: PeerCapabilities | null;
  /** Set when the versions did not line up exactly. */
  compatibilityNote: string | null;
  /**
   * What this peer permits a screenshot of the conversation to do, or null when they did
   * not say — an older build, or one that has never handshaken with us. Null is "no
   * opinion", never permission: the stricter of the two sides is what applies.
   */
  screenshotPolicy: ScreenshotPolicy | null;
  /** The peer's Ed25519 public key, once its identity has been proven. */
  publicKey: string | null;
  /** True once a signature over our challenge has verified. */
  authenticated: boolean;
  /** Messages waiting in the outbox for this peer. */
  queuedCount: number;
  /** Live measurements for this link. */
  metrics: LinkMetricsSnapshot | null;
  gatt: GattDiagnostics | null;
  /** Typed reason for the most recent failure, with the stage it happened in. */
  failure: LinkFailure | null;
  /** When we first saw this peer in the current session. */
  firstSeen: number;
  /** Successful handshakes with this peer since launch — a reconnect-churn signal. */
  connectCount: number;
  /** Dial attempts made on this link, including the ones that failed. */
  attempts: number;
  /** Attempts that ended in a typed failure. */
  failures: number;
  /**
   * Which automatic reconnect we are on, 0 when none is pending.
   *
   * Surfaced so a dropped link reads as "Reconnecting 2/5" rather than flipping straight
   * to disconnected — the app is still working on it, and saying so is the difference
   * between "broken" and "wait a moment".
   */
  reconnectAttempt: number;
}
