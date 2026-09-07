import {Platform} from 'react-native';
import {BLETransport} from '../ble/BLETransport';
import {
  checkBlePermissions,
  requestBlePermissions,
  type PermissionResult,
} from '../ble/BLEPermissions';
import {
  blePeripheral,
  type PeripheralCapabilities,
} from '../ble/BlePeripheralBridge';
import {SeenMessageStore} from '../messaging/Deduplication';
import {ReplayWindow, SequenceCounter} from '../messaging/ReplayWindow';
import {MessageRouter} from '../messaging/MessageRouter';
import {MessageService} from '../messaging/MessageService';
import {SecurePacketCodec} from '../messaging/PacketCodec';
import {SessionRegistry} from '../crypto/SessionRegistry';
import type {ScanIntensity, ScanTelemetry} from '../ble/ScanDutyCycle';
import {
  notifyIncoming,
  requestNotificationPermission,
  startPresence,
  stopPresence,
} from './Presence';
import {
  assessIdentity,
  describeAssessment,
  isSuspicious,
  type IdentityAssessment,
  type KnownIdentity,
} from '../security/IdentityWatch';
import {SecurityLog, type SecurityEventKind} from '../security/SecurityLog';
import {PeerManager} from '../peers/PeerManager';
import {SessionMetrics} from '../peers/LinkMetrics';
import {
  ConnectionScheduler,
  type SchedulerSnapshot,
} from '../peers/ConnectionScheduler';
import {toLinkFailure} from '../utils/linkFailure';
import {localCapabilities, type Capabilities} from '../messaging/Negotiation';
import {
  DEFAULT_ATT_MTU,
  LINK_ROTATE_INTERVAL_MS,
  SEQ_PERSIST_RESERVE,
} from '../config/constants';
import {
  storage,
  type AppSettings,
  DEFAULT_SETTINGS,
} from '../storage/LocalStorage';
import type {BluetoothState, PermissionState} from '../types/BLE';
import type {PeerIdentity} from '../types/Peer';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';
import {peerIdPrefix} from '../utils/id';
import {interestsToBitmask} from '../config/interests';

const TAG = 'App';

/**
 * Which verdicts are worth a permanent record. 'known' is deliberately absent: writing a
 * line every time an ordinary peer reconnects would bury the entries that matter.
 */
const VERDICT_EVENT: Partial<
  Record<IdentityAssessment['verdict'], SecurityEventKind>
> = {
  new: 'identityNew',
  renamed: 'identityRenamed',
  nameCollision: 'nameCollision',
  impersonatesVerified: 'impersonationWarning',
};

export interface PeripheralStatus {
  available: boolean;
  advertising: boolean;
  capabilities: PeripheralCapabilities | null;
  error: string | null;
}

type ServiceEvents = {
  ready: void;
  /** Held / dialling / waiting, so the UI can say "6 of 8 connected · 3 waiting". */
  links: SchedulerSnapshot;
  bluetoothState: BluetoothState;
  permission: PermissionResult;
  peripheralStatus: PeripheralStatus;
  settings: AppSettings;
  identity: PeerIdentity;
  /** A security-relevant observation was recorded. */
  securityEvent: void;
  /** An identity assessment landed for a peer, suspicious or not. */
  identityAssessed: IdentityAssessment;
};

/**
 * Composition root. Owns every layer, wires them together, and is the only thing the UI
 * is allowed to reach for.
 *
 *   UI -> BleChatService -> {MessageService, PeerManager} -> MessageRouter -> BLETransport
 *
 * React components never import a BLE module.
 */
class BleChatService {
  readonly bus = new EventBus<ServiceEvents>();

  readonly transport = new BLETransport();
  readonly peerManager: PeerManager;
  readonly router: MessageRouter;
  readonly messages: MessageService;

  private identity: PeerIdentity | null = null;
  private settings: AppSettings = {...DEFAULT_SETTINGS};
  private permission: PermissionResult = {
    state: 'unknown',
    denied: [],
    blocked: [],
  };
  private peripheralStatus: PeripheralStatus = {
    available: blePeripheral.isAvailable,
    advertising: false,
    capabilities: null,
    error: null,
  };
  /**
   * Who we hold links to, and who is queued for a slot.
   *
   * Ten simultaneous links is not a matter of calling connect ten times: the controller
   * ceiling is unpublished, and concurrent dials are themselves a cause of failure. The
   * scheduler owns both problems.
   */
  readonly scheduler: ConnectionScheduler;
  private rotateTimer: ReturnType<typeof setInterval> | null = null;

  private initialised = false;
  private seenPersistTimer: ReturnType<typeof setInterval> | null = null;
  /** How far the outbound sequence number has been persisted ahead of its current value. */
  private sequenceCeiling = 0;

  /** Totals for the whole app run, for the session dashboard. */
  readonly session = new SessionMetrics();

  /** Live encryption sessions, keyed by link. Shared with the codec and PeerManager. */
  private readonly sessions = new SessionRegistry();

  /** Security-relevant observations, persisted so they outlive a noisy session. */
  readonly securityLog = new SecurityLog();
  /** The latest assessment per peer, for the UI to warn on. */
  private readonly identityAlerts = new Map<string, IdentityAssessment>();

  constructor() {
    // One registry, two readers: PeerManager installs a cipher when a handshake
    // verifies, the codec encrypts with it. They must be the same object or every
    // packet would be refused for having no session.
    this.peerManager = new PeerManager(this.transport, this.sessions);
    this.router = new MessageRouter(
      this.transport,
      new SecurePacketCodec(this.sessions),
      this.peerManager,
      () => this.identity?.peerId ?? '',
      new SeenMessageStore(),
      new ReplayWindow(),
      new SequenceCounter(),
    );
    this.messages = new MessageService(this.router);

    this.scheduler = new ConnectionScheduler({
      hooks: {
        connect: async linkId => {
          try {
            await this.peerManager.connect(linkId);
          } catch (err) {
            // The typed reason is what tells the scheduler whether the radio was saying
            // "full" or something entirely unrelated.
            this.scheduler.onDialFailed(
              linkId,
              toLinkFailure(err, 'connecting', 'ConnectionRefused').reason,
            );
            throw err;
          }
        },
        disconnect: linkId => this.peerManager.disconnect(linkId),
        now: () => Date.now(),
      },
      onChange: () => this.bus.emit('links', this.scheduler.snapshot()),
    });
  }

  // ---- accessors --------------------------------------------------------

  getIdentity(): PeerIdentity | null {
    return this.identity;
  }
  getSettings(): AppSettings {
    return {...this.settings};
  }
  getPermission(): PermissionResult {
    return this.permission;
  }
  getPeripheralStatus(): PeripheralStatus {
    return {...this.peripheralStatus};
  }
  getBluetoothState(): BluetoothState {
    return this.transport.bluetoothState;
  }
  get isReady(): boolean {
    return this.initialised;
  }

  // ---- bootstrap --------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialised) {
      return;
    }
    logger.info(TAG, `starting on ${Platform.OS}`);

    this.settings = await storage.loadSettings();
    // No invented placeholder. A generated "Phone-671" is a name the user never chose,
    // and once it exists it leaks: into the identity record, into settings, onto the
    // air, and into the known-peers list of every phone that met this one — where it
    // sticks. An unnamed identity is simply unnamed until registration, and the app
    // already refuses to advertise or scan before then.
    this.identity = await storage.loadOrCreateIdentity(this.settings.displayName);

    if (!this.settings.displayName && this.identity.displayName) {
      // A name set on a previous run, with settings since reset: adopt it rather than
      // sending the user back through registration.
      this.settings.displayName = this.identity.displayName;
      await storage.saveSettings(this.settings);
    } else if (this.settings.displayName !== this.identity.displayName) {
      this.identity.displayName = this.settings.displayName;
      await storage.saveIdentity(this.identity);
    }

    this.bus.emit('identity', this.identity);
    this.bus.emit('settings', this.getSettings());

    this.peerManager.setIdentity(this.identity);
    this.peerManager.setAutoReconnect(this.settings.autoReconnect);
    this.messages.setIdentity(this.identity);

    // Seen ids survive restarts, so a peer retransmitting after we relaunch does not
    // produce a duplicate message.
    this.router.seen.hydrate(await storage.loadSeenIds());

    // Replay protection has to survive a restart too, or a packet captured before the
    // relaunch is accepted as new — the exact case the sliding window exists to reject.
    this.router.replay.hydrate(await storage.loadReplayWindow());

    // Resume our own counter from the reserved ceiling, never below it. Restarting below
    // where our peers last saw us would make our next messages look like replays to them.
    this.sequenceCeiling = await storage.loadSequence();
    this.router.sequence.raiseTo(this.sequenceCeiling);
    this.router.onSequenceAdvanced = seq => {
      if (seq >= this.sequenceCeiling) {
        // Reserve a block rather than writing per packet: a crash then costs unused
        // numbers, which are free, instead of correctness.
        this.sequenceCeiling = seq + SEQ_PERSIST_RESERVE;
        void storage.saveSequence(this.sequenceCeiling);
      }
    };
    await this.messages.hydrate();

    // Transport bytes -> router. This single line is the whole coupling between the BLE
    // layer and the messaging layer.
    this.transport.onData(({linkId, data}) => {
      this.router.handleInbound(linkId, data);
    });

    this.peerManager.attachRouter(this.router);
    this.messages.attach();

    // What this device can do, recomputed each handshake so the relay setting and the
    // actual negotiated MTU are reflected rather than assumed.
    this.peerManager.setCapabilitiesProvider(() => this.currentCapabilities());
    this.peerManager.setInterestsProvider(() => this.settings.interests);
    this.peerManager.setLanguagesProvider(() => this.settings.languages);
    this.peerManager.setQueuedCountProvider(peerId =>
      this.messages.queue.countFor(peerId),
    );
    this.messages.setMetricsProvider(peerId => this.peerManager.metricsFor(peerId));
    this.messages.setQueuePersistHandler(() => {
      void storage.saveOutbox(this.messages.queue.snapshot());
    });

    // Known peers: remembered across restarts so the conversation list is not empty
    // until somebody happens to be advertising.
    this.peerManager.hydrateKnownPeers(await storage.loadKnownPeers());
    this.securityLog.hydrate(await storage.loadSecurityEvents());
    this.peerManager.bus.on('peerIdentified', ({peerId, displayName}) => {
      // ORDER MATTERS: assess against what was known BEFORE this peer is remembered.
      // rememberPeer writes the incoming identity into the same list the check reads,
      // so doing it the other way round would let an impostor's own freshly-stored
      // entry explain away the clash it just created.
      void this.assessIdentity(peerId, displayName).finally(() => {
        const live = this.peerManager.getPeer(peerId);
        storage
          .rememberPeer({
            peerId,
            displayName,
            lastSeen: Date.now(),
            interests: live?.interests ?? [],
            // Carried through so the profile's history survives a restart.
            connectCount: live?.connectCount,
            firstSeen: live?.firstSeen,
            lastConnected: Date.now(),
          })
          .catch(err => logger.warn(TAG, `rememberPeer failed: ${String(err)}`));
      });
    });

    // Tell the user when a message lands while they are not looking. Presence.notifyIncoming
    // itself refuses to fire while the app is foregrounded, so this cannot produce a
    // notification for something already on screen.
    this.messages.bus.on('messageReceived', message => {
      if (message.direction !== 'incoming') {
        return;
      }
      const from =
        this.peerManager.getPeer(message.senderId)?.displayName ?? 'Someone nearby';
      void notifyIncoming({
        conversationId: message.conversationId,
        senderName: from,
        text: message.text,
        unreadCount: this.messages.unreadCounts()[message.conversationId] ?? 1,
      });
    });

    this.peerManager.bus.on('securityRefusal', refusal => {
      this.recordSecurityEvent(
        refusal.kind === 'blocked' ? 'blockedPeerAttempt' : 'authenticationFailed',
        refusal.detail,
        {
          peerId: refusal.peerId ?? undefined,
          displayName: refusal.displayName ?? undefined,
        },
      );
    });

    this.peerManager.hydrateBlockedPeers(await storage.loadBlockedPeers());
    this.peerManager.bus.on('blockedPeersChanged', ids => {
      void storage.saveBlockedPeers(ids);
    });

    this.messages.hydrateReadMarks(await storage.loadReadMarks());
    this.messages.setReadMarkPersistHandler(() => {
      void storage.saveReadMarks(this.messages.readMarks());
    });

    this.messages.groups.hydrate(await storage.loadGroups());
    this.messages.hydrateLeftGroups(await storage.loadLeftGroups());
    this.messages.setGroupPersistHandler(() => {
      void storage.saveGroups(this.messages.groups.snapshot());
      void storage.saveLeftGroups(this.messages.leftGroupIds());
    });

    this.messages.queue.hydrate(await storage.loadOutbox());
    if (this.messages.queue.total > 0) {
      logger.info(
        TAG,
        `${this.messages.queue.total} message(s) waiting in the outbox`,
      );
    }

    // A peer coming back is the trigger for delivering anything queued for it.
    this.peerManager.bus.on('peerConnected', peer => {
      if (peer.linkId) {
        this.scheduler.onConnected(peer.linkId);
      }
      if (!peer.peerId) {
        return;
      }
      this.messages.flushQueue(peer.peerId).catch(err => {
        logger.warn(TAG, `flush for ${peer.peerId} failed: ${String(err)}`);
      });
      // Re-share any group this peer belongs to, so a member that missed the original
      // invite learns about the group when it comes back.
      for (const group of this.messages.groups.all()) {
        if (group.members.includes(peer.peerId)) {
          void this.messages.inviteMembers(group);
        }
      }
    });

    // Session-wide counters, fed from real events.
    this.messages.bus.on('messageReceived', () => {
      this.session.messagesReceived += 1;
    });
    this.messages.bus.on('messageSent', () => {
      this.session.messagesSent += 1;
    });
    this.messages.bus.on('ackReceived', ({latencyMs}) => {
      this.session.recordAck(latencyMs);
    });
    // RSSI is only meaningful where we are the central and the platform reports it.
    this.peerManager.bus.on('peersChanged', peers => {
      for (const peer of peers) {
        if (peer.state === 'connected' && peer.rssi !== null) {
          this.session.recordRssi(peer.rssi);
          if (peer.peerId) {
            this.peerManager.metricsFor(peer.peerId).recordRssi(peer.rssi);
          }
        }
      }
    });
    this.transport.bus.on('txFrame', ({linkId, bytes}) => {
      this.session.bytesTx += bytes;
      const peerId = this.peerManager.peerIdForLink(linkId);
      if (peerId) {
        this.peerManager.metricsFor(peerId).recordTxFrame(bytes);
      }
    });
    this.transport.bus.on('rxFrame', ({linkId, bytes}) => {
      this.session.bytesRx += bytes;
      const peerId = this.peerManager.peerIdForLink(linkId);
      if (peerId) {
        this.peerManager.metricsFor(peerId).recordRxFrame(bytes);
      }
    });
    this.peerManager.bus.on('peerDisconnected', ({linkId}) => {
      this.session.reconnects += 1;
      // Frees the slot immediately, so somebody waiting is dialled rather than the
      // budget sitting idle until the next rotation tick.
      this.scheduler.onDisconnected(linkId);
    });

    /**
     * Auto-connect: every chat peer discovered becomes wanted.
     *
     * "Wanted" is not "connected" — the scheduler decides who actually gets a slot and
     * when, so discovering twenty peers queues twenty and dials them a few at a time
     * rather than firing twenty connects at a radio that will refuse most of them.
     */
    this.transport.onDiscovered(adv => {
      if (!adv.isChatPeer || !this.settings.autoConnect) {
        return;
      }
      // A blocked identity we have met before must not be auto-dialled just because it
      // started advertising again — the negotiate()-time check would refuse it anyway,
      // but there is no reason to spend a connection slot and a handshake finding that
      // out every time it comes back into range.
      const knownPeerId = this.peerManager.peerIdForPrefix(adv.peerIdPrefix);
      if (knownPeerId && this.peerManager.isBlocked(knownPeerId)) {
        return;
      }
      this.scheduler.want(adv.linkId);
    });

    this.scheduler.setBudget(this.settings.maxConnections);

    // Rotation only matters when there are more peers than slots.
    this.rotateTimer = setInterval(() => {
      if (this.scheduler.waiting().length > 0) {
        this.scheduler.rotate();
      }
    }, LINK_ROTATE_INTERVAL_MS);

    this.transport.bus.on('bluetoothState', state => {
      this.bus.emit('bluetoothState', state);
      if (state === 'PoweredOn') {
        void this.onBluetoothReady();
      } else {
        this.peripheralStatus = {
          ...this.peripheralStatus,
          advertising: false,
        };
        this.bus.emit('peripheralStatus', this.getPeripheralStatus());
      }
    });

    this.transport.bus.on('peripheralError', ({message}) => {
      this.peripheralStatus = {
        ...this.peripheralStatus,
        advertising: false,
        error: message,
      };
      this.bus.emit('peripheralStatus', this.getPeripheralStatus());
    });

    await this.transport.start();
    this.peerManager.start();

    this.permission = await checkBlePermissions();
    this.bus.emit('permission', this.permission);

    this.seenPersistTimer = setInterval(() => {
      void storage.saveSeenIds(this.router.seen.snapshot());
      void storage.saveReplayWindow(this.router.replay.snapshot());
    }, 30_000);

    this.initialised = true;
    this.bus.emit('ready', undefined);
    logger.info(TAG, `ready as "${this.identity.displayName}" (${this.identity.peerId})`);
  }

  /** Ask for whatever the current OS version actually needs. */
  async requestPermissions(): Promise<PermissionResult> {
    this.permission = await requestBlePermissions();
    this.bus.emit('permission', this.permission);
    if (this.permission.state === 'granted') {
      await this.onBluetoothReady();
    }
    return this.permission;
  }

  /**
   * Called whenever Bluetooth becomes usable. Brings up whichever roles the settings and
   * the hardware allow — and reports honestly when the peripheral role is unavailable
   * rather than pretending the phone is discoverable.
   */
  private async onBluetoothReady(): Promise<void> {
    if (!this.identity) {
      return;
    }
    // Nothing goes on the air until the user has a name. Advertising first would
    // introduce them to the room as "Phone-143", and every peer that met them would
    // remember that placeholder for as long as it keeps a known-peers entry.
    if (!this.settings.profileComplete) {
      logger.info(TAG, 'waiting for the profile before advertising or scanning');
      return;
    }

    if (this.permission.state !== 'granted') {
      const check = await checkBlePermissions();
      this.permission = check;
      this.bus.emit('permission', check);
      if (Platform.OS === 'android' && check.state !== 'granted') {
        logger.warn(TAG, 'Bluetooth is on but permissions are not granted yet');
        return;
      }
    }

    const capabilities = await blePeripheral.getCapabilities();
    this.peripheralStatus = {
      available: blePeripheral.isAvailable,
      advertising: false,
      capabilities,
      error: null,
    };

    if (this.settings.autoAdvertise) {
      try {
        await this.transport.startPeripheral(
          peerIdPrefix(this.identity.peerId),
          this.identity.displayName,
          interestsToBitmask(this.settings.interests),
        );
        this.peripheralStatus.advertising = true;
      } catch (err) {
        this.peripheralStatus.error =
          err instanceof Error ? err.message : String(err);
      }
    }
    this.bus.emit('peripheralStatus', this.getPeripheralStatus());

    if (this.settings.autoStartScanning) {
      try {
        await this.transport.startScanning();
      } catch (err) {
        logger.warn(TAG, `auto-scan failed: ${String(err)}`);
      }
    }
  }

  // ---- commands ---------------------------------------------------------

  async startScanning(): Promise<void> {
    if (this.permission.state !== 'granted' && Platform.OS === 'android') {
      const result = await this.requestPermissions();
      if (result.state !== 'granted') {
        throw new Error('Bluetooth permissions are required to scan');
      }
    }
    await this.transport.startScanning();
    // The radio is now doing work on the user's behalf, so hold the process in the
    // foreground. Without this Android stops the scan shortly after backgrounding, and
    // a BLE message missed while the radio was off is missed permanently — nothing is
    // holding it anywhere.
    void this.refreshPresence();
  }

  async stopScanning(): Promise<void> {
    await this.transport.stopScanning();
    void this.refreshPresence();
  }

  /**
   * Keep the foreground service in step with whether the radio is actually in use.
   *
   * Running it while nothing is happening would be a permanent notification for no
   * reason; not running it while scanning or advertising is what loses messages.
   */
  private async refreshPresence(): Promise<void> {
    const busy = this.transport.isScanning || this.peripheralStatus.advertising;
    if (busy) {
      const connected = this.peerManager
        .getPeers()
        .filter(p => p.state === 'connected').length;
      await startPresence(connected);
    } else {
      await stopPresence();
    }
  }

  async startAdvertising(): Promise<void> {
    if (!this.identity) {
      throw new Error('No identity');
    }
    await this.transport.startPeripheral(
      peerIdPrefix(this.identity.peerId),
      this.identity.displayName,
      // Packed fresh each time, so editing your interests and re-advertising is enough
      // for the room to see the change.
      interestsToBitmask(this.settings.interests),
    );
    this.peripheralStatus = {
      ...this.peripheralStatus,
      advertising: true,
      error: null,
    };
    this.bus.emit('peripheralStatus', this.getPeripheralStatus());
    void this.refreshPresence();
  }

  async stopAdvertising(): Promise<void> {
    await this.transport.stopPeripheral();
    this.peripheralStatus = {...this.peripheralStatus, advertising: false};
    this.bus.emit('peripheralStatus', this.getPeripheralStatus());
  }

  async enableBluetooth(): Promise<void> {
    await this.transport.centralApi.enableBluetooth();
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const previousName = this.settings.displayName;
    const previousComplete = this.settings.profileComplete;
    const previousInterests = this.settings.interests;
    this.settings = {...this.settings, ...patch};
    await storage.saveSettings(this.settings);

    if (this.identity && patch.displayName !== undefined) {
      this.identity.displayName = this.settings.displayName;
      await storage.saveIdentity(this.identity);
      this.bus.emit('identity', this.identity);
    }

    if (patch.autoReconnect !== undefined) {
      this.peerManager.setAutoReconnect(patch.autoReconnect);
    }

    if (patch.maxConnections !== undefined) {
      this.scheduler.setBudget(patch.maxConnections);
    }

    // Registration just finished — this is the moment the radio is allowed to start.
    if (patch.profileComplete === true && !previousComplete) {
      // Ask for notifications at the moment they start to mean something — right after
      // registration, when the radio comes up — rather than on first launch before the
      // user knows what the app does.
      void requestNotificationPermission();
      void this.onBluetoothReady();
    }

    this.bus.emit('settings', this.getSettings());

    // A changed name or interest set only reaches other phones once the advertisement is
    // rebuilt — the payload is assembled at start time, not read live.
    const profileChanged =
      (patch.displayName !== undefined && patch.displayName !== previousName) ||
      (patch.interests !== undefined &&
        interestsToBitmask(patch.interests) !== interestsToBitmask(previousInterests));

    if (profileChanged && this.peripheralStatus.advertising) {
      try {
        await this.startAdvertising();
      } catch (err) {
        logger.warn(TAG, `re-advertise after profile change failed: ${String(err)}`);
      }
    }
  }

  /**
   * Capabilities are derived, not declared: largeMtu is true only if a link actually
   * negotiated above the 23-byte default, and encryption stays false until it exists.
   */
  /**
   * How hard to scan right now.
   *
   * Continuous scanning is what the user wants while they are staring at the Nearby
   * screen, and is indefensible while the app sits in the background — the radio was
   * previously doing the former in both cases.
   */
  setScanIntensity(intensity: ScanIntensity): void {
    this.transport.setScanIntensity(intensity);
  }

  /** Radio duty-cycle figures, for the Debug screen and the exported report. */
  getScanTelemetry(): ScanTelemetry {
    return this.transport.scanTelemetry();
  }

  // ---- identity watch ---------------------------------------------------

  /** The latest assessment for a peer, or null when nothing was noticed. */
  getIdentityAlert(peerId: string): IdentityAssessment | null {
    return this.identityAlerts.get(peerId) ?? null;
  }

  /** Every peer currently carrying a warning worth showing. */
  suspiciousPeerIds(): string[] {
    return [...this.identityAlerts.entries()]
      .filter(([, a]) => isSuspicious(a.verdict))
      .map(([peerId]) => peerId);
  }

  /**
   * Compare who just identified themselves against who this phone already knows.
   *
   * The cryptography guarantees the peerId is genuinely theirs. It says nothing about
   * whether the NAME attached to it has meant somebody else until now, and that is the
   * only part of an identity the user reads — so this is where a stranger wearing a
   * contact's name gets noticed.
   */
  private async assessIdentity(peerId: string, displayName: string): Promise<void> {
    try {
      const [knownPeers, verified] = await Promise.all([
        storage.loadKnownPeers(),
        storage.loadVerifiedPeers(),
      ]);
      const known: KnownIdentity[] = knownPeers.map(k => ({
        peerId: k.peerId,
        displayName: k.displayName,
        verified: verified.includes(k.peerId),
      }));

      const assessment = assessIdentity({peerId, displayName}, known);
      this.identityAlerts.set(peerId, assessment);
      this.bus.emit('identityAssessed', assessment);

      const kind = VERDICT_EVENT[assessment.verdict];
      if (kind) {
        this.recordSecurityEvent(kind, describeAssessment(assessment), {
          peerId,
          displayName,
        });
      }
    } catch (err) {
      // A failed check must never take the handshake down with it — but it must also
      // never be mistaken for "nothing suspicious", so it is logged loudly.
      logger.error(TAG, `identity assessment failed for ${peerIdPrefix(peerId)}`, err);
    }
  }

  /** Record an observation and persist it. Deduplicated inside SecurityLog. */
  recordSecurityEvent(
    kind: SecurityEventKind,
    detail: string,
    about?: {peerId?: string; displayName?: string},
  ): void {
    const recorded = this.securityLog.record({
      kind,
      detail,
      peerId: about?.peerId,
      displayName: about?.displayName,
    });
    if (!recorded) {
      return;
    }
    this.bus.emit('securityEvent', undefined);
    void storage
      .saveSecurityEvents(this.securityLog.all())
      .catch(err => logger.warn(TAG, `security log save failed: ${String(err)}`));
  }

  private currentCapabilities(): Capabilities {
    const negotiatedLarge = this.peerManager
      .getPeers()
      .some(p => (p.gatt?.mtu ?? DEFAULT_ATT_MTU) > DEFAULT_ATT_MTU);
    return localCapabilities({
      // Hard false, not settings.relayEnabled. MessageRouter.considerForwarding decides
      // what it WOULD relay and then deliberately transmits nothing, so advertising
      // willingness to relay would tell peers something this build cannot do. A
      // capability flag is a promise to the other phone, not a preference.
      relay: false,
      largeMtu: negotiatedLarge,
    });
  }

  /**
   * Ask for a link to every chat peer currently in range.
   *
   * They are queued, not dialled at once: the scheduler serialises the attempts, which is
   * slower and far more likely to actually finish.
   */
  connectToEveryone(): number {
    let wanted = 0;
    for (const peer of this.peerManager.getPeers()) {
      if (peer.linkId && peer.state !== 'connected') {
        this.scheduler.want(peer.linkId);
        wanted += 1;
      }
    }
    logger.info(TAG, `queued ${wanted} peer(s) for connection`);
    return wanted;
  }

  getLinkStatus(): SchedulerSnapshot {
    return this.scheduler.snapshot();
  }

  /**
   * Delete this phone's identity and everything derived from it.
   *
   * There is no account, so "log out" has to mean this: the Ed25519 key IS who you are,
   * and conversations, verifications, the outbox and the at-rest key are all downstream
   * of it. Nothing is stored anywhere else, so nothing survives and nothing can be
   * restored — which is why the sheet that calls this says so twice before it does.
   *
   * The radio is stopped first, deliberately. Wiping the identity out from under a live
   * handshake would leave the other phone talking to a peer that no longer exists, and
   * the next `init` would advertise a new identity on a link opened by the old one.
   */
  async eraseIdentity(): Promise<void> {
    logger.warn(TAG, 'erasing identity and all local state');
    await this.shutdown();
    // Every key this app writes lives under the same prefix, including the wrapped
    // at-rest key and the app-lock hash — so this is the whole of it, not the parts
    // somebody remembered to list.
    await storage.clearAll();
    // Straight back up on a fresh identity rather than leaving a dead shell on screen.
    await this.init();
  }

  async shutdown(): Promise<void> {
    if (this.rotateTimer) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = null;
    }
    this.scheduler.clear();
    if (this.seenPersistTimer) {
      clearInterval(this.seenPersistTimer);
      this.seenPersistTimer = null;
    }
    await storage.saveSeenIds(this.router.seen.snapshot());
    await storage.saveReplayWindow(this.router.replay.snapshot());
    // On a clean shutdown the counter is exact, so drop the unused reservation.
    await storage.saveSequence(this.router.sequence.current);
    await storage.saveOutbox(this.messages.queue.snapshot());
    await storage.saveGroups(this.messages.groups.snapshot());
    this.messages.dispose();
    this.peerManager.dispose();
    await this.transport.stop();
    this.initialised = false;
  }
}

export const bleChat = new BleChatService();
export type {PermissionState};
