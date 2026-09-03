/**
 * EmployeeInfoScreen.tsx
 * -----------------------------------------------------------------------------
 * The Employee's "Attendance" tab.
 *
 * Shows the employee's REAL attendance status — but only once a Host has
 * genuinely delivered it over the BLE reply channel. The Host records the
 * check-in, connects back to this phone, and writes the status into a GATT
 * characteristic; what arrives there is the only status this screen renders.
 *
 * Until a report arrives the screen shows nothing but an explanation, because
 * until then this device truly does not know.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IconBadge } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { Timeline, type TimelineEntry } from '../components/Timeline';
import { Banner, Card, Screen, SectionHeader, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function EmployeeInfoScreen() {
  const t = useTheme();
  const store = useAppStore();
  const advertising = store.advertiser.advertising;
  const report = store.employeeStatusReport;

  const entries: TimelineEntry[] = report
    ? [
        {
          label: 'Checked in',
          value: formatClockTime(report.checkInTime),
          detail: 'Recorded by ' + report.hostId,
          tone: 'success',
        },
        ...(report.leftTime
          ? [
              {
                label: 'Marked as left',
                value: formatClockTime(report.leftTime),
                detail: 'Out of range past the grace period',
                tone: 'warning' as const,
              },
            ]
          : []),
        {
          label: 'Delivered to this phone',
          value: formatClockTime(report.reportedAt),
          detail: 'Written over Bluetooth by the Host',
          tone: 'neutral',
        },
      ]
    : [];

  return (
    <Screen>
      <SectionHeader title="Your attendance" />

      {/* ------------------------------------------------- today, for real -- */}
      {report ? (
        <Card accent={report.status === 'PRESENT' ? t.colors.success : t.colors.warning}>
          <View style={styles.todayHeader}>
            <View style={{ flex: 1 }}>
              <Txt variant="overline" color={t.colors.textMuted}>
                TODAY'S ATTENDANCE
              </Txt>
              <Txt
                variant="title"
                color={report.status === 'PRESENT' ? t.colors.success : t.colors.warning}
                style={{ marginTop: 2 }}>
                {report.status === 'PRESENT' ? 'Present' : 'Left'}
              </Txt>
            </View>
            <StatusBadge
              label={report.status === 'PRESENT' ? 'Present' : 'Left'}
              tone={report.status === 'PRESENT' ? 'success' : 'warning'}
            />
          </View>

          <View style={{ marginTop: t.spacing.lg }}>
            <Timeline entries={entries} />
          </View>

          {/* Attribution is part of the trust story: this phone shows what a
              specific Host wrote, never what it decided on its own. */}
          <Txt variant="caption" color={t.colors.textMuted} style={{ lineHeight: 17, marginTop: t.spacing.md }}>
            This status was recorded by {report.hostId} and delivered to this
            phone over Bluetooth.
          </Txt>
        </Card>
      ) : null}

      <Card accent={t.colors.info}>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <IconBadge
            name="building-2"
            color={t.colors.info}
            background={t.colors.infoSoft}
            diameter={56}
            size={25}
          />
          <Txt variant="heading" style={{ marginTop: 14 } as object} align="center">
            Attendance is recorded by the Host
          </Txt>
          <Txt
            variant="caption"
            color={t.colors.textSecondary}
            align="center"
            style={{ marginTop: 8, lineHeight: 20, maxWidth: 320 } as object}>
            Your phone broadcasts your employee ID. The Host device decides whether you are
            near enough and stores the record. This phone never receives a reply, so it cannot
            show you a check-in status.
          </Txt>
          <Txt
            variant="caption"
            color={t.colors.textMuted}
            align="center"
            style={{ marginTop: 12, lineHeight: 18, maxWidth: 320 } as object}>
            To confirm your attendance, ask the Host device or your administrator.
          </Txt>
        </View>
      </Card>

      <SectionHeader title="What this phone is doing" />
      <Card>
        <View style={{ alignItems: 'center', flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="body">Broadcasting</Txt>
            <Txt variant="caption" color={t.colors.textMuted}>
              {advertising
                ? 'Your identifier is on air right now'
                : 'Not currently broadcasting'}
            </Txt>
          </View>
          <StatusBadge
            label={advertising ? 'Active' : 'Off'}
            tone={advertising ? 'success' : 'neutral'}
          />
        </View>
      </Card>

      {!advertising ? (
        <Banner
          tone="warning"
          title="You are not being broadcast"
          detail="Go to the Home tab and start advertising, otherwise the Host cannot detect you and no attendance can be recorded."
        />
      ) : null}

      <Banner
        tone="info"
        icon="shield"
        title="What leaves your phone"
        detail={
          'Only your employee ID is transmitted — not your name, and nothing else. The ' +
          'broadcast is one-way and non-connectable, so no device can connect to your phone ' +
          'through it, and no pairing is involved.'
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  todayHeader: { alignItems: 'flex-start', flexDirection: 'row' },
});
