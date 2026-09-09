import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ChatMessage} from '../types/Message';
import type {PeerIdentity} from '../types/Peer';
import type {ThemeMode} from '../config/theme';
import type {QueuedMessage} from '../messaging/MessageQueue';
import type {Group} from '../messaging/Groups';
import type {SecurityEvent} from '../security/SecurityLog';
import {
  generateKeyPair,
  peerIdFromPublicKey,
  publicKeyToHex,
} from '../crypto/Identity';
import {sanitiseLanguages} from '../config/languages';
import {sanitiseInterests} from '../config/interests';
import {LINK_BUDGET_DEFAULT, LINK_BUDGET_MAX} from '../config/constants';
import {bytesToHex} from '../utils/bytes';
import {
  decryptString,
  encryptString,
  generateStorageKey,
  storageKeyFromBase64,
  storageKeyFromHex,
  storageKeyToBase64,
  storageKeyToHex,
} from '../crypto/AtRestCrypto';
import {
  KeyInvalidatedError,
  unwrapKey,
  wrapKey,
  type KeyProtection,
} from '../security/SecureStore';
import {logger} from '../utils/logger';

const TAG = 'Storage';

const KEY_IDENTITY = '@blechat/identity';
const KEY_SETTINGS = '@blechat/settings';
const KEY_KNOWN_PEERS = '@blechat/knownPeers';
const KEY_SEEN_IDS = '@blechat/seenIds';
const KEY_REPLAY = '@blechat/replayWindow';
const KEY_SEQUENCE = '@blechat/sequence';
const KEY_OUTBOX = '@blechat/outbox';
const KEY_GROUPS = '@blechat/groups';
const KEY_LEFT_GROUPS = '@blechat/leftGroups';
const KEY_READ_MARKS = '@blechat/readMarks';
const KEY_BLOCKED_PEERS = '@blechat/blockedPeers';
const KEY_VERIFIED_PEERS = '@blechat/verifiedPeers';
const KEY_FAVORITE_PEERS = '@blechat/favoritePeers';
const KEY_APP_LOCK_HASH = '@blechat/appLockHash';
const KEY_MESSAGES_PREFIX = '@blechat/messages/';
const KEY_STORAGE_KEY = '@blechat/storageKey';
const KEY_SECURITY_EVENTS = '@blechat/securityEvents';
/** The at-rest key, wrapped by the Keystore. Replaces KEY_STORAGE_KEY where supported. */
const KEY_STORAGE_KEY_WRAPPED = '@blechat/storageKeyWrapped';

/** Persisted so the app is fully functional with no network of any kind. */
export interface AppSettings {
  displayName: string;
  /**
   * What this person is interested in, shared with every peer that connects.
   *
   * The app exists to help strangers in the same room find each other, and a name alone
   * gives nobody a reason to start talking. See src/config/interests.ts.
   */
  interests: string[];
  languages: string[];
  /**
   * True once the user has actually chosen a name.
   *
   * Kept as its own flag rather than inferred from a non-empty displayName: the app
   * refuses to advertise or scan until this is true, and that gate should not hinge on
   * a string that other code paths can also write.
   */
  profileComplete: boolean;
  /** 'system' follows the OS appearance setting live. */
  themeMode: ThemeMode;
  autoStartScanning: boolean;
  autoAdvertise: boolean;
  autoReconnect: boolean;
  relayEnabled: boolean;
  /**
   * Dial every chat peer discovered, up to the link budget.
   *
   * On by default because the app exists to put you in touch with whoever is nearby, and
   * making that happen one tap at a time defeats the point. Off is a legitimate choice
   * for battery or for a crowded room.
   */
  autoConnect: boolean;
  /**
   * How many links to hold at once — a request, not a promise. The radio has the final
   * say and ConnectionScheduler lowers this to whatever it actually grants.
   */
  maxConnections: number;
}

export interface KnownPeer {
  peerId: string;
  displayName: string;
  lastSeen: number;
  /**
   * Remembered so somebody you have met before still shows what you had in common,
   * before they are back in range and long before a handshake could tell you again.
   */
  interests?: string[];

  /**
   * Connection history, kept across restarts.
   *
   * Without these the peer profile's "Times connected" silently restarted at zero every
   * time the app was reopened — showing a number that looked like history but was only
   * ever this session's. A count that resets is worse than no count, because it reads
   * as fact.
   */
  connectCount?: number;
  /** When this identity was first met, as opposed to when it was last seen. */
  firstSeen?: number;
  /** Last time a handshake with them actually completed. */
  lastConnected?: number;
  /** Why the most recent attempt failed, when one did. */
  lastFailureReason?: string;
  lastFailureAt?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: '',
  interests: [],
  languages: [],
  profileComplete: false,
  themeMode: 'system',
  autoStartScanning: true,
  autoAdvertise: true,
  autoReconnect: true,
  relayEnabled: true,
  autoConnect: true,
  maxConnections: LINK_BUDGET_DEFAULT,
};

/** Cap per-conversation history so storage cannot grow without bound. */
const MAX_STORED_MESSAGES = 500;
const MAX_STORED_SEEN_IDS = 500;
const MAX_KNOWN_PEERS = 50;

class LocalStorageService {
  /**
   * Cached so every message write does not re-read and re-parse the key. Held only in
   * memory; the process losing it simply means the next read fetches it again.
   */
  private storageKey: Uint8Array | null = null;
  /** Set as soon as the key is loaded or created; reported in Settings. */
  private keyProtection: KeyProtection = 'unknown';

  /**
   * The key used to encrypt message content at rest.
   *
   * Generated once per installation. See AtRestCrypto for what this does and does not
   * protect against — it lives in the same store as the data, so it defends against
   * someone reading the stored file, not against someone who can run as this app.
   */
  private async getStorageKey(): Promise<Uint8Array> {
    if (this.storageKey) {
      return this.storageKey;
    }

    // Preferred: a key wrapped by the Android Keystore, useless to anyone who only has
    // a copy of these files.
    try {
      const wrapped = await AsyncStorage.getItem(KEY_STORAGE_KEY_WRAPPED);
      if (wrapped) {
        const unwrapped = await unwrapKey(wrapped);
        const key = storageKeyFromBase64(unwrapped);
        if (key) {
          this.storageKey = key;
          this.keyProtection = 'hardware';
          return key;
        }
      }
    } catch (err) {
      if (err instanceof KeyInvalidatedError) {
        // A device restore or reinstall: the hardware key is gone, so everything it
        // wrapped is permanently unreadable. Starting fresh is the honest outcome —
        // retrying cannot succeed, and pretending the old data is still there would
        // leave every read failing silently.
        logger.warn(
          TAG,
          'hardware key is gone (restore or reinstall); starting with a new one',
        );
        await AsyncStorage.removeItem(KEY_STORAGE_KEY_WRAPPED);
      } else {
        logger.warn(TAG, `wrapped key load failed: ${String(err)}`);
      }
    }

    // Legacy: a key written before hardware wrapping existed. Read it, then upgrade it
    // in place rather than discarding a working installation's history.
    try {
      const raw = await AsyncStorage.getItem(KEY_STORAGE_KEY);
      const existing = storageKeyFromHex(raw);
      if (existing) {
        this.storageKey = existing;
        this.keyProtection = 'software';
        await this.tryUpgradeToHardware(existing);
        return existing;
      }
    } catch (err) {
      logger.warn(TAG, 'storage key load failed, generating a new one', err);
    }

    const created = generateStorageKey();
    this.storageKey = created;
    if (!(await this.tryUpgradeToHardware(created))) {
      // No Keystore on this device: store it the old way and say so, rather than
      // failing to start.
      await AsyncStorage.setItem(KEY_STORAGE_KEY, storageKeyToHex(created));
      this.keyProtection = 'software';
    }
    return created;
  }

  /**
   * Move a key under hardware protection, if this device can.
   *
   * The unwrapped copy is removed only after the wrapped one is safely written — the
   * reverse order would lose every stored message on a device that failed mid-upgrade.
   */
  private async tryUpgradeToHardware(key: Uint8Array): Promise<boolean> {
    const wrapped = await wrapKey(storageKeyToBase64(key));
    if (!wrapped) {
      return false;
    }
    await AsyncStorage.setItem(KEY_STORAGE_KEY_WRAPPED, wrapped);
    await AsyncStorage.removeItem(KEY_STORAGE_KEY);
    this.keyProtection = 'hardware';
    logger.info(TAG, 'at-rest key is now wrapped by the Keystore');
    return true;
  }

  /** How the at-rest key is protected right now, for the security UI to report. */
  getKeyProtection(): KeyProtection {
    return this.keyProtection;
  }

  /** Read a value that may be encrypted, or may predate the encryption layer. */
  private async readSecure(key: string): Promise<string | null> {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    try {
      return decryptString(raw, await this.getStorageKey());
    } catch (err) {
      // A record that will not decrypt is unreadable, not recoverable by guessing.
      // Losing it loudly beats returning something that looks like plausible data.
      logger.warn(TAG, `could not decrypt ${key}`, err);
      return null;
    }
  }

  private async writeSecure(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, encryptString(value, await this.getStorageKey()));
  }

  /**
   * Load the installation identity, creating it on first launch.
   *
   * The peerId comes from a platform CSPRNG and is never derived from the Bluetooth MAC,
   * device name or model: BLE addresses are randomised and rotate, so hardware identity
   * would be both unstable and a privacy leak.
   */
  async loadOrCreateIdentity(defaultName: string): Promise<PeerIdentity> {
    try {
      const raw = await AsyncStorage.getItem(KEY_IDENTITY);
      if (raw) {
        const parsed = JSON.parse(raw) as PeerIdentity;
        // An identity stored before authentication existed has no keypair and cannot
        // prove itself. Regenerating is the honest outcome: a new, verifiable identity
        // rather than an unprovable old one.
        //
        // displayName is deliberately NOT part of this check. It is a mutable label the
        // user can change at any time; the identity IS the keypair. Requiring a name
        // here meant an empty one silently discarded the keypair and minted a new
        // peerId — orphaning every conversation, voiding every verification the other
        // phone had recorded, and looking from the outside like a stranger had taken
        // over the account.
        if (parsed.peerId && parsed.privateKey && parsed.publicKey) {
          logger.info(
            TAG,
            `identity loaded: ${parsed.displayName || '(no name set yet)'}`,
          );
          return {...parsed, displayName: parsed.displayName ?? ''};
        }
        if (parsed.peerId) {
          logger.warn(
            TAG,
            'stored identity predates authentication and has no keypair; regenerating',
          );
        }
      }
    } catch (err) {
      logger.warn(TAG, 'identity load failed, regenerating', err);
    }

    // The identity IS the keypair: peerId is derived from the public key, so it cannot
    // be claimed by anyone who does not hold the private half.
    const keys = generateKeyPair();
    const identity: PeerIdentity = {
      peerId: peerIdFromPublicKey(keys.publicKey),
      displayName: defaultName,
      publicKey: publicKeyToHex(keys.publicKey),
      privateKey: bytesToHex(keys.privateKey),
    };
    await this.saveIdentity(identity);
    logger.info(TAG, `new identity created: ${identity.peerId}`);
    return identity;
  }

  async saveIdentity(identity: PeerIdentity): Promise<void> {
    await AsyncStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
  }

  async loadSettings(): Promise<AppSettings> {
    try {
      const raw = await AsyncStorage.getItem(KEY_SETTINGS);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<AppSettings>;
        return {
          ...DEFAULT_SETTINGS,
          ...stored,
          // Bounded on the way in as well as on the way out: this file survives app
          // upgrades, so it can hold anything an older build wrote.
          interests: sanitiseInterests(stored.interests),
          languages: sanitiseLanguages(stored.languages),
          // Clamped on load: this file survives upgrades and can hold anything an older
          // build wrote, including a budget beyond what is sane to attempt.
          maxConnections: Math.min(
            LINK_BUDGET_MAX,
            Math.max(1, Math.floor(stored.maxConnections ?? LINK_BUDGET_DEFAULT)),
          ),
        };
      }
    } catch (err) {
      logger.warn(TAG, 'settings load failed, using defaults', err);
    }
    return {...DEFAULT_SETTINGS};
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
  }

  // Message content is the whole point of the at-rest layer: everything below goes
  // through readSecure/writeSecure rather than touching AsyncStorage directly.
  async loadMessages(conversationId: string): Promise<ChatMessage[]> {
    try {
      const raw = await this.readSecure(KEY_MESSAGES_PREFIX + conversationId);
      return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    } catch (err) {
      logger.warn(TAG, `message load failed for ${conversationId}`, err);
      return [];
    }
  }

  async saveMessages(
    conversationId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    const trimmed = messages.slice(-MAX_STORED_MESSAGES);
    await this.writeSecure(
      KEY_MESSAGES_PREFIX + conversationId,
      JSON.stringify(trimmed),
    );
  }

  async loadConversationIds(): Promise<string[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return keys
        .filter(k => k.startsWith(KEY_MESSAGES_PREFIX))
        .map(k => k.slice(KEY_MESSAGES_PREFIX.length));
    } catch {
      return [];
    }
  }

  async loadKnownPeers(): Promise<KnownPeer[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_KNOWN_PEERS);
      return raw ? (JSON.parse(raw) as KnownPeer[]) : [];
    } catch {
      return [];
    }
  }

  async rememberPeer(peer: KnownPeer): Promise<void> {
    const known = await this.loadKnownPeers();
    const next = known.filter(p => p.peerId !== peer.peerId);
    next.push(peer);
    // Most-recent first, bounded, so a busy environment cannot grow this forever.
    next.sort((a, b) => b.lastSeen - a.lastSeen);
    await AsyncStorage.setItem(
      KEY_KNOWN_PEERS,
      JSON.stringify(next.slice(0, MAX_KNOWN_PEERS)),
    );
  }

  /**
   * Seen packet ids survive a restart so a peer that retransmits after we relaunch does
   * not get its message shown twice.
   */
  async loadSeenIds(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_SEEN_IDS);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  async saveSeenIds(ids: string[]): Promise<void> {
    await AsyncStorage.setItem(
      KEY_SEEN_IDS,
      JSON.stringify(ids.slice(-MAX_STORED_SEEN_IDS)),
    );
  }

  /**
   * Replay high-water marks, one per sender.
   *
   * Without persistence a restart resets every window to zero, and a packet captured
   * before the relaunch would be accepted as brand new — which is precisely the attack
   * the window exists to stop. Only the high-water mark is stored; the in-window set is
   * small, short-lived, and rebuilds on its own.
   */
  async loadReplayWindow(): Promise<Record<string, number>> {
    try {
      const raw = await AsyncStorage.getItem(KEY_REPLAY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, number>)
        : {};
    } catch {
      return {};
    }
  }

  async saveReplayWindow(marks: Record<string, number>): Promise<void> {
    await AsyncStorage.setItem(KEY_REPLAY, JSON.stringify(marks));
  }

  /**
   * Our own outbound sequence high-water mark.
   *
   * Stored ahead of where the counter actually is (see SEQ_PERSIST_RESERVE): if the app
   * dies without a clean shutdown, resuming BELOW the numbers our peers already filed
   * would make our next messages look like replays to them and be dropped.
   */
  async loadSequence(): Promise<number> {
    try {
      const raw = await AsyncStorage.getItem(KEY_SEQUENCE);
      const value = raw ? Number(JSON.parse(raw)) : 0;
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } catch {
      return 0;
    }
  }

  async saveSequence(value: number): Promise<void> {
    await AsyncStorage.setItem(KEY_SEQUENCE, JSON.stringify(value));
  }

  /**
   * The outbox survives a restart, so a message composed while a peer was away is still
   * delivered after the app is relaunched rather than quietly lost.
   */
  async loadOutbox(): Promise<QueuedMessage[]> {
    try {
      const raw = await this.readSecure(KEY_OUTBOX);
      return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
    } catch {
      return [];
    }
  }

  async saveOutbox(messages: QueuedMessage[]): Promise<void> {
    // Queued messages are message text that has not been sent yet — exactly the content
    // this layer exists for, and it can sit here for days waiting for a peer.
    await this.writeSecure(KEY_OUTBOX, JSON.stringify(messages));
  }

  /**
   * Security observations, kept across restarts.
   *
   * Encrypted like message content: the list names who this phone has met and when it
   * grew suspicious of them, which is exactly the sort of thing that should not sit in
   * readable form in a device backup.
   */
  async loadSecurityEvents(): Promise<SecurityEvent[]> {
    try {
      const raw = await this.readSecure(KEY_SECURITY_EVENTS);
      return raw ? (JSON.parse(raw) as SecurityEvent[]) : [];
    } catch {
      return [];
    }
  }

  async saveSecurityEvents(events: SecurityEvent[]): Promise<void> {
    await this.writeSecure(KEY_SECURITY_EVENTS, JSON.stringify(events));
  }

  /** Groups are shared peer-to-peer, so each device keeps its own copy. */
  async loadGroups(): Promise<Group[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_GROUPS);
      return raw ? (JSON.parse(raw) as Group[]) : [];
    } catch {
      return [];
    }
  }

  async saveGroups(groups: Group[]): Promise<void> {
    await AsyncStorage.setItem(KEY_GROUPS, JSON.stringify(groups));
  }

  /**
   * Groups the user has left.
   *
   * Persisted separately from the group list because it has to outlive it: an inbound
   * message re-creates an unknown group, so without a record of having left, leaving
   * would be undone by the next message anyone sent.
   */
  async loadLeftGroups(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_LEFT_GROUPS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async saveLeftGroups(ids: string[]): Promise<void> {
    await AsyncStorage.setItem(KEY_LEFT_GROUPS, JSON.stringify(ids));
  }

  /**
   * When each conversation was last opened.
   *
   * Persisted so a relaunch does not present every conversation as unread — which would
   * make the badge meaningless within a day of using the app.
   */
  async loadReadMarks(): Promise<Record<string, number>> {
    try {
      const raw = await AsyncStorage.getItem(KEY_READ_MARKS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, number>)
        : {};
    } catch {
      return {};
    }
  }

  async saveReadMarks(marks: Record<string, number>): Promise<void> {
    await AsyncStorage.setItem(KEY_READ_MARKS, JSON.stringify(marks));
  }

  /**
   * peerIds this device refuses to handshake with.
   *
   * Identity-based, like everything else here — a MAC/linkId block would be trivial to
   * evade by the BLE address simply rotating, which it does on its own anyway.
   */
  async loadBlockedPeers(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_BLOCKED_PEERS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async saveBlockedPeers(ids: string[]): Promise<void> {
    await AsyncStorage.setItem(KEY_BLOCKED_PEERS, JSON.stringify(ids));
  }

  /**
   * peerIds the user has manually confirmed out-of-band — by comparing the identity
   * fingerprint on both screens in person — as opposed to `authenticated`, which only
   * means the handshake's challenge-response succeeded. A successful handshake proves a
   * session really is talking to whoever claims this peerId; it cannot prove that peerId
   * belongs to the specific person the user thinks it does on first contact. This is
   * exactly the distinction Signal's "safety number" and WhatsApp's "security code"
   * exist to cover, applied to the identity key this app already has.
   */
  async loadVerifiedPeers(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_VERIFIED_PEERS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async saveVerifiedPeers(ids: string[]): Promise<void> {
    await AsyncStorage.setItem(KEY_VERIFIED_PEERS, JSON.stringify(ids));
  }

  /** Pinned peers — purely a display preference, sorted first wherever peers are listed. */
  async loadFavoritePeers(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_FAVORITE_PEERS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async saveFavoritePeers(ids: string[]): Promise<void> {
    await AsyncStorage.setItem(KEY_FAVORITE_PEERS, JSON.stringify(ids));
  }

  /**
   * A local screen lock, not encryption — see `src/security/AppLock.ts` for what that
   * distinction means and why it matters. Presence of a hash is what "enabled" means;
   * there is nothing else to track.
   */
  async loadAppLock(): Promise<{enabled: boolean; pinHash: string | null}> {
    try {
      const hash = await AsyncStorage.getItem(KEY_APP_LOCK_HASH);
      return {enabled: !!hash, pinHash: hash};
    } catch {
      return {enabled: false, pinHash: null};
    }
  }

  async saveAppLockPin(hash: string): Promise<void> {
    await AsyncStorage.setItem(KEY_APP_LOCK_HASH, hash);
  }

  async clearAppLock(): Promise<void> {
    await AsyncStorage.removeItem(KEY_APP_LOCK_HASH);
  }

  async clearAll(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(k => k.startsWith('@blechat/'));
    await AsyncStorage.multiRemove(ours);
    logger.warn(TAG, `cleared ${ours.length} stored keys`);
  }

  async clearMessages(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(k => k.startsWith(KEY_MESSAGES_PREFIX));
    await AsyncStorage.multiRemove(ours);
  }
}

export const storage = new LocalStorageService();
