import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import {radius, spacing, typography, tintsFor, type Theme} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {bleChat} from '../services/BleChatService';
import {copyDebugReport, shareDebugReport} from '../services/DebugReport';
import {useAppStore} from '../state/appStore';
import {formatTime, logger, type LogLevel} from '../utils/logger';
import {shortId} from '../utils/id';
import {clearCrash, loadCrash, type CrashRecord} from '../utils/crashLog';
import {describeFailure} from '../ble/LinkErrors';
import {AppText, DenseText} from '../components/AppText';
import {FadeIn, Touchable} from '../components/Motion';
import {Icon} from '../components/ui/Icon';
import {Screen} from '../components/ui/Screen';
import {
  InfoTile,
  LeaderRow,
  PeerAvatar,
  Section,
  SignalBars,
  StatCard,
  StatusPill,
} from '../components/ui/Primitives';
import {InfoDot, InfoDotHint} from '../components/ui/InfoDot';
import {formatBytes, formatDuration} from '../peers/LinkMetrics';
import {CAPABILITY_KEYS} from '../messaging/Negotiation';
import {
  BLE_RX_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_CHAR_UUID,
} from '../config/constants';
import type {Peer} from '../types/Peer';
import type {RootStackScreenProps} from '../navigation/types';
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
type DebugTab = 'link' | 'traffic' | 'logs';

const DEBUG_TABS: Array<{key: DebugTab; label: string}> = [
  {key: 'link', label: 'Link'},
  {key: 'traffic', label: 'Traffic'},
  {key: 'logs', label: 'Logs'},
];

export function DebugScreen({navigation}: RootStackScreenProps<'Debug'>) {
  const styles = useStyles();
  const theme = useTheme();
  /**
   * The crash that closed the app last time, if there was one.
   *
   * Sits at the top of Logs because it is the one thing on this screen that explains an
   * event the user has already lived through and could not otherwise report.
   */
  const [crash, setCrash] = useState<CrashRecord | null>(null);
  useEffect(() => {
    void loadCrash().then(setCrash);
  }, []);
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

  /**
   * Eight equally-weighted sections in one scroll became three tabs.
   *
   * Every section is still here and still says the same thing; they were simply never
   * all wanted at once. Someone diagnosing a dropped link needs the peer, GATT and the
   * radio; someone chasing a lost message needs packet counters. Stacking both meant
   * scrolling past one to reach the other, every time.
   */
  const [tab, setTab] = useState<DebugTab>('link');

  // The peer worth showing at the top: connected first, else the most recently seen.
  const primary = useMemo(() => {
    const connected = peers.find(p => p.state === 'connected');
    return connected ?? peers[0] ?? null;
  }, [peers]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Who this phone is, which build it is running and how many links are live —
            the three things every bug report needs, as one line rather than a card and
            a section apiece. */}
        <View style={styles.brandRow}>
          {/* Diagnostics is reached from You now rather than being a tab, so it needs
              its own way back — hardware back works, but a screen with no visible exit
              reads as somewhere you are stuck. */}
          <Touchable
            scale={false}
            onPress={() =>
              // Popping is only right when there is something to pop. If Diagnostics is
              // the only screen on the stack — which happens when the app is reopened
              // straight onto it — goBack leaves BLE Chat altogether and drops the
              // reader back in the hub, which is not what a back arrow inside a screen
              // should ever do.
              navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs')
            }
            hitSlop={10}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Icon name="chevronLeft" color={theme.text} size={20} />
          </Touchable>
          <View style={styles.flex}>
            <AppText style={styles.brand}>Diagnostics</AppText>
            <DenseText style={styles.brandMeta} numberOfLines={1}>
              {(identity?.displayName || 'No name set') +
                // Just the date half of the build label: the full string, and its
                // notes, are one tab away under Logs, and a subtitle that ellipsises
                // has told you nothing.
                ' \u00b7 build ' +
                BUILD_LABEL.split(' \u00b7 ')[0] +
                ' \u00b7 ' +
                peers.filter(p => p.state === 'connected').length +
                ' live link' +
                (peers.filter(p => p.state === 'connected').length === 1 ? '' : 's')}
            </DenseText>
          </View>
          <Touchable
            scale={false}
            style={styles.exportButton}
            onPress={onCopy}
            accessibilityLabel="Copy diagnostics">
            <Icon name="copy" color={theme.text} size={16} />
          </Touchable>
          <Touchable
            scale={false}
            style={styles.exportButton}
            onPress={onExport}
            accessibilityLabel="Share diagnostics">
            <Icon name="share" color={theme.text} size={16} />
          </Touchable>
        </View>

        <View style={styles.tabs}>
          {DEBUG_TABS.map(option => {
            const active = option.key === tab;
            return (
              <Touchable
                key={option.key}
                scale={false}
                onPress={() => setTab(option.key)}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                style={active ? [styles.tab, styles.tabActive] : styles.tab}>
                <AppText
                  style={active ? styles.tabTextActive : styles.tabText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.1}>
                  {option.label}
                </AppText>
              </Touchable>
            );
          })}
        </View>

        {tab === 'link' && primary ? (
          <DenseText style={styles.connectedPeerLabel}>CONNECTED PEER</DenseText>
        ) : null}
        {tab !== 'link' ? null : primary ? (
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
        {tab === 'link' ? (

          <FadeIn key={tab + '-0'} index={0}>
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
          </FadeIn>
        ) : null}
        {tab === 'logs' ? (

          <FadeIn key={tab + '-1'} index={1}>
            <Section
              title="Build"
              icon="code"
              right={<InfoDot title="Build" body={HELP.Build} />}>
              {/* Which APK is actually running. Without this, a fixed bug reported again
                  from an older build is indistinguishable from a bug that was never fixed. */}
              <LeaderRow label="Build" value={BUILD_LABEL} />
              <DenseText style={styles.dim}>{BUILD_NOTES}</DenseText>
            </Section>
          </FadeIn>
        ) : null}
        {tab === 'link' ? (

          <FadeIn key={tab + '-2'} index={2}>
            <Section
              title="Radio"
              icon="broadcast"
              right={<InfoDotHint title="Radio" body={HELP.Radio} />}>
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
              {/* What the radio can actually do, as reported by the capability probe.
                  Advertising failures on Android are usually one of these three rather
                  than anything the app did, so they are worth stating outright. */}
              {peripheral.capabilities ? (
                <>
                  <LeaderRow
                    label="Hardware advertiser"
                    value={peripheral.capabilities.hasAdvertiser ? 'Yes' : 'No'}
                  />
                  <LeaderRow
                    label="Multi-advertisement"
                    value={
                      peripheral.capabilities.supportsMultipleAdvertisement ? 'Yes' : 'No'
                    }
                  />
                  {peripheral.capabilities.missingPermissions.length > 0 && (
                    <LeaderRow
                      label="Missing permissions"
                      value={peripheral.capabilities.missingPermissions.join(', ')}
                    />
                  )}
                </>
              ) : (
                <LeaderRow label="Capability probe" value="Not run yet" />
              )}
              {peripheral.error && (
                <LeaderRow label="Peripheral error" value={peripheral.error} />
              )}
            </Section>
          </FadeIn>
        ) : null}
        {tab === 'traffic' ? (

          <FadeIn key={tab + '-3'} index={3}>
            <Section
              title="Session"
              icon="chart"
              right={<InfoDot title="Session" body={HELP.Session} />}>
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
          </FadeIn>
        ) : null}
        {tab === 'traffic' ? (

          <FadeIn key={tab + '-4'} index={4}>
            <Section
              title="Packets"
              glyph="◫"
              right={<InfoDot title="Packets" body={HELP.Packets} />}>
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
          </FadeIn>
        ) : null}
        {tab === 'traffic' ? (

          <FadeIn key={tab + '-5'} index={5}>
            <Section
              title="Last Packet"
              glyph="▤"
              right={<InfoDot title="Last Packet" body={HELP['Last Packet']} />}>
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
          </FadeIn>
        ) : null}
        {tab === 'link' ? (

          <FadeIn key={tab + '-6'} index={6}>
            <Section
              title="GATT"
              glyph="⌬"
              right={<InfoDot title="GATT" body={HELP.GATT} />}>
              <LeaderRow label="Service" value={tail(BLE_SERVICE_UUID)} mono />
              <LeaderRow label="RX char" value={tail(BLE_RX_CHAR_UUID)} mono />
              <LeaderRow label="TX char" value={tail(BLE_TX_CHAR_UUID)} mono />
            </Section>
          </FadeIn>
        ) : null}

        {tab === 'link' && peers.length > 1 ? (
            <FadeIn key={tab + '-7'} index={7}>
            <Section
                title={'All peers (' + peers.length + ')'}
                glyph="⁙"
                right={<InfoDot title="All peers" body={HELP['All peers']} />}>
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
          </FadeIn>
        ) : null}

        {tab === 'logs' && crash ? (
          <FadeIn key={tab + '-crash'} index={0}>
            <Section title="Last crash" icon="alert">
              <LeaderRow
                label="When"
                value={`${new Date(crash.at).toLocaleString()} (${
                  crash.kind === 'render' ? 'while drawing a screen' : 'fatal'
                })`}
              />
              <DenseText style={styles.crashMessage} selectable>
                {crash.message}
              </DenseText>
              {crash.stack ? (
                <DenseText style={styles.crashStack} selectable>
                  {crash.stack}
                </DenseText>
              ) : null}
              <View style={styles.filterRow}>
                <TouchableOpacity
                  style={styles.filterChip}
                  onPress={() => {
                    void clearCrash().then(() => setCrash(null));
                  }}>
                  <DenseText style={styles.filterText}>clear</DenseText>
                </TouchableOpacity>
              </View>
            </Section>
          </FadeIn>
        ) : null}

        {tab === 'logs' ? (

          <FadeIn key={tab + '-8'} index={8}>
            <Section
              title={'Logs (' + visibleLogs.length + ')'}
              glyph="≡"
              right={<InfoDot title="Logs" body={HELP.Logs} />}>
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
          </FadeIn>
        ) : null}
      </ScrollView>
    </Screen>
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

/**
 * What each section means, in plain English.
 *
 * Written for somebody who did not build the transport. Every entry names the terms in
 * the order they appear on screen and says what a good value looks like where there is
 * one — a number with no sense of "is that bad?" is not much better than no number.
 */
const HELP: Record<string, string> = {
  Radio:
    'The Bluetooth radio itself.\n\nAdapter — whether Bluetooth is on. Nothing works until this says PoweredOn.\n\nPermission — Android needs scan and connect permission before the app may look for anyone. Denied lists any it did not get.\n\nRadio duty — scanning constantly would flatten the battery, so the app scans in bursts and rests between them. This is the share of time it is actually sweeping.\n\nStart budget — Android limits how often an app may restart a scan, five times in thirty seconds. This is what is left before it makes you wait.\n\nAdvertising — whether this phone is broadcasting so others can find it. Discovery needs one side scanning and the other advertising.\n\nThis device — the short id other phones see in your advertisement.',
  Session:
    'Totals since the app was launched. Closing it resets them.\n\nBytes TX / RX — sent and received, across every link.\n\nAvg ACK — how long a message takes to be acknowledged by the other phone. Tens of milliseconds is healthy; hundreds means the link is struggling.\n\nAvg RSSI — average signal strength in dBm. It is negative, and closer to zero is stronger: −50 is very close, −90 is at the edge of range.\n\nReconnects — links that dropped and came back. A steadily climbing number means an unstable connection rather than a broken one.\n\nQueued (outbox) — messages written but not yet delivered, waiting for the peer to come back in range.',
  Packets:
    'Every message is split into packets, and each one is counted.\n\nTX / RX — packets sent and received.\n\nACK — receipts confirming the other side got one. This should track TX closely.\n\nFailed — could not be delivered, usually because the link went away mid-send.\n\nDupes — arrived more than once. Normal in small numbers: the sender retries when an ACK is slow, and the receiver discards the copy.\n\nDropped — discarded before processing, typically malformed or too large.\n\nReplayed — an old packet seen again, refused by the replay window. That is a security control doing its job, not an error.\n\nSpoofed — failed its signature check, meaning it did not come from who it claimed. Anything other than zero here is worth investigating.',
  GATT:
    'Settings the two phones negotiated for this link when it opened.\n\nMTU — the largest chunk that fits in one packet, in bytes. It starts at 23 and both sides try to raise it, up to 517. Higher means fewer packets for the same message, so a bigger number is faster.\n\nThe rest are capabilities each side advertised. They are shown so a link that behaves oddly can be compared against one that does not.',
  'Last Packet':
    'The most recent packet in either direction, decoded.\n\nDirection — whether this phone sent or received it.\n\nPacket ID — its unique id, shortened. Used to match a send here against a receive on the other phone.\n\nType — what it carries: a message, an acknowledgement, a handshake step, a keep-alive.\n\nOrigin — who first sent it, which is not always who you received it from.',
  Build:
    'Which build is running.\n\nUseful in a bug report: the same symptom on two different builds is usually two different problems.',
  'Device Details':
    'This phone, and what the app was able to learn about it.\n\nBluetooth support varies more between Android devices than almost anything else, so when something works on one phone and not another, the answer is often here.',
  'All peers':
    'Every device seen this session, including ones that are gone or were never connectable.\n\nNearby shows only what you can act on; this shows everything the radio heard, which is what you want when somebody is missing from that list.',
  Logs:
    'What the app did, newest first.\n\nFilter by level to separate routine activity from problems. This is the thing to copy into a bug report — it says what happened in order, which a screenshot of a number cannot.',
};

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  content: {padding: spacing.lg, paddingBottom: spacing.xl},

  flex: {flex: 1},
  backButton: {paddingRight: spacing.sm, paddingVertical: 4},
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 14,
  },
  brand: {fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: t.text},
  brandMeta: {...typography.caption, color: t.textDim, marginTop: 2},

  tabs: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: t.surfaceAlt,
    borderRadius: 12,
    padding: 3,
    marginBottom: 18,
  },
  tab: {flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9},
  // A raised chip, not a tint: the selected tab should look like it is on top of the
  // track rather than a differently-coloured part of it.
  tabActive: {
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOpacity: t.isDark ? 0.3 : 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  tabText: {...typography.callout, color: t.textDim, fontWeight: '600'},
  tabTextActive: {...typography.callout, color: t.text, fontWeight: '700'},

  exportButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Selectable and monospaced: this text exists to be read carefully and copied out.
  crashMessage: {
    fontSize: 12.5,
    fontFamily: 'monospace',
    color: t.error,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  crashStack: {
    fontSize: 10.5,
    fontFamily: 'monospace',
    color: t.textDim,
    marginTop: spacing.sm,
    lineHeight: 14,
  },
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
