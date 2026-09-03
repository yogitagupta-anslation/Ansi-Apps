import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {radius, spacing, typography, tintsFor, type Theme} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {bleChat} from '../services/BleChatService';
import {copyDebugReport, shareDebugReport} from '../services/DebugReport';
import {useAppStore} from '../state/appStore';
import {formatTime, logger, type LogLevel} from '../utils/logger';
import {shortId} from '../utils/id';
import {describeFailure} from '../ble/LinkErrors';
import {AppText, DenseText} from '../components/AppText';
import {Touchable} from '../components/Motion';
import {Icon} from '../components/ui/Icon';
import {
  InfoTile,
  LeaderRow,
  PeerAvatar,
  Section,
  SignalBars,
  StatCard,
  StatusPill,
} from '../components/ui/Primitives';
import {formatBytes, formatDuration} from '../peers/LinkMetrics';
import {CAPABILITY_KEYS} from '../messaging/Negotiation';
import {
  BLE_RX_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_CHAR_UUID,
} from '../config/constants';
import type {Peer} from '../types/Peer';
import {BUILD_LABEL, BUILD_NOTES} from '../config/build';

function levelColor(level: LogLevel, t: Theme): string {
  switch (level) {
    case 'warn':
      return t.warn;
    case 'error':
      return t.error;
    case 'debug':
      return t.textDim;
    default:
      return t.text;
  }
}

/**
 * Every value on this screen is read from the live transport, router or platform.
 * If something here says "Connected" or "Notifications: Yes", the BLE stack said so.
 */
export function DebugScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const tints = tintsFor(theme);
  const bluetoothState = useAppStore(s => s.bluetoothState);
  const permission = useAppStore(s => s.permission);
  const peripheral = useAppStore(s => s.peripheral);
  const scanning = useAppStore(s => s.scanning);
  // Sampled on the same tick as everything else on this screen. Duty cycling can only
  // be validated against numbers — "the battery seems better" is not evidence.
  const [scanTelemetry, setScanTelemetry] = useState(() =>
    bleChat.getScanTelemetry(),
  );
  useEffect(() => {
    const id = setInterval(() => setScanTelemetry(bleChat.getScanTelemetry()), 1000);
    return () => clearInterval(id);
  }, []);
  const peers = useAppStore(s => s.peers);
  const counters = useAppStore(s => s.counters);
  const lastPacket = useAppStore(s => s.lastPacket);
  const logs = useAppStore(s => s.logs);
  const identity = useAppStore(s => s.identity);
  const session = useAppStore(s => s.session);
  const queuedTotal = useAppStore(s => s.queuedTotal);

  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [showDetails, setShowDetails] = useState(true);

  const visibleLogs = useMemo(() => {
    const filtered =
      levelFilter === 'all' ? logs : logs.filter(l => l.level === levelFilter);
    // Newest first so the most recent BLE event is visible without scrolling.
    return filtered.slice(-200).reverse();
  }, [logs, levelFilter]);

  const onExport = useCallback(() => {
    shareDebugReport().catch(err =>
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err)),
    );
  }, []);

  const onCopy = useCallback(() => {
    try {
      const report = copyDebugReport();
      Alert.alert(
        'Copied',
        `${report.length} characters on the clipboard. ` +
          'Nothing was sent anywhere.',
      );
    } catch (err) {
      Alert.alert('Copy failed', err instanceof Error ? err.message : String(err));
    }
  }, []);

  // The peer worth showing at the top: connected first, else the most recently seen.
  const primary = useMemo(() => {
    const connected = peers.find(p => p.state === 'connected');
    return connected ?? peers[0] ?? null;
  }, [peers]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brandRow}>
          <AppText style={styles.brand}>
            <DenseText style={styles.brandAccent}>BLE</DenseText>Chat
          </AppText>
          <Touchable scale={false} style={styles.exportButton} onPress={onCopy}>
            <Icon name="copy" color={theme.text} size={14} />
            <DenseText style={styles.exportText}>Copy</DenseText>
          </Touchable>
          <Touchable scale={false} style={styles.exportButton} onPress={onExport}>
            <Icon name="share" color={theme.text} size={14} />
            <DenseText style={styles.exportText}>Share</DenseText>
          </Touchable>
        </View>

        {/*
          The very first bold name on this screen used to be whichever peer we're
          connected to — easy to mistake for your own identity, especially mid-chat.
          "This device" now says whose name that PeerSummary card below is NOT.
        */}
        <View style={styles.thisDeviceCard}>
          <View style={[styles.emptyPeerIcon, {backgroundColor: theme.tilePurple}]}>
            <Icon name="device" color={theme.tilePurpleFg} size={20} />
          </View>
          <View style={styles.emptyPeerText}>
            <DenseText style={styles.thisDeviceLabel}>THIS DEVICE</DenseText>
            <AppText style={styles.thisDeviceName} numberOfLines={1}>
              {identity?.displayName || 'No name set'}
            </AppText>
          </View>
        </View>

        {primary && (
          <DenseText style={styles.connectedPeerLabel}>CONNECTED PEER</DenseText>
        )}
        {primary ? (
          <PeerSummary peer={primary} />
        ) : (
          <View style={styles.emptyPeer}>
            <View style={styles.emptyPeerIcon}>
              <Icon name="bluetooth" color={theme.tileBlueFg} size={20} />
            </View>
            <View style={styles.emptyPeerText}>
              <AppText style={styles.emptyPeerTitle}>No peers observed yet.</AppText>
              <DenseText style={styles.dim}>
                Bluetooth is {bluetoothState}
                {scanning ? ', scanning...' : ', not scanning.'}
              </DenseText>
            </View>
            <View style={styles.emptyPeerDots}>
              {[0, 1, 2].map(i => (
                <View
                  key={i}
                  style={[
                    styles.emptyPeerDot,
                    {backgroundColor: i === 0 ? theme.tileBlueFg : theme.border},
                  ]}
                />
              ))}
            </View>
          </View>
        )}

        <Section
          title="Device Details"
          icon="device"
          right={
            <Touchable
              scale={false}
              onPress={() => setShowDetails(v => !v)}
              hitSlop={12}
              accessibilityLabel={showDetails ? 'Hide device details' : 'Show device details'}
              style={showDetails ? styles.chevronFlipped : undefined}>
              <Icon name="chevronDown" color={theme.textDim} size={16} />
            </Touchable>
          }>
          {showDetails && primary && <PeerDetailGrid peer={primary} />}
          {showDetails && !primary && (
            <DenseText style={styles.dim}>
              Nothing to show until a peer appears.
            </DenseText>
          )}
        </Section>

        <Section title="Build" icon="code">
          {/* Which APK is actually running. Without this, a fixed bug reported again
              from an older build is indistinguishable from a bug that was never fixed. */}
          <LeaderRow label="Build" value={BUILD_LABEL} />
          <DenseText style={styles.dim}>{BUILD_NOTES}</DenseText>
        </Section>

        <Section title="Radio" icon="broadcast">
          <View style={styles.grid}>
            <InfoTile label="Adapter" value={bluetoothState} icon="device" />
            <InfoTile
              label="Permission"
              value={permission.state}
              valueColor={permission.state === 'granted' ? theme.ok : theme.warn}
              icon="shield"
            />
            <InfoTile
              label="Radio duty"
              value={
                scanning
                  ? `${scanTelemetry.dutyPercent.toFixed(0)}% · ${scanTelemetry.intensity}`
                  : 'idle'
              }
            />
            <InfoTile
              label="Scan bursts"
              value={
                scanning
                  ? `${scanTelemetry.burstCount} · ${Math.round(
                      scanTelemetry.radioOnMs / 1000,
                    )}s on / ${Math.round(scanTelemetry.elapsedMs / 1000)}s`
                  : '—'
              }
            />
            <InfoTile
              label="Start budget"
              value={
                scanning ? `${scanTelemetry.startsRemaining} left` : '—'
              }
              valueColor={
                scanning && scanTelemetry.startsRemaining === 0
                  ? theme.warn
                  : undefined
              }
            />
            <InfoTile
              label="Scanning"
              value={scanning ? 'Yes' : 'No'}
              check
              valueColor={scanning ? theme.ok : theme.textDim}
              icon="clock"
            />
            <InfoTile
              label="Advertising"
              value={peripheral.advertising ? 'Yes' : 'No'}
              check
              valueColor={peripheral.advertising ? theme.ok : theme.textDim}
              icon="broadcast"
            />
            <InfoTile
              label="Peripheral module"
              value={peripheral.available ? 'Linked' : 'NOT LINKED'}
              valueColor={peripheral.available ? theme.ok : theme.error}
              icon="link"
            />
            <InfoTile
              label="This device"
              value={identity?.displayName || '(none)'}
              icon="device"
            />
          </View>
          {permission.denied.length > 0 && (
            <LeaderRow label="Denied" value={permission.denied.join(', ')} />
          )}
          {peripheral.error && (
            <LeaderRow label="Peripheral error" value={peripheral.error} />
          )}
        </Section>

        <Section title="Session" icon="chart">
          <LeaderRow
            label="Duration"
            value={formatDuration(session.durationMs)}
            mono
            icon="clock"
          />
          <LeaderRow
            label="Messages sent"
            value={String(session.messagesSent)}
            mono
            icon="share"
          />
          <LeaderRow
            label="Messages received"
            value={String(session.messagesReceived)}
            mono
            icon="inbox"
          />
          <LeaderRow label="Bytes TX" value={formatBytes(session.bytesTx)} mono icon="share" />
          <LeaderRow label="Bytes RX" value={formatBytes(session.bytesRx)} mono icon="inbox" />
          <LeaderRow
            label="Avg ACK"
            value={
              session.avgAckLatencyMs !== null
                ? Math.round(session.avgAckLatencyMs) + ' ms'
                : 'no samples'
            }
            mono
            icon="check"
          />
          <LeaderRow
            label="Avg RSSI"
            value={
              session.avgRssi !== null
                ? Math.round(session.avgRssi) + ' dBm'
                : 'no samples'
            }
            mono
            icon="radar"
          />
          <LeaderRow
            label="Reconnects"
            value={String(session.reconnects)}
            mono
            icon="link"
          />
          <LeaderRow
            label="Queued (outbox)"
            value={String(queuedTotal)}
            mono
            icon="mail"
          />
        </Section>

        <Section title="Packets" glyph="◫">
          <View style={styles.statGrid}>
            <StatCard glyph="↑" value={counters.tx} label="TX" tint={tints.tx} />
            <StatCard glyph="↓" value={counters.rx} label="RX" tint={tints.rx} />
            <StatCard glyph="✓" value={counters.ack} label="ACK" tint={tints.ack} />
            <StatCard
              glyph="✕"
              value={counters.failed}
              label="Failed"
              tint={tints.failed}
            />
            <StatCard
              glyph="⧉"
              value={counters.duplicates}
              label="Dupes"
              tint={tints.dupes}
            />
            <StatCard
              glyph="⊘"
              value={counters.dropped}
              label="Dropped"
              tint={tints.dropped}
            />
            {/*
              Kept separate from Dropped on purpose. A dropped packet usually means the
              link is having a bad time; these two mean a peer sent something it should
              not have, and burying them in a general total would hide that.
            */}
            <StatCard
              glyph="↺"
              value={counters.replayed}
              label="Replayed"
              tint={tints.rejected}
            />
            <StatCard
              glyph="⚠"
              value={counters.spoofed}
              label="Spoofed"
              tint={tints.rejected}
            />
          </View>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => bleChat.router.resetCounters()}>
            <DenseText style={styles.resetText}>◌  Reset Counters</DenseText>
          </TouchableOpacity>
        </Section>

        <Section title="Last Packet" glyph="▤">
          {lastPacket ? (
            <>
              <LeaderRow
                label="Direction"
                value={lastPacket.direction.toUpperCase()}
                badge
              />
              <LeaderRow label="Packet ID" value={shortId(lastPacket.packet.id)} mono />
              <LeaderRow label="Type" value={lastPacket.packet.type} mono />
              <LeaderRow label="Origin" value={shortId(lastPacket.packet.originId)} mono />
              <LeaderRow label="Sender" value={shortId(lastPacket.packet.senderId)} mono />
              <LeaderRow
                label="Destination"
                value={
                  lastPacket.packet.destinationId
                    ? shortId(lastPacket.packet.destinationId)
                    : '(link-local)'
                }
                mono
              />
              <LeaderRow label="TTL" value={String(lastPacket.packet.ttl)} mono />
              <LeaderRow label="Hops" value={String(lastPacket.packet.hopCount)} mono />
              <LeaderRow
                label="Timestamp"
                value={formatTime(lastPacket.packet.timestamp)}
                mono
              />
              <LeaderRow label="Link" value={lastPacket.linkId} mono />
            </>
          ) : (
            <DenseText style={styles.dim}>No packets yet.</DenseText>
          )}
        </Section>

        <Section title="GATT" glyph="⌬">
          <LeaderRow label="Service" value={tail(BLE_SERVICE_UUID)} mono />
          <LeaderRow label="RX char" value={tail(BLE_RX_CHAR_UUID)} mono />
          <LeaderRow label="TX char" value={tail(BLE_TX_CHAR_UUID)} mono />
        </Section>

        {peers.length > 1 && (
          <Section title={'All peers (' + peers.length + ')'} glyph="⁙">
            {peers.map(peer => (
              <View
                key={peer.peerId ?? peer.linkId ?? String(peer.firstSeen)}
                style={styles.peerRow}>
                <DenseText style={styles.peerName} numberOfLines={1}>
                  {peer.displayName ?? 'unnamed'}
                </DenseText>
                <StatusPill
                  label={peer.state}
                  tone={
                    peer.state === 'connected'
                      ? theme.ok
                      : peer.state === 'failed'
                      ? theme.error
                      : theme.warn
                  }
                />
              </View>
            ))}
          </Section>
        )}

        <Section title={'Logs (' + visibleLogs.length + ')'} glyph="≡">
          <View style={styles.filterRow}>
            {(['all', 'info', 'warn', 'error', 'debug'] as const).map(level => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.filterChip,
                  levelFilter === level && styles.filterChipActive,
                ]}
                onPress={() => setLevelFilter(level)}>
                <DenseText
                  style={[
                    styles.filterText,
                    levelFilter === level && styles.filterTextActive,
                  ]}>
                  {level}
                </DenseText>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.filterChip} onPress={() => logger.clear()}>
              <DenseText style={styles.filterText}>clear</DenseText>
            </TouchableOpacity>
          </View>

          {visibleLogs.map(entry => (
            <View key={entry.id} style={styles.logRow}>
              <DenseText style={styles.logTime}>{formatTime(entry.timestamp)}</DenseText>
              <DenseText
                style={[styles.logText, {color: levelColor(entry.level, theme)}]}
                selectable>
                [{entry.tag}] {entry.message}
              </DenseText>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Header card: who we are talking to, and how well. */
function PeerSummary({peer}: {peer: Peer}) {
  const styles = useStyles();
  const theme = useTheme();
  const connected = peer.state === 'connected';
  return (
    <View style={styles.summary}>
      <PeerAvatar size={46} muted={!connected} />
      <View style={styles.summaryText}>
        <View style={styles.summaryTop}>
          <AppText style={styles.summaryName} numberOfLines={1}>
            {peer.displayName ?? 'unnamed peer'}
          </AppText>
          <StatusPill
            label={connected ? 'Connected' : peer.state}
            tone={
              connected
                ? theme.ok
                : peer.state === 'failed'
                ? theme.error
                : theme.warn
            }
          />
        </View>
        <DenseText style={styles.summaryMeta} numberOfLines={1}>
          {peer.gatt ? 'MTU ' + peer.gatt.mtu : 'no GATT'}
          {peer.rssi !== null ? '  ·  ' + peer.rssi + ' dBm' : ''}
        </DenseText>
      </View>
      <SignalBars rssi={peer.rssi} />
    </View>
  );
}

/**
 * What actually happened on this link, in order.
 *
 * "Connection failed" is unactionable on its own. Whether the attempt got as far as
 * discovering services, negotiating an MTU or shaking hands is the difference between a
 * peer out of range, a peer running the wrong build, and a handshake being rejected.
 */
function ConnectionTimeline({linkId}: {linkId: string | null}) {
  const styles = useStyles();
  const theme = useTheme();
  // Read through rather than mirrored into the store: it changes on every phase of every
  // attempt, and only this screen ever looks at it.
  const events = bleChat.peerManager.historyFor(linkId);
  if (events.length === 0) {
    return null;
  }
  return (
    <View style={styles.timeline}>
      <DenseText style={styles.timelineTitle}>Connection history</DenseText>
      {events.slice(-12).map((event, index) => (
        <View key={`${event.at}-${index}`} style={styles.timelineRow}>
          <DenseText style={styles.timelineTime}>
            {formatTime(event.at)}
          </DenseText>
          <DenseText
            style={[
              styles.timelineLabel,
              event.tone === 'ok' && {color: theme.ok},
              event.tone === 'error' && {color: theme.error},
            ]}
            numberOfLines={1}>
            {event.label}
          </DenseText>
          {event.detail ? (
            <DenseText style={styles.timelineDetail} numberOfLines={1}>
              {event.detail}
            </DenseText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function PeerDetailGrid({peer}: {peer: Peer}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <>
      <View style={styles.grid}>
        <InfoTile label="Peer ID" value={peer.peerId ?? '(pre-handshake)'} mono />
        <InfoTile label="Advertising Prefix" value={peer.peerIdPrefix ?? '-'} mono />
        <InfoTile label="Address (Link)" value={peer.linkId ?? '-'} mono />
        <InfoTile
          label="Protocol"
          value={peer.protocolVersion !== null ? 'v' + peer.protocolVersion : '-'}
        />
        <InfoTile
          label="RSSI"
          value={
            peer.rssi !== null
              ? peer.rssi + ' dBm'
              : peer.role === 'peripheral'
              ? 'n/a (peripheral)'
              : '-'
          }
          valueColor={peer.rssi !== null ? theme.ok : undefined}
        />
        <InfoTile label="Role" value={peer.role ?? '-'} />
        <InfoTile
          label="Link quality"
          value={
            peer.metrics?.quality !== null && peer.metrics?.quality !== undefined
              ? peer.metrics.quality + '%'
              : 'measuring...'
          }
          valueColor={qualityColor(peer.metrics?.quality ?? null, theme)}
        />
        <InfoTile label="Queued" value={String(peer.queuedCount)} />
      </View>

      {/*
        Attempts vs successes vs failures. A peer that connects on the third try every
        time looks identical to a healthy one in a snapshot — this is what tells them
        apart, and what turns "it feels flaky" into a number.
      */}
      <View style={[styles.grid, styles.gridSpaced]}>
        <InfoTile label="Attempts" value={String(peer.attempts)} />
        <InfoTile
          label="Successful"
          value={String(peer.connectCount)}
          valueColor={theme.ok}
        />
        <InfoTile
          label="Failed"
          value={String(peer.failures)}
          valueColor={peer.failures > 0 ? theme.error : undefined}
        />
      </View>

      <ConnectionTimeline linkId={peer.linkId} />

      {peer.agreedCapabilities && (
        <View style={[styles.grid, styles.gridSpaced]}>
          {CAPABILITY_KEYS.map(key => (
            <InfoTile
              key={key}
              label={key}
              value={peer.agreedCapabilities![key] ? 'Yes' : 'No'}
              check
              valueColor={
                peer.agreedCapabilities![key] ? theme.ok : theme.textDim
              }
            />
          ))}
        </View>
      )}

      {peer.compatibilityNote && (
        <DenseText style={styles.compatNote}>{peer.compatibilityNote}</DenseText>
      )}

      {peer.metrics && (
        <View style={[styles.grid, styles.gridSpaced]}>
          <InfoTile
            label="Uptime"
            value={formatDuration(peer.metrics.currentUptimeMs)}
          />
          <InfoTile
            label="Avg ACK"
            value={
              peer.metrics.avgAckLatencyMs !== null
                ? Math.round(peer.metrics.avgAckLatencyMs) + ' ms'
                : '-'
            }
          />
          <InfoTile
            label="Loss"
            value={(peer.metrics.lossRate * 100).toFixed(1) + '%'}
            valueColor={peer.metrics.lossRate > 0 ? theme.warn : theme.ok}
          />
          <InfoTile
            label="Bytes"
            value={
              formatBytes(peer.metrics.bytesTx) +
              ' / ' +
              formatBytes(peer.metrics.bytesRx)
            }
          />
        </View>
      )}

      {peer.gatt && (
        <View style={[styles.grid, styles.gridSpaced]}>
          <InfoTile
            label="Service Found"
            value={yn(peer.gatt.serviceFound)}
            check
            valueColor={peer.gatt.serviceFound ? theme.ok : theme.error}
          />
          <InfoTile
            label="RX Char Found"
            value={yn(peer.gatt.rxCharacteristicFound)}
            check
            valueColor={peer.gatt.rxCharacteristicFound ? theme.ok : theme.error}
          />
          <InfoTile
            label="TX Char Found"
            value={yn(peer.gatt.txCharacteristicFound)}
            check
            valueColor={peer.gatt.txCharacteristicFound ? theme.ok : theme.error}
          />
          <InfoTile
            label="Notifications"
            value={yn(peer.gatt.notificationsEnabled)}
            check
            valueColor={peer.gatt.notificationsEnabled ? theme.ok : theme.error}
          />
          <InfoTile label="MTU" value={String(peer.gatt.mtu)} />
          <InfoTile label="Connects" value={String(peer.connectCount)} />
        </View>
      )}

      {peer.failure && (
        <View style={styles.failureBox}>
          <DenseText style={styles.failureTitle}>
            {describeFailure(peer.failure)}
          </DenseText>
          <DenseText style={styles.failureDetail}>
            {peer.failure.reason} during {peer.failure.phase}
          </DenseText>
          <DenseText style={styles.failureDetail} numberOfLines={3}>
            {peer.failure.message}
          </DenseText>
        </View>
      )}
    </>
  );
}

/** Colour bands for the derived score. Null means not enough evidence yet. */
function qualityColor(quality: number | null, t: Theme): string | undefined {
  if (quality === null) {
    return undefined;
  }
  if (quality >= 80) {
    return t.ok;
  }
  if (quality >= 50) {
    return t.warn;
  }
  return t.error;
}

function yn(v: boolean): string {
  return v ? 'Yes' : 'No';
}

/** UUIDs share a long suffix; the leading block is what distinguishes them. */
function tail(uuid: string): string {
  return uuid.slice(0, 8) + '…' + uuid.slice(-4);
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  content: {padding: spacing.lg, paddingBottom: spacing.xl},

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  brand: {...typography.display, color: t.text, flexShrink: 1},
  brandAccent: {color: t.accent},
  // Outlined rather than filled. Two solid accent buttons at the top of a diagnostics
  // screen out-shout the diagnostics.
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  exportText: {...typography.caption, color: t.text, fontWeight: '600'},

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  summaryText: {flex: 1},
  summaryTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  summaryName: {...typography.headline, color: t.text, flexShrink: 1},
  summaryMeta: {...typography.caption, color: t.textDim, marginTop: 2},
  thisDeviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.tilePurpleFg + '44',
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  thisDeviceLabel: {...typography.overline, color: t.tilePurpleFg, fontSize: 10},
  thisDeviceName: {...typography.headline, color: t.text, marginTop: 1},
  connectedPeerLabel: {
    ...typography.overline,
    color: t.textDim,
    fontSize: 10,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  emptyPeer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  emptyPeerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.tileBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPeerText: {flex: 1},
  emptyPeerTitle: {...typography.headline, color: t.text},
  emptyPeerDots: {flexDirection: 'row', gap: 4},
  emptyPeerDot: {width: 6, height: 6, borderRadius: 3},

  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  gridSpaced: {marginTop: spacing.sm},
  statGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},

  chevronFlipped: {transform: [{rotate: '180deg'}]},
  dim: {...typography.caption, color: t.textDim, lineHeight: 17},

  resetButton: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  resetText: {...typography.callout, color: t.textDim, fontWeight: '600'},

  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  peerName: {...typography.callout, color: t.text, flexShrink: 1},

  failureBox: {
    marginTop: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: t.error,
    paddingLeft: spacing.md,
  },
  timeline: {marginTop: spacing.md},
  timelineTitle: {...typography.overline, color: t.textDim, marginBottom: spacing.sm},
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 3,
  },
  // Monospaced and fixed-width so the times form a column the eye can run down, which
  // is the whole point of showing a sequence.
  timelineTime: {
    ...typography.caption,
    color: t.textDim,
    fontFamily: 'monospace',
    fontSize: 11,
    width: 62,
  },
  timelineLabel: {...typography.caption, color: t.text, fontWeight: '600'},
  timelineDetail: {...typography.caption, color: t.textDim, flexShrink: 1},
  compatNote: {
    ...typography.caption,
    color: t.warn,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  failureTitle: {...typography.caption, color: t.error, fontWeight: '700'},
  failureDetail: {...typography.caption, color: t.textDim, marginTop: 1},

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  filterChipActive: {backgroundColor: t.accent, borderColor: t.accent},
  filterText: {...typography.caption, color: t.textDim},
  filterTextActive: {color: t.onAccent, fontWeight: '600'},

  logRow: {flexDirection: 'row', gap: spacing.sm, paddingVertical: 2},
  logTime: {
    ...typography.caption,
    color: t.textDim,
    fontSize: 10,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  logText: {flex: 1, fontSize: 11, fontFamily: 'monospace', lineHeight: 15},
}));
