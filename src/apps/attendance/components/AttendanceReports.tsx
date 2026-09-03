/**
 * AttendanceReports.tsx
 * -----------------------------------------------------------------------------
 * The Host's "Attendance Reports" section: month picker, monthly totals,
 * per-employee summary, and the Excel export.
 *
 * ISOLATED FROM BLE BY CONSTRUCTION. Nothing here starts, stops, or configures
 * a radio; changing the month only re-reads persisted records. The scanner
 * keeps running underneath, untouched, exactly as it does when the user opens
 * any other tab.
 *
 * Rendered only for a Host (see HistoryScreen), and the export service asserts
 * the role again before it will read company-wide records.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MonthlyReport } from '../attendance/monthlyReport';
import { monthKeyOf } from '../attendance/monthlyReport';
import { ReportExportService } from '../reports/ReportExportService';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';
import { EmployeeAvatar } from './EmployeeAvatar';
import { Icon } from './Icon';
import { MonthPicker } from './MonthPicker';
import { StatTile, StatTileRow } from './StatTile';
import { EmptyState, SkeletonBlock } from './states';
import { Banner, Button, Card, SectionHeader, Txt } from './ui';

type Phase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; fileName: string }
  /**
   * The workbook was built, but Android found no app able to receive it.
   * Reporting this as success would be a lie: the file exists in the app's
   * cache and the user has no way to reach it.
   */
  | { kind: 'nowhere'; fileName: string }
  | { kind: 'error'; message: string };

export function AttendanceReports() {
  const t = useTheme();
  const store = useAppStore();

  const [months, setMonths] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string>(() => {
    const now = new Date();
    return monthKeyOf(now.getFullYear(), now.getMonth());
  });
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  /* ---------------------------------------------------- available months -- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await ReportExportService.availableMonths();
      if (cancelled) {
        return;
      }
      setMonths(available);
      // Prefer the current month when it has data, else the newest that does.
      if (available.length > 0) {
        setSelected(prev => (available.includes(prev) ? prev : available[0]));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Recompute when today's records change: the first check-in of a new month
    // makes that month selectable.
  }, [store.todayRecords.length]);

  /* ------------------------------------------------------- the report -- */

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await ReportExportService.loadReport(selected, store.employees);
      if (!cancelled) {
        setReport(next);
        setLoading(false);
        // A stale success banner next to a different month would be a lie.
        setPhase({ kind: 'idle' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, store.employees, store.todayRecords.length]);

  /* ----------------------------------------------------------- export -- */

  const handleExport = useCallback(async () => {
    if (!report) {
      return;
    }
    setPhase({ kind: 'working' });
    const outcome = await ReportExportService.exportReport(report, {
      officeName: store.settings.hostName || 'Attendance Host',
      hostId: store.settings.hostId,
    });
    if (outcome.ok) {
      setPhase(
        outcome.shared
          ? { kind: 'done', fileName: outcome.fileName }
          : { kind: 'nowhere', fileName: outcome.fileName },
      );
    } else {
      setPhase({ kind: 'error', message: outcome.message });
    }
  }, [report, store.settings.hostName, store.settings.hostId]);

  /* ------------------------------------------------------------ render -- */

  if (months !== null && months.length === 0) {
    return (
      <>
        <SectionHeader title="Attendance reports" style={{ marginTop: t.spacing.xl }} />
        <Card>
          <EmptyState
            art="noRecordsThisMonth"
            icon="file-spreadsheet"
            title="No records available"
            message="Once employees start checking in, each month becomes available here as a downloadable Excel report."
          />
        </Card>
      </>
    );
  }

  const hasData = report !== null && !report.isEmpty;

  return (
    <>
      <SectionHeader
        title="Attendance reports"
        subtitle="Month-wise summary and Excel export"
        style={{ marginTop: t.spacing.xl }}
      />

      {months && months.length > 0 ? (
        <MonthPicker months={months} selected={selected} onSelect={setSelected} />
      ) : null}

      {loading || !report ? (
        <Card>
          <SkeletonBlock height={18} width="55%" />
          <View style={{ height: 12 }} />
          <SkeletonBlock height={64} />
        </Card>
      ) : report.isEmpty ? (
        <Card>
          <EmptyState
            art="noRecordsThisMonth"
            icon="calendar-x"
            title="No records available"
            message={
              'No attendance data is available for ' +
              report.monthLabel +
              '. Try selecting a different month.'
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.metaRow}>
              <Txt variant="heading">{report.monthLabel}</Txt>
              <Txt variant="caption" color={t.colors.textMuted}>
                {report.totalEmployees} employee{report.totalEmployees === 1 ? '' : 's'} ·{' '}
                {report.workingDays} working day{report.workingDays === 1 ? '' : 's'}
              </Txt>
            </View>

            <View style={{ marginTop: t.spacing.lg }}>
              <StatTileRow>
                <StatTile count={report.totals.present} label="Present" tone="success" />
                <StatTile count={report.totals.left} label="Left" tone="warning" />
                <StatTile count={report.totals.absent} label="Absent" tone="danger" />
              </StatTileRow>
            </View>

            {/*
              * "Working days" is a derived number, not a configured one, so it
              * says so — otherwise a Host would reasonably read 22 as a setting
              * they could change.
              */}
            <Txt variant="caption" color={t.colors.textMuted} style={{ lineHeight: 17 }}>
              Working days are the days this Host recorded attendance. Days with
              no records at all are treated as non-working and never counted as
              absences.
            </Txt>
          </Card>

          <Card
            onPress={() => setExpanded(e => !e)}
            style={{ marginBottom: t.spacing.md }}>
            <View style={styles.metaRow}>
              <Txt variant="heading">Employee summary</Txt>
              <Icon
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={t.colors.textMuted}
              />
            </View>

            {expanded ? (
              <View style={{ marginTop: t.spacing.md }}>
                {report.employees.map((e, i) => (
                  <View
                    key={e.employeeId}
                    style={[
                      styles.employeeRow,
                      {
                        borderTopColor: t.colors.border,
                        borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                        paddingVertical: t.spacing.md,
                      },
                    ]}>
                    <EmployeeAvatar
                      name={e.employeeName}
                      employeeId={e.employeeId}
                      size={38}
                      photo={
                        store.employees.find(x => x.employeeId === e.employeeId)?.photo
                      }
                    />
                    <View style={{ flex: 1, marginLeft: t.spacing.md }}>
                      <Txt variant="bodyMedium" numberOfLines={1}>
                        {e.employeeName}
                      </Txt>
                      <Txt variant="caption" color={t.colors.textMuted} mono>
                        {e.employeeId}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt variant="captionMedium" color={t.colors.success}>
                        {e.attendancePercent.toFixed(1)}%
                      </Txt>
                      <Txt variant="caption" color={t.colors.textMuted}>
                        {e.present}P · {e.left}L · {e.absent}A
                      </Txt>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 4 }}>
                Tap to see per-employee present, left and absent counts.
              </Txt>
            )}
          </Card>
        </>
      )}

      {phase.kind === 'done' ? (
        <Banner
          tone="success"
          title="Attendance report ready"
          detail={phase.fileName + ' — choose where to save or share it.'}
        />
      ) : null}
      {phase.kind === 'nowhere' ? (
        <Banner
          tone="warning"
          title="Report generated, but nothing can open it"
          detail={
            phase.fileName +
            ' was created, but this device has no app that can receive a spreadsheet. Install a file manager, Drive, or an Excel-compatible app and try again.'
          }
        />
      ) : null}
      {phase.kind === 'error' ? (
        <Banner tone="danger" title="Export failed" detail={phase.message} />
      ) : null}

      <Button
        title={phase.kind === 'working' ? 'GENERATING REPORT…' : 'DOWNLOAD EXCEL'}
        onPress={() => void handleExport()}
        icon="download"
        busy={phase.kind === 'working'}
        disabled={!hasData}
        gradient
        size="lg"
      />
      {!hasData && !loading ? (
        <Txt
          variant="caption"
          color={t.colors.textMuted}
          align="center"
          style={{ marginTop: 6 }}>
          Nothing to export for this month.
        </Txt>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  metaRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  employeeRow: { alignItems: 'center', flexDirection: 'row' },
});
