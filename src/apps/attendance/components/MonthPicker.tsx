/**
 * MonthPicker.tsx
 * -----------------------------------------------------------------------------
 * Month selector for the attendance reports: arrows to step, tap the label for
 * the full list.
 *
 * Only months that HOLD RECORDS are offered. Stepping past either end is
 * disabled rather than silently ignored, so the arrows never look broken — and
 * a month with no data can never be selected, which removes an entire class of
 * "why is this report empty" confusion.
 * -----------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { monthLabelOf } from '../attendance/monthlyReport';
import { useTheme } from '../theme/ThemeContext';
import { Icon } from './Icon';
import { Txt } from './ui';

export function MonthPicker({
  months,
  selected,
  onSelect,
}: {
  /** YYYY-MM keys, newest first. */
  months: string[];
  selected: string;
  onSelect: (monthKey: string) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const index = months.indexOf(selected);
  // months is newest-first, so "previous month" is the NEXT array entry.
  const hasOlder = index >= 0 && index < months.length - 1;
  const hasNewer = index > 0;

  return (
    <>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            marginBottom: t.spacing.lg,
          },
        ]}>
        <Pressable
          onPress={() => hasOlder && onSelect(months[index + 1])}
          disabled={!hasOlder}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          accessibilityState={{ disabled: !hasOlder }}
          style={({ pressed }) => [
            styles.arrow,
            { opacity: !hasOlder ? 0.25 : pressed ? 0.5 : 1 },
          ]}>
          <Icon name="chevron-left" size={20} color={t.colors.textSecondary} />
        </Pressable>

        <Pressable
          onPress={() => setOpen(true)}
          style={styles.label}
          accessibilityRole="button"
          accessibilityLabel={'Selected month ' + monthLabelOf(selected) + '. Tap to change.'}>
          <Txt variant="bodyStrong">{monthLabelOf(selected)}</Txt>
          <Icon name="chevron-down" size={16} color={t.colors.textMuted} />
        </Pressable>

        <Pressable
          onPress={() => hasNewer && onSelect(months[index - 1])}
          disabled={!hasNewer}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: !hasNewer }}
          style={({ pressed }) => [
            styles.arrow,
            { opacity: !hasNewer ? 0.25 : pressed ? 0.5 : 1 },
          ]}>
          <Icon name="chevron-right" size={20} color={t.colors.textSecondary} />
        </Pressable>
      </View>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent>
        <Pressable
          style={[styles.scrim, { backgroundColor: t.colors.scrim }]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close month list"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
              paddingBottom: insets.bottom + t.spacing.lg,
              paddingHorizontal: t.spacing.xl,
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: t.colors.borderStrong }]} />
          <Txt variant="title" style={{ marginBottom: t.spacing.md }}>
            Select month
          </Txt>
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            {months.map(key => {
              const active = key === selected;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    onSelect(key);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: pressed ? t.colors.surfaceRaised : 'transparent',
                      borderRadius: t.radius.sm,
                    },
                  ]}>
                  <Txt
                    variant="body"
                    color={active ? t.colors.textPrimary : t.colors.textSecondary}
                    style={{ flex: 1 }}>
                    {monthLabelOf(key)}
                  </Txt>
                  {active ? (
                    <Icon name="check" size={18} color={t.colors.success} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  arrow: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  label: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' },
  scrim: { flex: 1 },
  sheet: { paddingTop: 8 },
  grabber: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 38 },
  option: { alignItems: 'center', flexDirection: 'row', minHeight: 48, paddingHorizontal: 6 },
});
