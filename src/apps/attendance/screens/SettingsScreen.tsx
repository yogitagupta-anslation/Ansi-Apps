/**
 * SettingsScreen.tsx
 * -----------------------------------------------------------------------------
 * Grouped settings, organised by what the user is trying to change rather than
 * by which subsystem owns it.
 *
 * Every control is wired to real behaviour — there are no decorative toggles.
 * Changing the detection threshold changes what counts as nearby on the very
 * next advertisement.
 *
 * NO ROLE SWITCHING. The device role is fixed at first install. The only escape
 * hatch is a developer reset compiled out of release builds via __DEV__.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { openLocationSettings, requestEnableBluetooth } from '../bluetooth/BleAdvertiser';
import { Icon } from '../components/Icon';
import { SettingGroup, SettingRow } from '../components/SettingRow';
import { Button, Screen, Txt } from '../components/ui';
import { APP_VERSION } from '../constants/appConfig';
import { CONFIG_BOUNDS } from '../constants/proximityConfig';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAppStore } from '../state/appStore';
import { clearAllLocalData } from '../storage/AppStorage';
import { EmployeeStatusStore } from '../attendance/EmployeeStatusStore';
import { AttendanceStorage } from '../storage/AttendanceStorage';
import { EmployeeStorage } from '../storage/EmployeeStorage';
import { useTheme } from '../theme/ThemeContext';

export function SettingsScreen({ onOpenDebug }: { onOpenDebug: () => void }) {
  const navigation = useNavigation<{
    navigate: (s: string) => void;
    canGoBack: () => boolean;
    goBack: () => void;
  }>();
  const t = useTheme();
  /**
   * The employee reaches Settings by a push from Profile, so it needs a back
   * chevron. The Host's Settings is a TAB ROOT and has nowhere to go.
   *
   * canGoBack() cannot tell them apart: it walks the whole navigation tree and
   * answers true on the Host tab too, because the hub sits behind the app. The
   * route name is the honest signal — 'SettingsMain' is the Host's tab root,
   * 'Settings' is the copy ProfileStack pushes.
   */
  const canGoBack = useRoute().name === 'Settings' && navigation.canGoBack();

  const store = useAppStore();
  const role = store.settings.role ?? 'HOST';
  const isHost = role === 'HOST';
  const readiness = store.readiness;

  const [stats, setStats] = useState<{ employees: number; records: number; days: number } | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tuningOpen, setTuningOpen] = useState(false);

  const loadStats = useCallback(async () => {
    const [employees, records, days] = await Promise.all([
      EmployeeStorage.count(),
      AttendanceStorage.totalCount(),
      AttendanceStorage.getDaySummaries(9999),
    ]);
    setStats({ employees, records, days: days.length });
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats, store.todayRecords.length, store.employees.length]);

  const confirmClearAttendance = useCallback(() => {
    Alert.alert(
      'Clear attendance history?',
      'Every attendance record on this device will be permanently deleted. Employees are kept. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => void store.clearAttendanceHistory().then(loadStats),
        },
      ],
    );
  }, [store, loadStats]);

  const confirmClearEverything = useCallback(() => {
    Alert.alert(
      'Erase all local data?',
      'Employees, attendance history and all settings will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase everything',
          style: 'destructive',
          onPress: () =>
            void clearAllLocalData().then(async () => {
              // Storage is gone; drop the in-memory copy too, or the employee
              // screens keep showing the times that were just erased.
              EmployeeStatusStore.clear();
              await store.refreshEmployees();
              await loadStats();
            }),
        },
      ],
    );
  }, [store, loadStats]);

  const confirmDevReset = useCallback(() => {
    Alert.alert(
      'Reset app setup?',
      'DEVELOPER ONLY.\n\nClears the device role so the next launch shows role setup again. BLE stops. Attendance history and employees are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset setup', style: 'destructive', onPress: () => void store.resetDeviceSetup() },
      ],
    );
  }, [store]);

  /**
   * Switching role tears down both radios and returns to the role gate.
   * Employees, attendance and settings all survive it — see resetDeviceSetup —
   * so this asks for confirmation without claiming anything will be lost.
   */
  const confirmRoleSwitch = useCallback(() => {
    Alert.alert(
      'Switch device role?',
      'This device will stop ' +
        (store.settings.role === 'HOST' ? 'scanning' : 'broadcasting') +
        ' and go back to role setup. Employees, attendance and settings are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch role', onPress: () => void store.resetDeviceSetup() },
      ],
    );
  }, [store]);

  return (
    <Screen>
      {canGoBack ? (
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [
            styles.backBtn,
            {
              backgroundColor: t.colors.surface,
              borderColor: t.colors.border,
              transform: [{ scale: pressed ? 0.93 : 1 }],
            },
            t.neu,
          ]}>
          <Icon name="chevron-left" size={18} color={t.colors.textPrimary} />
        </Pressable>
      ) : null}

      <Txt variant="display" style={canGoBack ? { marginTop: 18 } : undefined}>
        Settings
      </Txt>
      <Txt variant="subtitle" color={t.colors.textMuted} style={{ marginTop: 3 }}>
        {isHost
          ? 'Host device · ' + store.settings.hostId
          : (store.settings.employeeId || 'No ID') + ' · this device'}
      </Txt>

      {/* ================================ account ================================ */}
      <SettingGroup title="Account">
        <SettingRow
          icon={isHost ? 'building-2' : 'user'}
          iconTone="info"
          title={isHost ? store.settings.hostName || 'Attendance Host' : store.settings.employeeName || 'Your profile'}
          subtitle={isHost ? store.settings.hostId : store.settings.employeeId || 'Not set up'}
          /**
           * Employees get the full Profile screen; only the Host uses the sheet.
           *
           * The sheet had no "cannot change ID while broadcasting" guard, so it
           * was a way to swap the on-air employee ID behind the radio's back.
           * Host fields (name / host id) are not broadcast, so the sheet is fine
           * there.
           */
          onPress={isHost ? () => setProfileOpen(true) : () => navigation.navigate('Profile')}
        />
        {/*
          * Switching the role is a real action now, so this row is a button
          * rather than a read-only line. It stops both radios and clears the
          * role; nothing recorded is deleted, which is why it asks first but
          * does not warn about data loss.
          */}
        <SettingRow
          icon="shield"
          iconTone="accent"
          title="Device role"
          subtitle="Tap to set this device up as the other side"
          value={isHost ? 'Host' : 'Employee'}
          onPress={confirmRoleSwitch}
        />
      </SettingGroup>

      {/* =============================== bluetooth =============================== */}
      <SettingGroup
        title="Connectivity"
        footer={
          isHost
            ? 'Location must be on for Android to report nearby devices.'
            : 'Bluetooth must be on for the office system to detect you.'
        }>
        <SettingRow
          icon="bluetooth"
          iconTone={readiness?.bluetooth.ready ? 'success' : 'warning'}
          title="Bluetooth"
          value={readiness?.bluetooth.ready ? 'On' : 'Off'}
          valueTone={readiness?.bluetooth.ready ? 'success' : 'warning'}
          onPress={() => void requestEnableBluetooth().then(store.refreshReadiness)}
        />
        {isHost ? (
          <SettingRow
            icon="satellite-dish"
            iconTone={readiness?.locationServicesOn ? 'success' : 'warning'}
            title="Location services"
            value={readiness?.locationServicesOn ? 'On' : 'Off'}
            valueTone={readiness?.locationServicesOn ? 'success' : 'warning'}
            onPress={() => void openLocationSettings().then(store.refreshReadiness)}
          />
        ) : null}
        <SettingRow
          icon={isHost ? 'radio' : 'radio-tower'}
          iconTone={
            (isHost ? store.scan.scanning : store.advertiser.state === 'ACTIVE')
              ? 'success'
              : 'neutral'
          }
          title={isHost ? 'Attendance scanner' : 'Attendance broadcast'}
          value={
            isHost
              ? store.scan.scanning
                ? 'Active'
                : 'Off'
              : store.advertiser.state === 'ACTIVE'
              ? 'Active'
              : 'Off'
          }
          valueTone={
            (isHost ? store.scan.scanning : store.advertiser.state === 'ACTIVE')
              ? 'success'
              : 'neutral'
          }
        />
        <SettingRow
          icon="shield-check"
          iconTone={readiness?.permissionsGranted ? 'success' : 'warning'}
          title="App permissions"
          value={readiness?.permissionsGranted ? 'Granted' : 'Needed'}
          valueTone={readiness?.permissionsGranted ? 'success' : 'warning'}
          onPress={() => void Linking.openSettings()}
        />
      </SettingGroup>

      {/* ============================== attendance =============================== */}
      {isHost ? (
        <SettingGroup title="Attendance rules">
          <SettingRow
            icon="sliders-horizontal"
            iconTone="info"
            title="Detection settings"
            subtitle="Signal threshold and confirmation readings"
            onPress={() => setTuningOpen(true)}
          />
          <SettingRow
            icon="clock"
            iconTone="warning"
            title="Grace period"
            subtitle="Time before someone counts as having left"
            value={Math.round(store.settings.proximity.missingGracePeriodMs / 1000) + 's'}
            onPress={() => setTuningOpen(true)}
          />
        </SettingGroup>
      ) : null}

      {/* ================================= data ================================== */}
      <SettingGroup
        title="Data"
        footer="Everything is stored on this device. No backend, no cloud, no network.">
        <SettingRow
          icon="database"
          iconTone="neutral"
          title="Local storage"
          subtitle={
            stats
              ? stats.employees + ' employees · ' + stats.records + ' records · ' + stats.days + ' days'
              : 'Calculating…'
          }
        />
        {/*
          * The Host's only route to the monthly workbook now that the roster
          * header is bare. HistoryScreen IS the reports screen on this side —
          * ring, trend, totals, calendar and the export panel.
          */}
        <SettingRow
          icon="file-spreadsheet"
          iconTone="info"
          title="Attendance reports"
          subtitle="Monthly summary, calendar and export"
          onPress={() => navigation.navigate('History')}
        />
        <SettingRow
          icon="eraser"
          iconTone="warning"
          title="Clear attendance history"
          subtitle="Employees are kept"
          onPress={confirmClearAttendance}
        />
        <SettingRow
          icon="trash-2"
          title="Erase all data"
          subtitle="Employees, attendance and settings"
          destructive
          onPress={confirmClearEverything}
        />
      </SettingGroup>

      {/* ================================= about ================================= */}
      <SettingGroup title="About">
        <SettingRow icon="info" iconTone="info" title="Version" value={APP_VERSION} />
        <SettingRow
          icon="shield"
          iconTone="success"
          title="Privacy"
          subtitle="Only an opaque ID is broadcast. Names never leave the device."
        />
        <SettingRow
          icon="terminal"
          iconTone="neutral"
          title="Diagnostics"
          subtitle="Technical BLE details and logs"
          onPress={onOpenDebug}
        />
      </SettingGroup>

      {/* Developer reset — compiled out of release builds. */}
      {__DEV__ ? (
        <SettingGroup title="Developer" footer="Debug builds only. Not present in release.">
          <SettingRow
            icon="refresh-cw"
            iconTone="warning"
            title="Reset app setup"
            subtitle="Clears the device role"
            onPress={confirmDevReset}
          />
          <SettingRow
            icon="file-text"
            iconTone="neutral"
            title="Verbose logging"
            subtitle="Log every advertisement"
            toggle={{
              value: store.settings.verboseLogging,
              onChange: v => void store.updateSettings({ verboseLogging: v }),
            }}
          />
        </SettingGroup>
      ) : null}

      <Txt
        variant="caption"
        color={t.colors.textMuted}
        align="center"
        style={{ marginTop: 22, fontSize: 11.5, lineHeight: 17.25 }}>
        Appearance follows your device's light or dark setting. The app stores no theme of its
        own.
      </Txt>

      {/* ============================= profile sheet ============================= */}
      {isHost ? (
        <ProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />
      ) : null}

      {/* ============================= tuning sheet ============================== */}
      <TuningSheet visible={tuningOpen} onClose={() => setTuningOpen(false)} />
    </Screen>
  );
}

/* ============================================================ PickerSheet == */

function PickerSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<{ key: string; label: string; icon: 'circle' | 'circle-dot' | 'settings' }>;
  selected: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {options.map(option => (
        <Pressable
          key={option.key}
          onPress={() => onSelect(option.key)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === option.key }}
          style={({ pressed }) => [
            styles.pickerRow,
            {
              backgroundColor: pressed ? t.colors.surfaceMuted : 'transparent',
              paddingVertical: t.spacing.lg,
            },
          ]}>
          <Icon name={option.icon} size={18} color={t.colors.textSecondary} />
          <Txt variant="body" style={{ flex: 1, marginLeft: t.spacing.md }}>
            {option.label}
          </Txt>
          {selected === option.key ? (
            <Icon name="check" size={18} color={t.colors.primary} />
          ) : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

/* =========================================================== ProfileSheet == */

/**
 * HOST-only profile editor. The employee equivalent is EditProfileScreen, which
 * additionally blocks an ID change while the radio is on air.
 */
function ProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const store = useAppStore();

  const [name, setName] = useState('');
  const [id, setId] = useState('');

  useEffect(() => {
    if (visible) {
      setName(store.settings.hostName);
      setId(store.settings.hostId);
    }
  }, [visible, store.settings]);

  const save = useCallback(() => {
    void store.updateSettings({ hostName: name.trim(), hostId: id.trim() });
    onClose();
  }, [name, id, store, onClose]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Host profile">
      <SheetField
        label="Location name"
        value={name}
        onChange={setName}
        placeholder="Main Office"
        autoCapitalize="words"
      />
      <SheetField
        label="Host ID"
        value={id}
        onChange={setId}
        placeholder="HOST-8A31F"
        autoCapitalize="characters"
        mono
        hint="Stamped onto every attendance record this device writes."
      />
      <View style={{ marginTop: t.spacing.xl }}>
        <Button title="SAVE" onPress={save} size="lg" />
      </View>
    </Sheet>
  );
}

/* ============================================================ TuningSheet == */

function TuningSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const store = useAppStore();
  const p = store.settings.proximity;

  return (
    <Sheet visible={visible} onClose={onClose} title="Detection settings">
      <Stepper
        label="Signal threshold"
        help="How strong the signal must be to count as nearby. Less negative means closer. Tune this in your actual room."
        value={p.minimumRssi}
        unit="dBm"
        min={CONFIG_BOUNDS.minimumRssi.min}
        max={CONFIG_BOUNDS.minimumRssi.max}
        step={1}
        onChange={v => void store.updateProximity({ minimumRssi: v })}
      />
      <Stepper
        label="Confirmation readings"
        help="How many consecutive nearby readings before check-in. Higher resists a stray reflection but is slower."
        value={p.requiredConsecutiveDetections}
        unit="readings"
        min={1}
        max={10}
        step={1}
        onChange={v => void store.updateProximity({ requiredConsecutiveDetections: v })}
      />
      <Stepper
        label="Grace period"
        help="How long someone may go undetected before counting as left. Signals are missed routinely, so this should be minutes."
        value={Math.round(p.missingGracePeriodMs / 1000)}
        unit="seconds"
        min={CONFIG_BOUNDS.missingGracePeriodSeconds.min}
        max={CONFIG_BOUNDS.missingGracePeriodSeconds.max}
        step={CONFIG_BOUNDS.missingGracePeriodSeconds.step}
        onChange={v => void store.updateProximity({ missingGracePeriodMs: v * 1000 })}
      />
      <View style={{ marginTop: t.spacing.lg }}>
        <Button title="DONE" onPress={onClose} size="lg" />
      </View>
    </Sheet>
  );
}

function Stepper({
  label,
  help,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const t = useTheme();
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  return (
    <View style={{ marginTop: t.spacing.lg }}>
      <View style={styles.stepperRow}>
        <Txt variant="bodyMedium" style={{ flex: 1 }}>
          {label}
        </Txt>
        <View style={styles.stepperControls}>
          <StepButton icon="chevron-left" onPress={() => onChange(clamp(value - step))} />
          <View style={{ minWidth: 74, alignItems: 'center' }}>
            <Txt variant="bodyStrong">{value}</Txt>
            <Txt variant="caption" color={t.colors.textMuted}>
              {unit}
            </Txt>
          </View>
          <StepButton icon="chevron-right" onPress={() => onChange(clamp(value + step))} />
        </View>
      </View>
      <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 4 }}>
        {help}
      </Txt>
    </View>
  );
}

function StepButton({ icon, onPress }: { icon: 'chevron-left' | 'chevron-right'; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.stepButton,
        {
          backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surfaceRaised,
          borderColor: t.colors.border,
          borderRadius: t.radius.sm,
        },
      ]}>
      <Icon name={icon} size={16} color={t.colors.textPrimary} />
    </Pressable>
  );
}

/* ================================================================== Sheet == */

function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: t.colors.scrim }]} onPress={onClose}>
        {/* Inner Pressable swallows taps so touching the sheet does not close it. */}
        <Pressable
          onPress={e => e.stopPropagation()}
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.background,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
              padding: t.screenPadding,
              paddingBottom: t.spacing.xxxl,
            },
          ]}>
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: t.colors.borderStrong }]} />
          </View>
          <Txt variant="title" style={{ marginBottom: t.spacing.sm }}>
            {title}
          </Txt>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
  autoCapitalize = 'none',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  mono?: boolean;
  autoCapitalize?: 'none' | 'words' | 'characters';
}) {
  const t = useTheme();
  return (
    <View style={{ marginTop: t.spacing.lg }}>
      <Txt variant="captionMedium" color={t.colors.textSecondary}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={label}
        style={[
          t.typography.body,
          styles.input,
          {
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            color: t.colors.textPrimary,
            fontFamily: mono ? t.fonts.mono : undefined,
          },
        ]}
      />
      {hint ? (
        <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 5 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%' },
  handleWrap: { alignItems: 'center', paddingBottom: 12 },
  handle: { borderRadius: 3, height: 4, width: 40 },
  pickerRow: { alignItems: 'center', flexDirection: 'row', minHeight: 52 },
  stepperRow: { alignItems: 'center', flexDirection: 'row' },
  stepperControls: { alignItems: 'center', flexDirection: 'row' },
  stepButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
