/**
 * Timeline.tsx
 * -----------------------------------------------------------------------------
 * Vertical event list with a dot per entry and a connecting rail: "Checked in
 * -> Last seen -> Status".
 *
 * The rail is drawn per-row rather than as one absolute line behind the list,
 * because rows have variable height (a wrapped detail line makes a row taller)
 * and a single fixed line would either fall short or overshoot.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

export interface TimelineEntry {
  label: string;
  /** Primary value, e.g. a time. Rendered emphasised. */
  value: string;
  /** Optional trailing context, e.g. "Detected by Host". */
  detail?: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const t = useTheme();

  const toneColor = (tone: TimelineEntry['tone']) =>
    tone === 'success'
      ? t.colors.success
      : tone === 'warning'
      ? t.colors.warning
      : tone === 'danger'
      ? t.colors.error
      : t.colors.textMuted;

  return (
    <View>
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        return (
          <View key={e.label + i} style={styles.row}>
            {/* Rail column: dot, then the connector down to the next dot. */}
            <View style={styles.rail}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: toneColor(e.tone),
                  marginTop: 5,
                }}
              />
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: StyleSheet.hairlineWidth * 2,
                    backgroundColor: t.colors.border,
                    marginTop: 4,
                    marginBottom: -4,
                  }}
                />
              ) : null}
            </View>

            <View style={[styles.content, { paddingBottom: last ? 0 : t.spacing.lg }]}>
              <Txt variant="bodyMedium">{e.label}</Txt>
              <View style={styles.valueRow}>
                <Txt variant="captionMedium" color={toneColor(e.tone)}>
                  {e.value}
                </Txt>
                {e.detail ? (
                  <Txt variant="caption" color={t.colors.textMuted} style={{ marginLeft: 8 }}>
                    {e.detail}
                  </Txt>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  rail: { alignItems: 'center', marginRight: 12, width: 10 },
  content: { flex: 1 },
  valueRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', marginTop: 1 },
});
