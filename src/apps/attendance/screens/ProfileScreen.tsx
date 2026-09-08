/**
 * ProfileScreen.tsx — v3 "Orbit", employee tab 4
 * -----------------------------------------------------------------------------
 * Who this device says you are, how the month has actually gone, and the way
 * into Settings. Read-only: every value here is either a stored setting or a
 * figure derived from days a Host delivered. Editing lives one push away in
 * EditProfileScreen, which is the old Profile screen unchanged.
 *
 * WHERE THE DESIGN'S PLACEHOLDERS MET REAL DATA
 * ---------------------------------------------------------------------------
 * The mock hard-codes an identity (AS · EMP-1043 · Engineering), a contact card
 * (aarav.s@company.in), an overview (19 of 24 days, 91%) and a personal best
 * (27 days, Apr – May 2026). Those are mock furniture, not the design's intent
 * — reproducing them literally would put a stranger's email on the user's own
 * profile. Every one is bound to what this phone genuinely holds, and anything
 * unset renders as a dash rather than as an invented value.
 *
 * The LATE tile is the one place the layout could not be filled honestly; see
 * employeeStats.ts for why it shows the average arrival instead.
 * -----------------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Icon, type IconName } from '../components/Icon';
import { Screen, Txt } from '../components/ui';
import { APP_VERSION } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import {
  formatMinutesOfDay,
  monthKeyOfDate,
  summariseMonth,
  summariseStreaks,
} from '../state/employeeStats';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "AS" from "Aarav Sharma"; "A" from one word; "?" from nothing. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Apr 3" from "2026-04-03", for the longest-streak range. */
function shortDay(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return SHORT_MONTHS[Number(m) - 1] + ' ' + Number(d);
}

export function ProfileScreen() {
  const t = useTheme();
  const store = useAppStore();
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const s = store.settings;

  const now = useMemo(() => new Date(), []);
  const monthKey = monthKeyOfDate(now);

  const overview = useMemo(
    () => summariseMonth(store.employeeHistory, monthKey),
    [store.employeeHistory, monthKey],
  );
  const streaks = useMemo(() => summariseStreaks(store.employeeHistory), [store.employeeHistory]);

  const c = t.colors;

  /* -------------------------------------------------------------- contact -- */

  const contactRows: { icon: IconName; label: string; value: string; set: boolean }[] = [
    { icon: 'mail', label: 'Email', value: s.employeeEmail, set: s.employeeEmail.length > 0 },
    { icon: 'phone', label: 'Phone', value: s.employeePhone, set: s.employeePhone.length > 0 },
    {
      icon: 'building-2',
      label: 'Office',
      value: s.employeeDepartment,
      set: s.employeeDepartment.length > 0,
    },
  ];

  /* ------------------------------------------------------------- overview -- */

  const tiles = [
    {
      label: 'PRESENT',
      value: overview.recorded === 0 ? '—' : String(overview.present),
      sub: overview.recorded === 0 ? 'nothing delivered' : 'of ' + overview.recorded + ' days',
      fg: overview.present > 0 ? c.success : c.textMuted,
    },
    {
      label: 'ABSENT',
      value: overview.recorded === 0 ? '—' : String(overview.absent),
      sub: 'as reported',
      fg: c.textMuted,
    },
    {
      // Stands in for the mock's LATE tile — see employeeStats.ts.
      label: 'AVG IN',
      value:
        overview.avgCheckInMinutes === null
          ? '—'
          : formatMinutesOfDay(overview.avgCheckInMinutes),
      sub: 'check-in time',
      fg: c.textMuted,
    },
    {
      label: 'RATE',
      value: overview.ratePct === null ? '—' : overview.ratePct + '%',
      sub: 'this month',
      fg: overview.ratePct === null ? c.textMuted : c.success,
    },
  ];

  /* ------------------------------------------------------------- settings -- */

  const settingsRows: {
    icon: IconName;
    title: string;
    sub: string;
    fg: string;
    soft: string;
    to: string;
  }[] = [
    {
      icon: 'user',
      title: 'Personal details',
      sub: 'Name, ID, department, photo',
      fg: c.primaryTint,
      soft: c.primarySoft,
      to: 'EditProfile',
    },
    {
      icon: 'radio',
      title: 'Connectivity',
      sub: 'Bluetooth, location, permissions',
      fg: c.primaryTint,
      soft: c.primarySoft,
      to: 'Settings',
    },
    {
      icon: 'shield',
      title: 'Privacy',
      sub: 'Only your ID is ever broadcast',
      fg: c.success,
      soft: c.successSoft,
      to: 'Settings',
    },
    {
      icon: 'sliders-horizontal',
      title: 'Data',
      sub: 'Local storage and history',
      fg: c.primaryTint,
      soft: c.primarySoft,
      to: 'Settings',
    },
    {
      icon: 'info',
      title: 'About',
      sub: 'Version ' + APP_VERSION,
      fg: c.primaryTint,
      soft: c.primarySoft,
      to: 'Settings',
    },
  ];

  const card = {
    backgroundColor: c.surface,
    borderColor: c.border,
  };

  return (
    <Screen>
      <Txt style={[styles.title, { color: c.textPrimary }]}>Profile</Txt>

      {/* ------------------------------------------------------- identity -- */}
      <View style={styles.identity}>
        {s.employeePhoto ? (
          <Image source={{ uri: s.employeePhoto }} style={styles.avatar} />
        ) : (
          <LinearGradient
            colors={['#6366F1', '#8B5CF6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.avatar, styles.avatarInk]}>
            <Txt style={styles.initials}>{initialsOf(s.employeeName)}</Txt>
          </LinearGradient>
        )}

        <Txt style={[styles.name, { color: c.textPrimary }]}>
          {s.employeeName || 'Name not set'}
        </Txt>
        <Txt mono style={[styles.meta, { color: c.textMuted }]}>
          {s.employeeId
            ? s.employeeDepartment
              ? s.employeeId + ' · ' + s.employeeDepartment
              : s.employeeId
            : 'No employee ID'}
        </Txt>
      </View>

      {/* -------------------------------------------------------- contact -- */}
      <View style={[styles.listCard, card, t.shadow(2)]}>
        {contactRows.map(r => (
          <View key={r.label} style={[styles.row, { borderTopColor: c.border }]}>
            <Icon name={r.icon} size={16} color={c.textMuted} />
            <Txt style={[styles.rowLabel, { color: c.textMuted }]}>{r.label}</Txt>
            <Txt
              numberOfLines={1}
              style={[styles.rowValue, { color: r.set ? c.textSecondary : c.textMuted }]}>
              {r.set ? r.value : 'Not set'}
            </Txt>
          </View>
        ))}
      </View>

      {/* ------------------------------------------------------- overview -- */}
      <Txt style={[styles.heading, { color: c.textPrimary }]}>Attendance overview</Txt>
      <Txt style={[styles.subheading, { color: c.textMuted }]}>
        {MONTHS[now.getMonth()] + ' ' + now.getFullYear()}
      </Txt>

{/* Two rows of two rather than a wrapping grid: RN cannot express
          "half the width minus half the gap" as a percentage, so a wrap would
          leave the second column short by a few pixels on every device. */}
      {[tiles.slice(0, 2), tiles.slice(2)].map((pair, i) => (
        <View key={i} style={i === 0 ? styles.grid : styles.gridNext}>
          {pair.map(tile => (
            <View key={tile.label} style={[styles.tile, styles.gridTile, card, t.neu]}>
              <Txt style={[styles.tileLabel, { color: c.textMuted }]}>{tile.label}</Txt>
              <Txt style={[styles.tileValue, numeric, { color: tile.fg }]}>{tile.value}</Txt>
              <Txt style={[styles.tileSub, { color: c.textMuted }]}>{tile.sub}</Txt>
            </View>
          ))}
        </View>
      ))}

      {/* --------------------------------------------------------- streak -- */}
      <Txt style={[styles.heading, { color: c.textPrimary }]}>Streak</Txt>
      <View style={styles.streakRow}>
        <View style={[styles.tile, styles.streakCard, card, t.neu]}>
          <View style={styles.streakHead}>
            <Icon name="flame" size={15} color={c.warning} />
            <Txt style={[styles.tileLabel, { color: c.textMuted }]}>CURRENT</Txt>
          </View>
          <Txt style={[styles.tileValue, numeric, { color: c.textPrimary }]}>{streaks.current}</Txt>
          <Txt style={[styles.tileSub, { color: c.textMuted }]}>work days</Txt>
        </View>

        <View style={[styles.tile, styles.streakCard, card, t.neu]}>
          <View style={styles.streakHead}>
            <Icon name="trophy" size={15} color={c.textMuted} />
            <Txt style={[styles.tileLabel, { color: c.textMuted }]}>LONGEST</Txt>
          </View>
          <Txt style={[styles.tileValue, numeric, { color: c.textPrimary }]}>{streaks.longest}</Txt>
          <Txt style={[styles.tileSub, { color: c.textMuted }]}>
            {streaks.longestFrom && streaks.longestTo
              ? streaks.longestFrom === streaks.longestTo
                ? shortDay(streaks.longestFrom)
                : shortDay(streaks.longestFrom) + ' – ' + shortDay(streaks.longestTo)
              : 'no days yet'}
          </Txt>
        </View>
      </View>

      {/* ------------------------------------------------------- settings -- */}
      <Txt style={[styles.heading, { color: c.textPrimary }]}>Settings</Txt>
      <View style={[styles.listCard, styles.settingsCard, card, t.shadow(2)]}>
        {settingsRows.map(r => (
          <Pressable
            key={r.title}
            onPress={() => navigation.navigate(r.to)}
            style={({ pressed }) => [
              styles.row,
              { borderTopColor: c.border },
              pressed ? { backgroundColor: c.surfaceMuted } : null,
            ]}>
            <View style={[styles.iconTile, { backgroundColor: r.soft }]}>
              <Icon name={r.icon} size={17} color={r.fg} />
            </View>
            <View style={styles.rowText}>
              <Txt style={[styles.rowTitle, { color: c.textPrimary }]}>{r.title}</Txt>
              <Txt style={[styles.rowSub, { color: c.textMuted }]}>{r.sub}</Txt>
            </View>
            <Icon name="chevron-right" size={15} color={c.textMuted} />
          </Pressable>
        ))}
      </View>

      {/* ---------------------------------------------------- switch role -- */}
      <Pressable
        onPress={() => void store.resetDeviceSetup()}
        style={({ pressed }) => [
          styles.switchRole,
          { backgroundColor: c.errorSoft, borderColor: c.error },
          pressed ? { transform: [{ scale: 0.98 }] } : null,
        ]}>
        <Icon name="log-out" size={16} color={c.errorTint} />
        <Txt style={[styles.switchLabel, { color: c.errorTint }]}>Switch device role</Txt>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 26,
    letterSpacing: -0.7,
    lineHeight: 34,
  },

  identity: { alignItems: 'center', marginTop: 22 },
  avatar: { borderRadius: 999, height: 88, width: 88 },
  avatarInk: {
    alignItems: 'center',
    justifyContent: 'center',
    // The design's indigo cast under the avatar. Android takes the colour from
    // elevation, so this reads as a plain lift there rather than a tinted one.
    elevation: 10,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
  },
  initials: {
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 28,
    letterSpacing: 0.5,
    lineHeight: 36,
  },
  name: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 22,
    letterSpacing: -0.5,
    lineHeight: 29,
    marginTop: 16,
  },
  meta: { fontSize: 12, marginTop: 5 },

  listCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 22,
    overflow: 'hidden',
  },
  settingsCard: { marginTop: 13 },
  row: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 13,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  rowLabel: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5 },
  rowValue: {
    flexShrink: 1,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
    textAlign: 'right',
  },

  heading: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, marginTop: 26 },
  subheading: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, marginTop: 2 },

  grid: { flexDirection: 'row', gap: 9, marginTop: 13 },
  gridNext: { flexDirection: 'row', gap: 9, marginTop: 9 },
  gridTile: { flex: 1 },
  tile: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  tileLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9.5, letterSpacing: 0.9 },
  tileValue: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 28,
    letterSpacing: -1,
    lineHeight: 35,
    marginTop: 8,
  },
  tileSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, marginTop: 2 },

  streakRow: { flexDirection: 'row', gap: 9, marginTop: 13 },
  streakCard: { flex: 1 },
  streakHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },

  iconTile: {
    alignItems: 'center',
    borderRadius: 11,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14.5 },
  rowSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, marginTop: 2 },

  switchRole: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    height: 48,
    justifyContent: 'center',
    marginTop: 22,
  },
  switchLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5 },
});
