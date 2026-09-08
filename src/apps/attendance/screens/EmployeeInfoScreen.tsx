/**
 * EmployeeInfoScreen.tsx — v3 "Orbit", the employee's Attendance tab
 * -----------------------------------------------------------------------------
 * Today in full: the running total, the punches, the one control that actually
 * does something, the radio's supporting state, the Host that recorded you,
 * this week, and today's trail.
 *
 * Everything on this screen still obeys the app's one rule — the Host records
 * attendance, and this phone only renders what a Host genuinely delivered over
 * the reply channel. Until a report arrives the numbers are dashes.
 *
 * TWO PLACES THE MOCK COULD NOT BE COPIED LITERALLY
 * ---------------------------------------------------------------------------
 * 1. THE ACTION BUTTON. The mock walks a demo state machine, so its button
 *    reads "Check out" when checked in. This phone cannot check anyone out: the
 *    Host marks someone LEFT when their signal stops arriving. A button that
 *    said "Check out" would not do it. The real control is the radio, so the
 *    button starts and stops broadcasting and says so — the same three visual
 *    variants (indigo / surface / amber), honestly labelled.
 *
 * 2. THE SIGNAL METER. The mock shows −54 dBm from the Host beacon. An employee
 *    device only ADVERTISES; it never scans, so it has no RSSI for anything,
 *    and the Host's report carries no signal reading. Rather than print a
 *    measurement nobody took, the meter shows a real quantity in the same
 *    geometry: how recently the Host last wrote to this phone. The threshold
 *    tick is gone with the threshold it marked.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { requestAdvertisePermissions } from '../bluetooth/permissions';
import { BlockerSheet, type BlockerKind } from '../components/BlockerSheet';
import { Icon, type IconName } from '../components/Icon';
import { Banner, Screen, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

/** The working day the progress bar is measured against. */
const DAY_MS = 9 * 60 * 60 * 1000;
/** How far back the freshness meter reads. Stated on the meter, not a policy. */
const FRESHNESS_WINDOW_MS = 60 * 60 * 1000;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** Monday-first initials, matching the strip's Monday-first order. */
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function formatHours(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}

/** Local YYYY-MM-DD, matching how the store keys a day. */
function dateKey(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** "4m" / "2h 10m", for the freshness readout. */
function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm ago';
}

export function EmployeeInfoScreen() {
  const t = useTheme();
  const c = t.colors;
  const store = useAppStore();

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<BlockerKind | null>(null);

  const report = store.employeeStatusReport;
  const history = store.employeeHistory;
  const readiness = store.readiness;
  const onAir = store.advertiser.state === 'ACTIVE';
  const btReady = !!readiness?.bluetooth.ready;
  const permsReady = !!readiness?.permissionsGranted;
  const configured = store.settings.employeeId.trim().length > 0;

  /** Ticks the running total and the freshness meter. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* -------------------------------------------------------------- actions -- */

  const start = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await store.refreshReadiness();
      if (store.readiness && !store.readiness.bluetooth.ready) {
        setSheet('bluetooth');
        return;
      }
      const permission = await requestAdvertisePermissions();
      if (!permission.granted) {
        if (permission.blocked.length > 0) setSheet('permissions');
        else setActionError(permission.message);
        return;
      }
      const result = await store.startAdvertising();
      if (!result.success) {
        if (store.advertiser.state === 'BLUETOOTH_DISABLED') setSheet('bluetooth');
        else if (result.error) setActionError(result.error);
      }
    } finally {
      setBusy(false);
      void store.refreshReadiness();
    }
  }, [store]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await store.stopAdvertising();
    } finally {
      setBusy(false);
      void store.refreshReadiness();
    }
  }, [store]);

  /* --------------------------------------------------------------- today -- */

  const checkedIn = report !== null;
  const workedMs = report ? (report.leftTime ?? now.getTime()) - report.checkInTime : 0;
  const shiftPct = report ? Math.min(100, Math.max(0, Math.round((workedMs / DAY_MS) * 100))) : 0;
  const remaining = DAY_MS - workedMs;

  const todayFg = checkedIn ? c.success : c.textMuted;

  const todaySub = report
    ? 'In ' +
      formatClockTime(report.checkInTime) +
      ' · ' +
      (report.leftTime ? 'checked out' : 'still on site') +
      ' · ' +
      report.hostId
    : 'No Host has recorded you today';

  /* --------------------------------------------------------- status strip -- */

  const strip: { label: string; value: string; fg: string }[] = [
    {
      label: 'BLUETOOTH',
      value: btReady ? 'On' : 'Off',
      fg: btReady ? c.success : c.textMuted,
    },
    {
      label: 'PERMISSIONS',
      value: permsReady ? 'Granted' : 'Required',
      fg: permsReady ? c.success : c.warning,
    },
    {
      label: 'CONNECTION',
      value: checkedIn ? 'Verified' : onAir ? 'Searching' : '—',
      fg: checkedIn ? c.success : onAir ? c.primaryTint : c.textMuted,
    },
  ];

  /* --------------------------------------------------------- action state -- */

  const action: { label: string; icon: IconName; variant: 'indigo' | 'amber' | 'surface' } =
    !btReady || !permsReady
      ? { label: 'Allow nearby devices', icon: 'shield', variant: 'amber' }
      : onAir
      ? { label: 'Stop broadcasting', icon: 'square', variant: 'surface' }
      : { label: 'Start check-in', icon: 'radio', variant: 'indigo' };

  const onAction = useCallback(() => {
    if (!configured) return;
    if (onAir) void stop();
    else void start();
  }, [configured, onAir, start, stop]);

  /* ---------------------------------------------------------- host device -- */

  const lastSynced = store.employeeLastSyncedAt;
  const sinceSync = lastSynced === null ? null : Math.max(0, now.getTime() - lastSynced);
  const freshnessPct =
    sinceSync === null
      ? 0
      : Math.max(0, Math.round((1 - Math.min(1, sinceSync / FRESHNESS_WINDOW_MS)) * 100));

  const dev = checkedIn
    ? { state: 'VERIFIED', fg: c.success, soft: c.successSoft, bd: c.successBorder }
    : onAir
    ? { state: 'SEARCHING', fg: c.primary, soft: c.primarySoft, bd: c.primaryBorderSoft }
    : { state: 'IDLE', fg: c.textMuted, soft: c.surfaceMuted, bd: c.border };

  /* ----------------------------------------------------------------- week -- */

  const week = useMemo(() => {
    // Monday-first, so the strip always starts the working week on the left.
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7));

    const delivered = new Map(history.map(d => [d.date, d]));
    const todayKey = dateKey(now);
    const todayIdx = (now.getDay() + 6) % 7;

    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const key = dateKey(day);
      const record = delivered.get(key);
      const present = record ? record.status !== 'ABSENT' : key === todayKey && checkedIn;

      let soft = 'transparent';
      let fg = c.textMuted;
      if (present) {
        soft = c.successSoft;
        fg = c.success;
      } else if (i === todayIdx) {
        soft = c.primarySoft;
        fg = c.primaryTint;
      } else if (record) {
        // Delivered and ABSENT — the only day this phone may call a miss.
        soft = c.surfaceMuted;
        fg = c.textMuted;
      }

      return { letter: DAY_LETTERS[i], n: String(day.getDate()).padStart(2, '0'), soft, fg };
    });
  }, [now, history, checkedIn, c]);

  /* ---------------------------------------------------------------- trail -- */

  /**
   * Only events a Host genuinely delivered. The mock invents four detections;
   * this phone is told three things at most, and each entry below is one of
   * them. An empty trail means nothing was delivered, never that nothing
   * happened.
   */
  const trail = useMemo(() => {
    if (!report) return [];
    const events: {
      title: string;
      time: number;
      detail: string;
      fg: string;
      soft: string;
    }[] = [
      {
        title: 'Checked in',
        time: report.checkInTime,
        detail: 'Recorded by ' + report.hostId,
        fg: c.success,
        soft: c.successSoft,
      },
    ];
    if (report.leftTime) {
      events.push({
        title: 'Checked out',
        time: report.leftTime,
        detail: 'The Host stopped seeing this device',
        fg: c.warning,
        soft: c.warningSoft,
      });
    }
    events.push({
      title: 'Status delivered',
      time: report.reportedAt,
      detail: 'Written to this phone over the reply channel',
      fg: c.primaryTint,
      soft: c.primarySoft,
    });
    // Newest first, matching the design's top-down order.
    return events.sort((a, b) => b.time - a.time);
  }, [report, c]);

  const card = { backgroundColor: c.surface, borderColor: c.border };

  return (
    <Screen>
      <Txt style={[styles.title, { color: c.textPrimary }]}>Attendance</Txt>
      <Txt style={[styles.dateLine, { color: c.textMuted }]}>
        {WEEKDAYS[now.getDay()] +
          ', ' +
          MONTHS[now.getMonth()] +
          ' ' +
          now.getDate() +
          ', ' +
          now.getFullYear()}
      </Txt>

      {/* ----------------------------------------------------------- hero -- */}
      <View style={[styles.hero, card, { borderLeftColor: todayFg }, t.neu]}>
        <View style={styles.heroLabelRow}>
          <View style={[styles.dot7, { backgroundColor: todayFg }]} />
          <Txt style={[styles.heroLabel, { color: todayFg }]}>
            {checkedIn ? 'PRESENT TODAY' : 'NOT CHECKED IN'}
          </Txt>
        </View>

        <Txt
          style={[
            styles.heroValue,
            numeric,
            { color: checkedIn ? c.textPrimary : c.textMuted },
          ]}>
          {checkedIn ? formatHours(workedMs) : '--h --m'}
        </Txt>
        <Txt style={[styles.heroSub, { color: c.textSecondary }]}>{todaySub}</Txt>

        <View style={[styles.track, t.neuIn(c)]}>
          <View
            style={[
              styles.trackFill,
              { backgroundColor: todayFg, width: (shiftPct + '%') as DimensionValue },
            ]}
          />
        </View>

        <View style={styles.heroFooter}>
          <Txt style={[styles.footNote, { color: c.textMuted }]}>
            {checkedIn ? shiftPct + '% of a 9h day' : 'of a 9h day'}
          </Txt>
          <Txt mono style={[styles.footNote, { color: c.textMuted }]}>
            {!checkedIn ? '--' : remaining <= 0 ? 'full day complete' : formatHours(remaining) + ' to go'}
          </Txt>
        </View>
      </View>

      {/* ----------------------------------------------------- punch trio -- */}
      <View style={styles.punchRow}>
        {[
          {
            label: 'CHECK IN',
            value: report ? formatClockTime(report.checkInTime) : '--:--',
            fg: report ? c.success : c.textMuted,
          },
          {
            label: 'CHECK OUT',
            value: report?.leftTime ? formatClockTime(report.leftTime) : '--:--',
            fg: c.textMuted,
          },
          {
            label: 'TOTAL',
            value: checkedIn ? formatHours(workedMs) : '--:--',
            fg: checkedIn ? c.success : c.textMuted,
          },
        ].map(cell => (
          <View key={cell.label} style={[styles.punch, card, t.shadow(1)]}>
            <Txt style={[styles.punchLabel, { color: c.textMuted }]}>{cell.label}</Txt>
            <Txt style={[styles.punchValue, numeric, { color: cell.fg }]}>{cell.value}</Txt>
          </View>
        ))}
      </View>

      {/* --------------------------------------------------------- action -- */}
      <Pressable
        onPress={onAction}
        disabled={busy || !configured}
        style={({ pressed }) => [
          styles.action,
          action.variant === 'surface'
            ? { backgroundColor: c.surface, borderColor: c.borderStrong }
            : { borderColor: 'transparent' },
          action.variant === 'surface' ? t.neu : null,
          busy || !configured ? { opacity: 0.55 } : null,
          pressed ? { transform: [{ scale: 0.975 }] } : null,
        ]}>
        {action.variant === 'surface' ? null : (
          <LinearGradient
            colors={
              action.variant === 'amber' ? ['#B45309', '#F59E0B'] : ['#4F46E5', '#7C3AED']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Icon
          name={action.icon}
          size={17}
          color={action.variant === 'surface' ? c.textPrimary : '#FFFFFF'}
        />
        <Txt
          style={[
            styles.actionLabel,
            { color: action.variant === 'surface' ? c.textPrimary : '#FFFFFF' },
          ]}>
          {action.label}
        </Txt>
      </Pressable>

      {!configured ? (
        <View style={{ marginTop: 12 }}>
          <Banner
            tone="warning"
            title="No employee ID yet"
            detail="Add your ID under Profile before checking in — the office system identifies you by it."
          />
        </View>
      ) : null}
      {actionError ? (
        <View style={{ marginTop: 12 }}>
          <Banner tone="danger" title="Could not start broadcasting" detail={actionError} />
        </View>
      ) : null}

      {/* --------------------------------------------------- status strip -- */}
      <View style={styles.stripRow}>
        {strip.map(w => (
          <View key={w.label} style={[styles.well, t.neuIn(c)]}>
            <Txt style={[styles.wellLabel, { color: c.textMuted }]}>{w.label}</Txt>
            <View style={styles.wellValueRow}>
              <View style={[styles.dot6, { backgroundColor: w.fg }]} />
              <Txt style={[styles.wellValue, { color: w.fg }]}>{w.value}</Txt>
            </View>
          </View>
        ))}
      </View>

      {/* ---------------------------------------------------- host device -- */}
      <Txt style={[styles.eyebrow, { color: c.textMuted }]}>ATTENDANCE DEVICE</Txt>
      <View style={[styles.deviceCard, card, t.neu]}>
        <View style={styles.deviceHead}>
          <View
            style={[
              styles.deviceIcon,
              { backgroundColor: c.primarySoft, borderColor: c.primaryBorderSoft },
            ]}>
            <Icon name="radio" size={20} color={c.primaryTint} />
          </View>

          <View style={styles.deviceText}>
            <Txt numberOfLines={1} style={[styles.deviceName, { color: c.textPrimary }]}>
              {report ? report.hostId : 'No Host yet'}
            </Txt>
            <Txt mono numberOfLines={1} style={[styles.deviceMeta, { color: c.textMuted }]}>
              {report ? 'reply channel · ' + report.date : 'nothing delivered'}
            </Txt>
          </View>

          <View style={[styles.pill, { backgroundColor: dev.soft, borderColor: dev.bd }]}>
            <View style={[styles.dot6, { backgroundColor: dev.fg }]} />
            <Txt style={[styles.pillText, { color: dev.fg }]}>{dev.state}</Txt>
          </View>
        </View>

        {/* Link freshness, not signal strength — see the header note. */}
        <View style={[styles.track, styles.deviceTrack, t.neuIn(c)]}>
          <LinearGradient
            colors={[c.primary, c.success]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.trackFill, { width: (freshnessPct + '%') as DimensionValue }]}
          />
        </View>

        <View style={styles.heroFooter}>
          <Txt mono style={[styles.footNoteSm, { color: c.textMuted }]}>
            {sinceSync === null ? 'never synced' : 'synced ' + ago(sinceSync)}
          </Txt>
          <Txt style={[styles.footNoteSm, { color: c.textMuted }]}>1h window</Txt>
        </View>
      </View>

      {/* ----------------------------------------------------------- week -- */}
      <Txt style={[styles.eyebrow, { color: c.textMuted }]}>THIS WEEK</Txt>
      <View style={styles.weekRow}>
        {week.map((d, i) => (
          <View key={i} style={[styles.weekCard, card, t.shadow(1)]}>
            <Txt style={[styles.weekLetter, { color: c.textMuted }]}>{d.letter}</Txt>
            <View style={[styles.weekCircle, { backgroundColor: d.soft }]}>
              <Txt style={[styles.weekNum, numeric, { color: d.fg }]}>{d.n}</Txt>
            </View>
          </View>
        ))}
      </View>

      {/* ---------------------------------------------------------- trail -- */}
      <Txt style={[styles.eyebrow, { color: c.textMuted }]}>TODAY'S TRAIL</Txt>
      {trail.length === 0 ? (
        <View style={styles.empty}>
          <Image
            source={require('../assets/no-history.png')}
            style={styles.emptyArt}
            resizeMode="contain"
          />
          <Txt style={[styles.emptyTitle, { color: c.textPrimary }]}>No trail yet</Txt>
          <Txt style={[styles.emptyBody, { color: c.textMuted }]}>
            Check in above and everything the Host reports back appears here as a timestamped
            event.
          </Txt>
        </View>
      ) : (
        <View style={styles.trail}>
          {trail.map((e, i) => (
            <View key={i} style={styles.trailRow}>
              <View style={styles.rail}>
                <View style={[styles.railDot, { backgroundColor: e.fg, borderColor: e.soft }]} />
                {i < trail.length - 1 ? (
                  <View style={[styles.railLine, { backgroundColor: c.border }]} />
                ) : null}
              </View>
              <View style={styles.trailBody}>
                <View style={styles.trailHead}>
                  <Txt style={[styles.trailTitle, { color: c.textPrimary }]}>{e.title}</Txt>
                  <Txt style={[styles.trailTime, numeric, { color: c.textSecondary }]}>
                    {formatClockTime(e.time)}
                  </Txt>
                </View>
                <Txt style={[styles.trailDetail, { color: c.textMuted }]}>{e.detail}</Txt>
              </View>
            </View>
          ))}
        </View>
      )}

      <BlockerSheet
        visible={sheet !== null}
        kind={sheet ?? 'bluetooth'}
        role="advertise"
        onClose={() => setSheet(null)}
        onFixed={() => void start()}
      />
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
  dateLine: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, marginTop: 3 },

  hero: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    // The accent rail. Only the left edge is thick, so it reads as a marker
    // rather than as a heavier card.
    borderLeftWidth: 3,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  heroLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  dot7: { borderRadius: 999, height: 7, width: 7 },
  dot6: { borderRadius: 999, height: 6, width: 6 },
  heroLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10.5, letterSpacing: 0.9 },
  heroValue: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 40,
    letterSpacing: -1.6,
    lineHeight: 48,
    marginTop: 10,
  },
  heroSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, marginTop: 3 },

  track: { borderRadius: 999, height: 8, marginTop: 18, overflow: 'hidden' },
  trackFill: { borderRadius: 999, height: 8 },
  heroFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  footNote: { fontSize: 11 },
  footNoteSm: { fontSize: 10.5 },

  punchRow: { flexDirection: 'row', gap: 9, marginBottom: 16, marginTop: 14 },
  punch: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 13,
  },
  punchLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9.5, letterSpacing: 0.8 },
  punchValue: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 18, marginTop: 7 },

  action: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },

  stripRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  well: { alignItems: 'center', borderRadius: 14, flex: 1, paddingHorizontal: 8, paddingVertical: 10 },
  wellLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9, letterSpacing: 0.8 },
  wellValueRow: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 6 },
  wellValue: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5 },

  eyebrow: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 11,
    marginTop: 26,
  },

  deviceCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  deviceHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  deviceIcon: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  deviceText: { flex: 1, minWidth: 0 },
  deviceName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  deviceMeta: { fontSize: 11, marginTop: 2 },
  deviceTrack: { marginTop: 16 },
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
  },
  pillText: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10, letterSpacing: 0.6 },

  weekRow: { flexDirection: 'row', gap: 7 },
  weekCard: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingBottom: 10,
    paddingTop: 11,
  },
  weekLetter: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10, letterSpacing: 0.5 },
  weekCircle: {
    alignItems: 'center',
    borderRadius: 999,
    height: 26,
    justifyContent: 'center',
    marginTop: 8,
    width: 26,
  },
  weekNum: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 11.5 },

  empty: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  emptyArt: { height: 150, width: 150 },
  emptyTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 16,
    letterSpacing: -0.3,
    lineHeight: 22,
    marginTop: 16,
  },
  emptyBody: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 12.5,
    lineHeight: 19.5,
    marginTop: 7,
    maxWidth: 250,
    textAlign: 'center',
  },

  trail: { paddingLeft: 4 },
  trailRow: { flexDirection: 'row', gap: 14, paddingBottom: 18 },
  rail: { alignItems: 'center' },
  railDot: {
    borderRadius: 999,
    // The design's 4px halo. RN has no spread-only shadow, so the ring is a
    // border on a larger dot — same 19px footprint, same 11px core.
    borderWidth: 4,
    height: 19,
    marginTop: 3,
    width: 19,
  },
  railLine: { flex: 1, marginTop: 4, width: 1.5 },
  trailBody: { flex: 1 },
  trailHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  trailTitle: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14 },
  trailTime: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 13 },
  trailDetail: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, marginTop: 2 },
});
