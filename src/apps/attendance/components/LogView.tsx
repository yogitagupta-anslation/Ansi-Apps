/**
 * LogView.tsx
 * -----------------------------------------------------------------------------
 * Renders the in-app log buffer.
 *
 * This matters more than usual here: the system is tested by walking two phones
 * around a room, where `adb logcat` is not visible. Every [BLE] / [SCAN] /
 * [ADVERTISE] / [ATTENDANCE] line that reaches the console also lands here.
 *
 * These are REAL log lines emitted by the running code. Nothing is generated
 * for display.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { log, type LogEntry, type LogTag } from '../utils/logger';
import { Txt } from './ui';

export function LogView({ maxHeight = 280 }: { maxHeight?: number }) {
  const t = useTheme();
  const [entries, setEntries] = useState<LogEntry[]>(log.getEntries());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => log.subscribe(setEntries), []);

  const tagColor: Record<LogTag, string> = {
    BLE: t.colors.info,
    SCAN: t.colors.accent,
    ADVERTISE: t.colors.warning,
    PERMISSION: t.colors.textMuted,
    ATTENDANCE: t.colors.success,
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: t.mode === 'dark' ? '#05080C' : t.colors.surfaceMuted,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
        },
      ]}>
      <View
        style={[
          styles.header,
          { backgroundColor: t.colors.surface, borderBottomColor: t.colors.border },
        ]}>
        <Txt variant="overline" color={t.colors.textMuted}>
          BLE LOG ({entries.length})
        </Txt>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setCollapsed(!collapsed)} hitSlop={10}>
            <Txt variant="overline" color={t.colors.primary}>
              {collapsed ? 'SHOW' : 'HIDE'}
            </Txt>
          </Pressable>
          <Pressable onPress={() => log.clear()} hitSlop={10} style={{ marginLeft: 16 }}>
            <Txt variant="overline" color={t.colors.primary}>
              CLEAR
            </Txt>
          </Pressable>
        </View>
      </View>

      {collapsed ? null : (
        <ScrollView style={{ maxHeight, padding: 10 }} nestedScrollEnabled>
          {entries.length === 0 ? (
            <Txt variant="caption" color={t.colors.textMuted}>
              No log output yet.
            </Txt>
          ) : (
            // Newest first, so the latest line is always at the top and no
            // auto-scrolling is needed.
            entries.map(entry => (
              <View key={entry.id} style={styles.line}>
                <Text style={[styles.time, { color: t.colors.textMuted, fontFamily: t.fonts.mono }]}>
                  {entry.time}
                </Text>
                <Text
                  style={[
                    styles.tag,
                    { color: tagColor[entry.tag] ?? t.colors.textMuted, fontFamily: t.fonts.mono },
                  ]}>
                  [{entry.tag}]
                </Text>
                <Text
                  style={[
                    styles.message,
                    {
                      fontFamily: t.fonts.mono,
                      color:
                        entry.level === 'error'
                          ? t.colors.error
                          : entry.level === 'warn'
                          ? t.colors.warning
                          : t.colors.textSecondary,
                    },
                  ]}>
                  {entry.message}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, overflow: 'hidden' },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerActions: { flexDirection: 'row' },
  line: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 3 },
  time: { fontSize: 9, marginRight: 4 },
  tag: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, marginRight: 4 },
  message: { flex: 1, fontSize: 9, lineHeight: 13, minWidth: 180 },
});
