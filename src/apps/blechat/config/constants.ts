/**
 * Central place for every protocol / BLE identifier.
 * Nothing else in the app may hardcode a UUID.
 */

/** Custom 128-bit GATT service for this application. */
export const BLE_SERVICE_UUID = '7a0b0001-4a71-4f9a-9c5e-2b1d3c4e5f60';

/**
 * RX characteristic — written to by the remote CENTRAL, received by the local PERIPHERAL.
 * Properties: Write, WriteWithoutResponse.
 */
export const BLE_RX_CHAR_UUID = '7a0b0002-4a71-4f9a-9c5e-2b1d3c4e5f60';

/**
 * TX characteristic — notified by the local PERIPHERAL, received by the remote CENTRAL.
 * Properties: Notify (+ Read).
 */
export const BLE_TX_CHAR_UUID = '7a0b0003-4a71-4f9a-9c5e-2b1d3c4e5f60';

/** Standard Client Characteristic Configuration Descriptor. Required for notifications. */
export const BLE_CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';

/**
 * Company identifier used in the Android advertisement's manufacturer-specific data.
 * 0xFFFF is the SIG-reserved "for internal / test use" value — appropriate for a
 * prototype that is not a registered Bluetooth SIG member.
 */
export const BLE_MANUFACTURER_ID = 0xffff;

/** Prefix for the advertised local name, used to spot iOS peers (iOS cannot advertise manufacturer data). */
export const BLE_LOCAL_NAME_PREFIX = 'BC-';

/**
 * Application protocol version.
 *
 * v2 introduced the authenticated handshake. v3 added the per-sender sequence number that
 * replay protection depends on. v4 makes the link encrypted: the handshake carries signed
 * X25519 ephemeral keys and every packet after it is sealed with ChaCha20-Poly1305.
 *
 * Older versions are deliberately NOT accepted. Every one of those changes is
 * security-relevant, and a peer that can talk us down to a version without them gets
 * exactly the bypass the mechanism exists to prevent — a v3 peer would speak plaintext,
 * so a downgrade is refused outright rather than tolerated.
 */
export const PROTOCOL_VERSION = 4;

/**
 * Oldest protocol version we will still talk to. Raising this is how support for an old
 * build is dropped deliberately, with a clear rejection rather than a silent failure.
 */
export const MIN_COMPATIBLE_VERSION = 4;

/** Outbox limits, so an unreachable peer cannot grow storage without bound. */
export const QUEUE_MAX_PER_PEER = 100;
export const QUEUE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Default TTL placed on outbound packets. Meaningful once mesh relaying lands (Phase 2). */
export const DEFAULT_TTL = 5;

/** Destination value meaning "every peer". */
export const BROADCAST_ID = '*';

/**
 * Reassembly limits.
 *
 * fragCount arrives from an UNAUTHENTICATED peer, so it is an attacker-controlled
 * allocation size unless it is bounded. These caps put a hard ceiling on what one link
 * can make us hold.
 */
export const MAX_FRAGMENTS_PER_STREAM = 2048;
export const MAX_REASSEMBLY_BYTES = 256 * 1024;
export const MAX_CONCURRENT_STREAMS = 8;

/** Fragmentation framing. */
export const FRAGMENT_MAGIC = 0xb1;
/** Header grew by one byte in v2 to carry a frame type. */
export const FRAGMENT_HEADER_SIZE = 11;
export const FRAME_TYPE_DATA = 0x00;
export const FRAME_TYPE_NACK = 0x01;

/**
 * Selective retransmission.
 *
 * A stream is only chased once it has been quiet for NACK_QUIET_MS, so a request is
 * never raced against frames still in flight. After NACK_MAX_ROUNDS the stream is
 * abandoned and the application-level ACK timeout takes over.
 */
export const NACK_QUIET_MS = 600;
export const NACK_MAX_ROUNDS = 3;
/** How long a sender keeps frames available to answer a NACK. */
export const RETRANSMIT_BUFFER_MS = 15_000;

/**
 * ATT default MTU is 23 bytes; 3 bytes are ATT overhead. Until an MTU is negotiated we
 * must assume the worst case, otherwise writes silently truncate.
 */
export const DEFAULT_ATT_MTU = 23;
export const ATT_HEADER_SIZE = 3;

/** MTU we ask for after connecting (Android caps at 517). */
export const REQUESTED_MTU = 512;

/** How long a partially received fragment stream is kept before being discarded. */
export const REASSEMBLY_TIMEOUT_MS = 30_000;

/** Handshake must complete within this window or the link is torn down. */
export const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * How long the higher-numbered identity waits before dialling anyway.
 *
 * Both phones see each other at the same moment and both dial, which on Android's stack
 * collapses into one ACL link being torn down under the other — the link comes up, the
 * stack drops it a millisecond later, and the greeting is refused because the connection
 * it was written to no longer exists. Only one side should dial. Which side is decided by
 * comparing identities, so the two phones always agree without exchanging anything.
 *
 * This is the fallback for when the other side never dials — an older build, or a phone
 * that cannot advertise. Long enough for a real connection to have got going, short
 * enough not to read as the app doing nothing.
 */
export const SIMULTANEOUS_DIAL_GRACE_MS = 3_000;

/** How long we wait for an application-level ACK before marking a message failed. */
export const ACK_TIMEOUT_MS = 20_000;

/** Number of recently seen packet IDs retained for deduplication. */
export const SEEN_CACHE_SIZE = 2000;

/** A discovered peer is dropped from the nearby list after this long without an advertisement. */
export const PEER_STALE_MS = 20_000;

/**
 * Delay before retrying a dropped central connection: 1s, 2s, 4s, 8s, ... capped.
 *
 * Doubling matters more than the starting point. Reconnecting immediately reproduces the
 * most common cause of an Android connect failure — a previous connection the stack has
 * not finished tearing down — so a flat retry hammers the peer into failing the same way.
 */
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
/** After this many consecutive failures the peer is left alone until it advertises again. */
export const RECONNECT_MAX_ATTEMPTS = 5;

/** How long a single central connection attempt may take before it is abandoned. */
export const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Replay protection.
 *
 * The seen-id cache is an LRU, so it forgets. A captured packet resent after its id was
 * evicted would be accepted as new. A monotonic per-sender counter has no such window:
 * anything at or below `highest - REPLAY_WINDOW_SIZE` is old forever.
 *
 * 64 is generous for a link that delivers in order — it only has to absorb genuine
 * reordering, not loss.
 */
export const REPLAY_WINDOW_SIZE = 64;
/** Senders tracked at once. Bounded so a crowded room cannot grow this without limit. */
export const REPLAY_MAX_SENDERS = 64;

/**
 * Android GATT_ERROR. The single most common real-world Android BLE failure: the stack
 * returns it for a stale GATT cache, a connection attempt made too soon after the last
 * one, or simply too many concurrent connections. It is almost always transient, so a
 * bounded retry recovers where a single attempt reports a false "peer unreachable".
 */
export const ANDROID_GATT_ERROR = 133;

/** Bounded connect retry. Delays are deliberately long: 133 usually means "too soon". */
export const CONNECT_MAX_ATTEMPTS = 3;
export const CONNECT_RETRY_BASE_DELAY_MS = 600;
export const CONNECT_RETRY_MAX_DELAY_MS = 4_000;
/** Android needs a moment after cancelling before the stack will accept a new attempt. */
export const CONNECT_TEARDOWN_SETTLE_MS = 250;

/**
 * How far ahead the outbound sequence number is persisted.
 *
 * Saving on every packet would be a write per message; saving on a timer would lose the
 * last few seconds to a crash and restart the counter BELOW where our peers last saw it,
 * which reads as a replay to them. Reserving a block instead means a crash costs unused
 * numbers rather than correctness — and unused numbers are free, since gaps in `seq`
 * carry no meaning (gap detection is `convSeq`'s job).
 */
export const SEQ_PERSIST_RESERVE = 500;

/**
 * How many BLE links to hold at once.
 *
 * There is no API that reports the real ceiling: it is a property of the chipset and the
 * Android build, commonly around seven, and shared with everything else the phone has
 * connected. 8 is the default request rather than a promise — ConnectionScheduler lowers
 * it to whatever the radio actually grants, and the UI reports the difference instead of
 * pretending the request was met.
 */
export const LINK_BUDGET_DEFAULT = 8;
export const LINK_BUDGET_MAX = 10;

/**
 * Connect attempts allowed in flight at once.
 *
 * One. Issuing several `connectGatt` calls concurrently is among the most reliable ways
 * to produce status 133, so bringing up ten links is deliberately slower and far more
 * likely to finish.
 */
export const LINK_DIAL_PARALLELISM = 1;

/**
 * How long a link is held before rotation may reclaim its slot.
 *
 * Long enough to have been worth connecting for. Cycling faster than a handshake takes
 * serves nobody — it just keeps every link permanently half-open.
 */
export const LINK_MIN_HOLD_MS = 20_000;

/** How often rotation is considered while peers are waiting for a slot. */
export const LINK_ROTATE_INTERVAL_MS = 10_000;
