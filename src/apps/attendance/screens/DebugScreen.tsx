/**
 * DebugScreen.tsx
 * -----------------------------------------------------------------------------
 * Real BLE diagnostics. Every number here is a counter incremented by the
 * running scanner, and every log line was emitted by code that actually ran.
 * Nothing on this screen is generated for display.
 *
 * The rejection counters are the useful part: they distinguish "the radio is
 * dead" from "the radio works but nothing matches", which are completely
 * different problems with completely different fixes.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { View } from 'react-native';
import { BluetoothStatusBadge, useReadiness } from '../components/BluetoothStatus';
import { LogView } from '../components/LogView';
import { SignalBars } from '../components/ProximityIndicator';
import {
  Banner,
  Card,
  DataRow,
  Screen,
  SectionHeader,
  Txt,
} from '../components/ui';
import { EmptyState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';
import { formatClockTime } from '../constants/appConfig';
import { MANUFACTURER_ID, SERVICE_UUID_128, SERVICE_UUID_16_FULL } from '../constants/bluetoothConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function DebugScreen() {
  const t = useTheme();
  const store = useAppStore();
  const role = store.settings.role ?? 'HOST';
  const { readiness } = useReadiness(role);

  const stats = store.scan.statistics;
  const scanning = store.scan.scanning;

  return (
    <Screen>
      <SectionHeader
        title="BLE diagnostics"
        right={<BluetoothStatusBadge readiness={readiness} />}
      />

      {/* ------------------------------------------------------ state -- */}
      <Card>
        <DataRow
          label="Bluetooth state"
          value={readiness?.bluetooth.state ?? '—'}
          valueColor={readiness?.bluetooth.ready ? t.colors.success : t.colors.warning}
        />
        <DataRow
          label="Scan state"
          value={scanning ? 'Active' : 'Stopped'}
          valueColor={scanning ? t.colors.success : t.colors.textMuted}
        />
        <DataRow
          label="Advertising state"
          value={store.advertiser.advertising ? 'Active' : 'Stopped'}
          valueColor={store.advertiser.advertising ? t.colors.success : t.colors.textMuted}
        />
        <DataRow label="Role" value={role} />
        <DataRow label="Service UUID (16-bit)" value={SERVICE_UUID_16_FULL} />
        <DataRow label="Service UUID (128-bit)" value={SERVICE_UUID_128} />
        <DataRow label="Company ID" value={'0x' + MANUFACTURER_ID.toString(16).toUpperCase()} />
        <DataRow
          label="Peripheral capable"
          value={readiness?.capabilities.advertisingSupported ? 'yes' : 'no'}
        />
        <DataRow
          label="Max advertising bytes"
          value={String(readiness?.capabilities.maxAdvertisingDataLength ?? '—')}
        />
      </Card>

      {/* ------------------------------------------------ statistics -- */}
      <SectionHeader title="Scan statistics" subtitle="Since the scan started" />
      <Card>
        <DataRow label="Advertisements received" value={String(stats.advertisementsReceived)} />
        <DataRow
          label="Known employees detected"
          value={String(stats.knownEmployeesDetected)}
          valueColor={t.colors.success}
        />
        <DataRow
          label="Attendance marked today"
          value={String(stats.attendanceMarkedToday)}
          valueColor={t.colors.success}
        />
        <DataRow label="Rejected — not our app" value={String(stats.rejectedUnknownDevices)} />
        <DataRow
          label="Rejected — unregistered ID"
          value={String(stats.rejectedUnknownEmployees)}
          valueColor={stats.rejectedUnknownEmployees > 0 ? t.colors.warning : undefined}
        />
        <DataRow label="Rejected — weak signal" value={String(stats.rejectedWeakSignals)} />
        <DataRow
          label="Rejected — malformed payload"
          value={String(stats.rejectedMalformed)}
          valueColor={stats.rejectedMalformed > 0 ? t.colors.error : undefined}
        />
      </Card>

      {scanning && stats.advertisementsReceived === 0 ? (
        <Banner
          tone="warning"
          title="Scanning but receiving nothing"
          detail={
            'Zero advertisements have arrived. The usual causes are Location services off, ' +
            'a missing permission, or Android scan throttling after more than 5 scan starts ' +
            'in 30 seconds. Check the log below.'
          }
        />
      ) : null}

      {stats.rejectedUnknownEmployees > 0 ? (
        <Banner
          tone="info"
          title="Unregistered employee IDs seen"
          detail={
            'An advertisement from this app arrived with an ID that is not in the registry. ' +
            'Check that the employee phone uses exactly the same ID you registered.'
          }
        />
      ) : null}

      {/* -------------------------------------------------- detected -- */}
      <SectionHeader
        title="Detected advertisements"
        subtitle={store.scan.detected.length + ' matching this app'}
      />

      {store.scan.detected.length === 0 ? (
        <Card>
          <EmptyState
            icon="search"
            title="Nothing detected"
            message={
              scanning
                ? 'No advertisements matching this application have been received.'
                : 'Start scanning from the Home tab.'
            }
          />
        </Card>
      ) : (
        store.scan.detected.map(d => (
          <Card key={d.employeeId}>
            <View style={{ alignItems: 'center', flexDirection: 'row' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" mono>
                  {d.employeeId}
                </Txt>
                <Txt variant="caption" color={t.colors.textMuted}>
                  {d.employee?.displayName ?? 'unregistered'}
                </Txt>
              </View>
              <SignalBars rssi={d.smoothedRssi} />
              <Txt variant="caption" mono color={t.colors.textSecondary} style={{ marginLeft: 8 } as object}>
                {d.smoothedRssi} dBm
              </Txt>
            </View>

            <View style={{ marginTop: 10 }}>
              <DataRow label="raw / smoothed" value={d.rssi + ' / ' + d.smoothedRssi + ' dBm'} />
              <DataRow label="nearby streak" value={String(d.consecutiveNearbyReadings)} />
              <DataRow label="advertisements" value={String(d.advertisementCount)} />
              <DataRow label="last seen" value={formatClockTime(d.lastSeenAt)} />
              <DataRow label="device address" value={d.deviceId} />
            </View>

            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <StatusBadge
                label={d.isNearby ? 'Nearby' : 'Too far'}
                tone={d.isNearby ? 'success' : 'warning'}
              />
            </View>
          </Card>
        ))
      )}

      <Txt variant="caption" color={t.colors.textMuted} style={{ marginBottom: 12, lineHeight: 18 } as object}>
        Device addresses rotate roughly every 15 minutes — Android uses a resolvable private
        address for privacy. That is why employees are tracked by the advertised ID, never by
        address.
      </Txt>

      {/* ------------------------------------------------------- log -- */}
      <SectionHeader title="Live log" />
      <LogView maxHeight={340} />
    </Screen>
  );
}
