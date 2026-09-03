import {Clipboard, Platform, Share} from 'react-native';
import {
  BLE_RX_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_CHAR_UUID,
  PROTOCOL_VERSION,
} from '../config/constants';
import {describeFailure} from '../ble/LinkErrors';
import {bleChat} from './BleChatService';
import type {Peer} from '../types/Peer';
import {formatTime, logger} from '../utils/logger';
import {relativeTime} from '../utils/time';
import {BUILD_LABEL} from '../config/build';

/**
 * Builds a complete, self-contained test report.
 *
 * Physical BLE testing means two phones and two people, and the failure is usually on the
 * phone you are not holding. A plain-text report that can be shared straight out of the
 * app is the difference between "it didn't work" and an actual diagnosis.
 *
 * Everything here is read from live state — nothing is invented or defaulted.
 */
export function buildDebugReport(): string {
  const lines: string[] = [];
  const now = Date.now();

  const identity = bleChat.getIdentity();
  const permission = bleChat.getPermission();
  const peripheral = bleChat.getPeripheralStatus();
  const counters = bleChat.router.getCounters();
  const peers = bleChat.peerManager.getPeers();
  const settings = bleChat.getSettings();

  const h = (title: string) => {
    lines.push('');
    lines.push('=== ' + title + ' ===');
  };
  const kv = (k: string, v: unknown) => lines.push(pad(k) + String(v));

  lines.push('BLE CHAT — DEBUG REPORT');
  lines.push('Generated: ' + new Date(now).toISOString());
  // First thing in the report: which build produced it. A report from an older APK
  // otherwise looks identical to one from the current build.
  lines.push('Build: ' + BUILD_LABEL);

  h('DEVICE');
  kv('Platform', Platform.OS);
  kv('OS version', String(Platform.Version));
  if (Platform.OS === 'android') {
    const c = Platform.constants as {Model?: string; Manufacturer?: string};
    kv('Manufacturer', c?.Manufacturer ?? 'unknown');
    kv('Model', c?.Model ?? 'unknown');
  }
  kv('App protocol version', PROTOCOL_VERSION);

  h('IDENTITY');
  kv('Display name', identity?.displayName ?? '-');
  kv('Peer ID', identity?.peerId ?? '-');

  h('BLUETOOTH');
  kv('Adapter state', bleChat.getBluetoothState());
  kv('Permission state', permission.state);
  kv('Denied', permission.denied.length ? permission.denied.join(', ') : 'none');
  kv('Blocked', permission.blocked.length ? permission.blocked.join(', ') : 'none');
  kv('Scanning', bleChat.transport.isScanning ? 'yes' : 'no');
  kv('Advertising', peripheral.advertising ? 'yes' : 'no');

  h('PERIPHERAL CAPABILITY');
  kv('Native module linked', peripheral.available ? 'yes' : 'NO');
  if (peripheral.capabilities) {
    const c = peripheral.capabilities;
    kv('Has Bluetooth', c.hasBluetooth ? 'yes' : 'no');
    kv('Bluetooth enabled', c.bluetoothEnabled ? 'yes' : 'no');
    kv('Hardware advertiser', c.hasAdvertiser ? 'yes' : 'NO');
    kv('Multi-advertisement', c.supportsMultipleAdvertisement ? 'yes' : 'no');
    kv('SDK int', c.sdkInt);
    kv(
      'Missing permissions',
      c.missingPermissions.length ? c.missingPermissions.join(', ') : 'none',
    );
  } else {
    kv('Capabilities', 'not probed yet');
  }
  if (peripheral.error) {
    kv('Peripheral error', peripheral.error);
  }

  h('GATT');
  kv('Service', BLE_SERVICE_UUID);
  kv('RX characteristic', BLE_RX_CHAR_UUID);
  kv('TX characteristic', BLE_TX_CHAR_UUID);

  h('SETTINGS');
  kv('Auto scan', settings.autoStartScanning);
  kv('Auto advertise', settings.autoAdvertise);
  kv('Auto reconnect', settings.autoReconnect);
  // Not settings.relayEnabled: relaying is unimplemented and the capability is hard
  // false on the wire, so reporting the stored preference would misdescribe the build.
  kv('Relay', 'not implemented (Phase 2)');

  // Radio pacing, so a battery or discovery-reliability report carries the numbers
  // rather than an impression.
  const scan = bleChat.getScanTelemetry();
  h('SCAN DUTY CYCLE');
  kv('Intensity', scan.intensity);
  kv('Duty', `${scan.dutyPercent.toFixed(1)}%`);
  kv('Radio on', `${Math.round(scan.radioOnMs / 1000)}s`);
  kv('Elapsed', `${Math.round(scan.elapsedMs / 1000)}s`);
  kv('Bursts', scan.burstCount);
  kv('Start budget left', scan.startsRemaining);

  h('PACKET COUNTERS');
  kv('TX', counters.tx);
  kv('RX', counters.rx);
  kv('ACK', counters.ack);
  kv('Failed', counters.failed);
  kv('Duplicates', counters.duplicates);
  kv('Dropped', counters.dropped);
  kv('Replayed', counters.replayed);
  kv('Spoofed sender', counters.spoofed);
  kv('Seen-ID cache', bleChat.router.seen.size);

  h('PEERS (' + peers.length + ')');
  if (peers.length === 0) {
    lines.push('  none observed');
  }
  for (const peer of peers) {
    lines.push('');
    lines.push('  ' + (peer.displayName ?? 'unnamed') + '  [' + peer.state + ']');
    peerLines(peer, now).forEach(l => lines.push('  ' + l));
  }

  h('LOG');
  const entries = logger.getEntries();
  if (entries.length === 0) {
    lines.push('  (empty)');
  }
  for (const entry of entries) {
    lines.push(
      formatTime(entry.timestamp) +
        ' ' +
        entry.level.toUpperCase().padEnd(5) +
        ' [' +
        entry.tag +
        '] ' +
        entry.message,
    );
  }

  lines.push('');
  lines.push('--- end of report (' + entries.length + ' log entries) ---');
  return lines.join('\n');
}

function peerLines(peer: Peer, now: number): string[] {
  const out: string[] = [];
  const kv = (k: string, v: unknown) => out.push(pad(k, 22) + String(v));

  kv('Peer ID', peer.peerId ?? '(pre-handshake)');
  kv('Advertised prefix', peer.peerIdPrefix ?? '-');
  kv('Link', peer.linkId ?? '-');
  kv('Role', peer.role ?? '-');
  kv('RSSI', peer.rssi !== null ? peer.rssi + ' dBm' : '-');
  kv('Protocol version', peer.protocolVersion ?? '-');
  kv('Relay capable', peer.capabilities ? peer.capabilities.relay : '-');
  kv('First seen', relativeTime(peer.firstSeen, now));
  kv('Last seen', relativeTime(peer.lastSeen, now));
  kv('Successful connects', peer.connectCount);

  if (peer.gatt) {
    kv('Service found', peer.gatt.serviceFound);
    kv('RX char found', peer.gatt.rxCharacteristicFound);
    kv('TX char found', peer.gatt.txCharacteristicFound);
    kv('Notifications', peer.gatt.notificationsEnabled);
    kv('MTU', peer.gatt.mtu);
  } else {
    kv('GATT', 'not established');
  }

  if (peer.failure) {
    kv('FAILURE', peer.failure.reason);
    kv('Failed during', peer.failure.phase);
    kv('Explanation', describeFailure(peer.failure));
    kv('Detail', peer.failure.message);
    kv('Failed at', formatTime(peer.failure.timestamp));
  }

  // Attempt bookkeeping and the timeline are the two things that make a device-specific
  // problem diagnosable from a pasted report rather than only over someone's shoulder.
  kv('Attempts', peer.attempts);
  kv('Successful', peer.connectCount);
  kv('Failed attempts', peer.failures);

  const history = bleChat.peerManager.historyFor(peer.linkId);
  if (history.length > 0) {
    out.push('  -- connection history --');
    for (const event of history.slice(-20)) {
      out.push(
        '  ' +
          formatTime(event.at) +
          '  ' +
          event.label +
          (event.detail ? '  (' + event.detail + ')' : ''),
      );
    }
  }
  return out;
}

function pad(key: string, width = 24): string {
  return (key + ':').padEnd(width, ' ');
}

/**
 * Hand the report to the OS share sheet, so it can go to email, chat, notes or a file.
 * Sharing is user-initiated and the report never leaves the device on its own.
 */
export async function shareDebugReport(): Promise<void> {
  const report = buildDebugReport();
  await Share.share({
    title: 'BLE Chat debug report',
    message: report,
  });
}

/**
 * Put the report on the clipboard.
 *
 * Kept alongside sharing rather than replacing it: the share sheet is right for sending a
 * report somewhere, and the clipboard is right for pasting it into a message you are
 * already writing. Neither sends anything anywhere on its own.
 */
export function copyDebugReport(): string {
  const report = buildDebugReport();
  Clipboard.setString(report);
  return report;
}
