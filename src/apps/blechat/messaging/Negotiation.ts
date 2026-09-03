import {MIN_COMPATIBLE_VERSION, PROTOCOL_VERSION} from '../config/constants';

/**
 * Version and capability negotiation.
 *
 * Pure functions with no dependencies, so the compatibility matrix is unit-testable and
 * cannot drift from what the handshake actually does.
 */

export interface VersionRange {
  /** Highest protocol version this peer speaks. */
  version: number;
  /** Lowest version it is still willing to speak. */
  min: number;
}

export type VersionVerdict =
  /** Both sides are on the same version. */
  | 'exact'
  /** A common older version exists; both sides drop to it. */
  | 'degraded'
  /** No overlap. The link must be refused rather than left to fail later. */
  | 'unsupported';

export interface VersionOutcome {
  verdict: VersionVerdict;
  /** The version both sides will use, or null when there is no overlap. */
  agreed: number | null;
  /** Human-readable, suitable for the peer card and the debug report. */
  explanation: string;
}

export const LOCAL_VERSION: VersionRange = {
  version: PROTOCOL_VERSION,
  min: MIN_COMPATIBLE_VERSION,
};

/**
 * Highest version both sides can speak, provided it is not below either side's floor.
 *
 *   v1 <-> v1   exact
 *   v1 <-> v2   degraded to v1, provided v2's floor allows v1
 *   v1 <-> v3   unsupported when v3 has dropped v1 support
 *
 * Refusing explicitly matters: a peer that is allowed to connect and then silently drops
 * every packet is far harder to diagnose than one that says why it was rejected.
 */
export function negotiateVersion(
  local: VersionRange,
  remote: VersionRange,
): VersionOutcome {
  const agreed = Math.min(local.version, remote.version);
  const floor = Math.max(local.min, remote.min);

  if (agreed < floor) {
    return {
      verdict: 'unsupported',
      agreed: null,
      explanation:
        `Peer speaks v${remote.min}-v${remote.version}, we speak ` +
        `v${local.min}-v${local.version}. No common version.`,
    };
  }

  if (agreed === local.version && agreed === remote.version) {
    return {verdict: 'exact', agreed, explanation: `Protocol v${agreed}`};
  }

  return {
    verdict: 'degraded',
    agreed,
    explanation:
      `Running in compatibility mode at v${agreed} ` +
      `(we support up to v${local.version}, peer up to v${remote.version}).`,
  };
}

// ---------------------------------------------------------------- capabilities

/**
 * What a peer can do. Every flag must correspond to something the code actually
 * implements — advertising a capability we do not have is the same class of lie as a
 * fake connection state.
 */
export interface Capabilities {
  /** Text messaging. Always true; present so the set is self-describing. */
  messaging: boolean;
  /** Willing to relay packets for others. Reserved for Phase 2. */
  relay: boolean;
  /**
   * Link encryption: X25519 key agreement, signed by the identity keys, with
   * ChaCha20-Poly1305 on every non-handshake packet. Always true now that the layer
   * exists — a peer without it cannot complete a handshake at all, so there is no
   * "encryption off" configuration to report.
   */
  encryption: boolean;
  /** Negotiated an ATT MTU above the 23-byte default. */
  largeMtu: boolean;
}

export const CAPABILITY_KEYS: Array<keyof Capabilities> = [
  'messaging',
  'relay',
  'encryption',
  'largeMtu',
];

export function localCapabilities(options: {
  relay: boolean;
  largeMtu: boolean;
}): Capabilities {
  return {
    messaging: true,
    relay: options.relay,
    // True because the layer is now real and mandatory — see Capabilities.encryption.
    encryption: true,
    largeMtu: options.largeMtu,
  };
}

/** Tolerates a peer that sends a partial or older capability object. */
export function parseCapabilities(raw: unknown): Capabilities {
  const c = (raw ?? {}) as Partial<Capabilities>;
  return {
    // An older peer that only sent {relay} still does messaging.
    messaging: c.messaging !== false,
    relay: c.relay === true,
    encryption: c.encryption === true,
    largeMtu: c.largeMtu === true,
  };
}

/**
 * The feature set both sides can actually use: the intersection.
 *
 * Intersection rather than union because a capability is only usable if BOTH ends
 * implement it — claiming encryption because one side supports it would be worse than
 * not having it at all.
 */
export function agreeCapabilities(
  local: Capabilities,
  remote: Capabilities,
): Capabilities {
  return {
    messaging: local.messaging && remote.messaging,
    relay: local.relay && remote.relay,
    encryption: local.encryption && remote.encryption,
    largeMtu: local.largeMtu && remote.largeMtu,
  };
}

export function describeCapabilities(caps: Capabilities): string {
  return CAPABILITY_KEYS.map(k => (caps[k] ? '✓ ' : '✗ ') + k).join('  ');
}
