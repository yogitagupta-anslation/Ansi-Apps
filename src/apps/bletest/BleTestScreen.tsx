/**
 * The BLE test screen.
 *
 * One phone presses Start Advertising, the other presses Start Scanning, taps
 * Connect on what it finds, then Send HELLO. If HELLO_RESPONSE comes back, real
 * GATT works between two real phones and everything else can be built on it.
 *
 * Deliberately plain: no design system, no shared components, no theme. This is
 * a diagnostic, and it must not fail — or appear to pass — for any reason that
 * lives outside the BLE stack it is measuring.
 *
 * Every status light reflects something observed. "Connected" means a link the
 * central actually opened, and the received list holds bytes that actually
 * arrived. Nothing here is optimistic.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { State } from 'react-native-ble-plx';

import { BleTestCentral, type CentralStatus } from './BleTestCentral';
import { bleTestLog, type BleTestEntry } from './BleTestLog';
import { BleTestPeripheral, makeLocalName, type PeripheralStatus } from './BleTestPeripheral';
import {
  hasBleTestPermissions,
  requestBleTestPermissions,
  requiredPermissionNames,
} from './BleTestPermissions';
import { TEST_SERVICE_UUID } from './BleTestProfile';

const INK = '#0b1220';
const PANEL = '#151d2e';
const LINE = '#26304a';
const TEXT = '#e8edf7';
const MUTED = '#93a0bd';
const GOOD = '#3ddc97';
const BAD = '#ff6b6b';
const STEP = '#7aa2ff';

export function BleTestScreen(): React.ReactElement {
  const peripheral = useRef<BleTestPeripheral | null>(null);
  const central = useRef<BleTestCentral | null>(null);
  if (!peripheral.current) peripheral.current = new BleTestPeripheral();
  if (!central.current) central.current = new BleTestCentral();

  const localName = useMemo(() => makeLocalName(), []);

  const [permitted, setPermitted] = useState(false);
  const [bluetooth, setBluetooth] = useState<State | 'Unknown'>('Unknown');
  const [peripheralStatus, setPeripheralStatus] = useState<PeripheralStatus>({
    serverUp: false,
    advertising: false,
    subscribedCentrals: [],
  });
  const [centralStatus, setCentralStatus] = useState<CentralStatus>({
    scanning: false,
    connectedTo: null,
    devices: [],
    received: [],
  });
  const [entries, setEntries] = useState<BleTestEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const offP = peripheral.current!.subscribe(setPeripheralStatus);
    const offC = central.current!.subscribe(setCentralStatus);
    const offL = bleTestLog.subscribe(setEntries);
    return () => {
      offP();
      offC();
      offL();
    };
  }, []);

  useEffect(() => {
    void hasBleTestPermissions().then(setPermitted);
    void central
      .current!.bluetoothState()
      .then(setBluetooth)
      .catch(() => setBluetooth('Unknown'));
  }, []);

  useEffect(
    () => () => {
      peripheral.current?.dispose();
      central.current?.dispose();
    },
    [],
  );

  /** Run an action, surfacing a failure instead of letting it vanish. */
  const run = useCallback(async (label: string, action: () => Promise<void> | void) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      // Already logged as a failure by the layer that threw; this only makes
      // sure a rejected promise never disappears silently.
      bleTestLog.step(`${label} did not complete`, error instanceof Error ? error.message : error);
    } finally {
      setBusy(null);
    }
  }, []);

  const grant = useCallback(async () => {
    const outcome = await requestBleTestPermissions();
    setPermitted(outcome.granted);
  }, []);

  const firstFailure = bleTestLog.firstFailure();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>BLE GATT test</Text>
        <Text style={styles.subtitle}>
          {`Android-only proof that two phones can open a real GATT link.\nService ${TEST_SERVICE_UUID}`}
        </Text>

        {/* ---------------------------------------------------- status */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Status</Text>
          <Row label="Bluetooth" value={bluetooth === State.PoweredOn ? 'available' : String(bluetooth)} good={bluetooth === State.PoweredOn} />
          <Row label="Permissions" value={permitted ? 'granted' : 'missing'} good={permitted} />
          <Row label="GATT server" value={peripheralStatus.serverUp ? 'ON' : 'OFF'} good={peripheralStatus.serverUp} />
          <Row label="Advertising" value={peripheralStatus.advertising ? 'ON' : 'OFF'} good={peripheralStatus.advertising} />
          <Row label="Scanning" value={centralStatus.scanning ? 'ON' : 'OFF'} good={centralStatus.scanning} />
          <Row label="Connected" value={centralStatus.connectedTo ? 'YES' : 'NO'} good={Boolean(centralStatus.connectedTo)} />
          <Row label="Subscribed centrals" value={String(peripheralStatus.subscribedCentrals.length)} good={peripheralStatus.subscribedCentrals.length > 0} />
          <Text style={styles.note}>{`This phone advertises as ${localName}`}</Text>
        </View>

        {Platform.OS !== 'android' ? (
          <View style={styles.panel}>
            <Text style={[styles.panelTitle, { color: BAD }]}>Android only</Text>
            <Text style={styles.note}>
              This test targets Android first on purpose. iOS is not implemented yet.
            </Text>
          </View>
        ) : null}

        {!permitted ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Permissions needed</Text>
            <Text style={styles.note}>{requiredPermissionNames().join('\n')}</Text>
            <Text style={styles.note}>
              Location must also be switched on in system settings, or scanning returns nothing with
              no error.
            </Text>
            <Button label="Grant permissions" onPress={() => void grant()} />
          </View>
        ) : null}

        {/* ---------------------------------------------------- peripheral */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Phone A — peripheral</Text>
          <View style={styles.buttonRow}>
            <Button
              label="Start Advertising"
              disabled={!permitted || peripheralStatus.advertising || busy !== null}
              onPress={() => void run('Start Advertising', () => peripheral.current!.start(localName))}
            />
            <Button
              label="Stop Advertising"
              variant="secondary"
              disabled={!peripheralStatus.advertising || busy !== null}
              onPress={() => void run('Stop Advertising', () => peripheral.current!.stop())}
            />
          </View>
        </View>

        {/* ---------------------------------------------------- central */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Phone B — central</Text>
          <View style={styles.buttonRow}>
            <Button
              label="Start Scanning"
              disabled={!permitted || centralStatus.scanning || busy !== null}
              onPress={() => void run('Start Scanning', () => central.current!.startScan())}
            />
            <Button
              label="Stop Scanning"
              variant="secondary"
              disabled={!centralStatus.scanning || busy !== null}
              onPress={() => central.current!.stopScan()}
            />
          </View>

          <Text style={styles.sectionLabel}>Nearby devices</Text>
          {centralStatus.devices.length === 0 ? (
            <Text style={styles.note}>
              {centralStatus.scanning
                ? 'Scanning. Nothing carrying the test service yet.'
                : 'Not scanning.'}
            </Text>
          ) : (
            centralStatus.devices.map((device) => (
              <View key={device.id} style={styles.device}>
                <View style={styles.deviceText}>
                  <Text style={styles.deviceName}>{device.name ?? '(no name)'}</Text>
                  <Text style={styles.note}>{device.id}</Text>
                  <Text style={styles.note}>
                    {device.rssi === null ? 'Service detected' : `Service detected · RSSI ${device.rssi}`}
                  </Text>
                </View>
                <Button
                  label={centralStatus.connectedTo === device.id ? 'Connected' : 'Connect'}
                  disabled={centralStatus.connectedTo === device.id || busy !== null}
                  onPress={() => void run('Connect', () => central.current!.connect(device.id))}
                />
              </View>
            ))
          )}
        </View>

        {/* ---------------------------------------------------- traffic */}
        {centralStatus.connectedTo ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{`Connected to ${centralStatus.connectedTo}`}</Text>
            <View style={styles.buttonRow}>
              <Button
                label="Send HELLO"
                disabled={busy !== null}
                onPress={() => void run('Send HELLO', () => central.current!.sendHello())}
              />
              <Button
                label="Disconnect"
                variant="secondary"
                disabled={busy !== null}
                onPress={() => void run('Disconnect', () => central.current!.disconnect())}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Received messages</Text>
          {centralStatus.received.length === 0 ? (
            <Text style={styles.note}>Nothing received yet.</Text>
          ) : (
            centralStatus.received.map((message, index) => (
              <Text key={`${message}-${index}`} style={styles.received}>
                {message}
              </Text>
            ))
          )}
        </View>

        {/* ---------------------------------------------------- log */}
        <View style={styles.panel}>
          <View style={styles.logHeader}>
            <Text style={styles.panelTitle}>Log</Text>
            <Button label="Clear" variant="secondary" onPress={() => bleTestLog.clear()} />
          </View>

          {firstFailure ? (
            <View style={styles.failureBox}>
              <Text style={styles.failureTitle}>First failure</Text>
              <Text style={styles.failureText}>
                {firstFailure.detail
                  ? `${firstFailure.message} — ${firstFailure.detail}`
                  : firstFailure.message}
              </Text>
            </View>
          ) : null}

          {entries.length === 0 ? (
            <Text style={styles.note}>Nothing logged yet.</Text>
          ) : (
            entries.map((entry) => (
              <Text
                key={entry.id}
                style={[
                  styles.logLine,
                  { color: entry.level === 'fail' ? BAD : entry.level === 'ok' ? GOOD : STEP },
                ]}
              >
                {entry.detail ? `${entry.message} — ${entry.detail}` : entry.message}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, good }: { label: string; value: string; good: boolean }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: good ? GOOD : MUTED }]}>{value}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}): React.ReactElement {
  const background: ColorValue = variant === 'primary' ? '#2b5fd9' : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: background, borderColor: variant === 'primary' ? '#2b5fd9' : LINE },
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: INK, flex: 1 },
  content: { gap: 12, padding: 16, paddingBottom: 48 },
  title: { color: TEXT, fontSize: 24, fontWeight: '700' },
  subtitle: { color: MUTED, fontSize: 12, lineHeight: 18 },
  panel: {
    backgroundColor: PANEL,
    borderColor: LINE,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  panelTitle: { color: TEXT, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: MUTED, fontSize: 13 },
  rowValue: { fontSize: 13, fontWeight: '700' },
  note: { color: MUTED, fontSize: 12, lineHeight: 17 },
  sectionLabel: { color: TEXT, fontSize: 13, fontWeight: '600', marginTop: 6 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: TEXT, fontSize: 13, fontWeight: '600' },
  device: {
    alignItems: 'center',
    borderColor: LINE,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  deviceText: { flex: 1, gap: 2 },
  deviceName: { color: TEXT, fontSize: 14, fontWeight: '600' },
  received: { color: GOOD, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', fontSize: 13 },
  logHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  logLine: { fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', fontSize: 11, lineHeight: 16 },
  failureBox: { borderColor: BAD, borderRadius: 8, borderWidth: 1, gap: 4, padding: 10 },
  failureTitle: { color: BAD, fontSize: 12, fontWeight: '700' },
  failureText: { color: TEXT, fontSize: 12, lineHeight: 17 },
});
