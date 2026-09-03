/**
 * Host discovery for players.
 *
 * Wraps the central transport with the bookkeeping the lobby UI needs: a live,
 * de-duplicated, freshness-pruned list of nearby hosts sorted by signal.
 *
 * On RSSI: it orders the list so the host you are sitting next to appears
 * first. It is never used for game logic. Virtual treasure proximity comes from
 * virtual (x, y) coordinates only.
 */
import {SCAN} from '../config/bleConfig';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import type {DiscoveredHost} from './BleTypes';
import type {CentralTransport} from './transport/Transport';

const log = createLogger('BleScanner');

export interface BleScannerEvents {
  hostsChanged: DiscoveredHost[];
  scanStarted: void;
  scanStopped: void;
}

export class BleScanner {
  readonly events = new Emitter<BleScannerEvents>();

  private hosts = new Map<string, DiscoveredHost>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(private readonly transport: CentralTransport) {}

  get isScanning(): boolean {
    return this.scanning;
  }

  async start(): Promise<void> {
    if (this.scanning) {
      return;
    }
    this.hosts.clear();
    this.scanning = true;
    this.events.emit('scanStarted', undefined);
    this.emitHosts();

    const onHost = (host: DiscoveredHost) => {
      this.hosts.set(host.deviceId, host);
      this.emitHosts();
    };

    await this.transport.startScan(onHost);

    /*
     * Keep the platform scan alive for as long as we say we are scanning.
     *
     * The transport stops itself after SCAN.timeoutMs, and nothing used to
     * restart it: the join list quietly emptied out -- every host aged out of
     * the prune below -- while the screen still read "Scanning for games
     * nearby...". Re-issuing the scan also re-reports hosts on platforms that
     * ignore allowDuplicates, which is what keeps them from being pruned.
     */
    this.refreshTimer = setInterval(() => {
      void this.refresh(onHost);
    }, SCAN.refreshMs);

    this.pruneTimer = setInterval(() => this.prune(), SCAN.staleHostMs / 2);
    log.info('scanning for hosts');
  }

  /**
   * Restart the underlying scan without disturbing the host list.
   *
   * Discovered hosts deliberately survive the sweep; they age out through
   * prune() instead, so the list does not flicker every refresh.
   */
  private async refresh(onHost: (host: DiscoveredHost) => void): Promise<void> {
    if (!this.scanning) {
      return;
    }
    try {
      await this.transport.stopScan();
      await this.transport.startScan(onHost);
      log.debug('scan refreshed');
    } catch (err) {
      log.warn('scan refresh failed', err);
    }
  }

  async stop(): Promise<void> {
    if (!this.scanning) {
      return;
    }
    this.scanning = false;
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    await this.transport.stopScan();
    this.events.emit('scanStopped', undefined);
    log.info('scan stopped');
  }

  /** Drop hosts whose advertisement has gone quiet. */
  private prune(): void {
    const cutoff = Date.now() - SCAN.staleHostMs;
    let changed = false;
    for (const [id, host] of this.hosts) {
      if (host.lastSeenAt < cutoff) {
        this.hosts.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.emitHosts();
    }
  }

  getHosts(): DiscoveredHost[] {
    // Strongest signal first; unknown RSSI sinks to the bottom.
    return Array.from(this.hosts.values()).sort(
      (a, b) => (b.rssi ?? -999) - (a.rssi ?? -999),
    );
  }

  findByGameCode(gameCode: string): DiscoveredHost | undefined {
    return this.getHosts().find(host => host.gameCode === gameCode);
  }

  private emitHosts(): void {
    this.events.emit('hostsChanged', this.getHosts());
  }

  dispose(): void {
    void this.stop();
    this.hosts.clear();
    this.events.removeAllListeners();
  }
}
