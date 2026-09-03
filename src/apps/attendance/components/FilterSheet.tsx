/**
 * FilterSheet.tsx
 * -----------------------------------------------------------------------------
 * Bottom sheet holding the status and department filters.
 *
 * Filters apply LIVE as they are tapped rather than on an Apply press. The
 * "Apply" button therefore just dismisses — the work is already done, and the
 * list behind the sheet updates as you go, so the effect of a choice is visible
 * before committing to it.
 *
 * "Reset" is the escape hatch, and the header shows how many filters are
 * active, because a filtered list that looks empty is otherwise indistinguishable
 * from a list that genuinely has no data.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeContext';
import { Button, Txt } from './ui';

export type StatusFilter = 'ALL' | 'PRESENT' | 'LEFT' | 'ABSENT';

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PRESENT', label: 'Present' },
  { key: 'LEFT', label: 'Left' },
  { key: 'ABSENT', label: 'Absent' },
];

export function FilterSheet({
  visible,
  onClose,
  status,
  onStatusChange,
  department,
  onDepartmentChange,
  departments,
}: {
  visible: boolean;
  onClose: () => void;
  status: StatusFilter;
  onStatusChange: (next: StatusFilter) => void;
  department: string;
  onDepartmentChange: (next: string) => void;
  departments: string[];
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const activeCount = (status !== 'ALL' ? 1 : 0) + (department ? 1 : 0);

  const reset = () => {
    onStatusChange('ALL');
    onDepartmentChange('');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent>
      {/* Tapping the scrim dismisses — expected of a sheet, and it means the
          filters are never a trap on a device with no back gesture. */}
      <Pressable
        style={[styles.scrim, { backgroundColor: t.colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close filters"
      />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingBottom: insets.bottom + t.spacing.lg,
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: t.colors.borderStrong }]} />

        <View style={[styles.header, { paddingHorizontal: t.spacing.xl }]}>
          <View style={{ flex: 1 }}>
            <Txt variant="title">Filters</Txt>
            {activeCount > 0 ? (
              <Txt variant="caption" color={t.colors.primary} style={{ marginTop: 2 }}>
                {activeCount} active
              </Txt>
            ) : null}
          </View>
          <Pressable onPress={reset} hitSlop={10} accessibilityRole="button">
            <Txt variant="captionMedium" color={activeCount > 0 ? t.colors.primary : t.colors.textMuted}>
              Reset
            </Txt>
          </Pressable>
        </View>

        <ScrollView
          style={{ maxHeight: 420 }}
          contentContainerStyle={{ paddingHorizontal: t.spacing.xl }}
          showsVerticalScrollIndicator={false}>
          <Txt variant="overline" color={t.colors.textMuted} style={{ marginBottom: t.spacing.sm }}>
            STATUS
          </Txt>
          {STATUS_OPTIONS.map(o => (
            <RadioRow
              key={o.key}
              label={o.label}
              selected={status === o.key}
              onPress={() => onStatusChange(o.key)}
            />
          ))}

          <Txt
            variant="overline"
            color={t.colors.textMuted}
            style={{ marginBottom: t.spacing.sm, marginTop: t.spacing.xl }}>
            DEPARTMENT
          </Txt>
          <RadioRow
            label="All departments"
            selected={department === ''}
            onPress={() => onDepartmentChange('')}
          />
          {departments.length === 0 ? (
            <Txt variant="caption" color={t.colors.textMuted} style={{ paddingVertical: 10 }}>
              No departments set on any employee yet.
            </Txt>
          ) : (
            departments.map(d => (
              <RadioRow
                key={d}
                label={d}
                selected={department === d}
                onPress={() => onDepartmentChange(d)}
              />
            ))
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.lg }}>
          <Button title="APPLY FILTERS" onPress={onClose} gradient size="lg" />
        </View>
      </View>
    </Modal>
  );
}

/* --------------------------------------------------------------- RadioRow -- */

function RadioRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.radioRow,
        {
          backgroundColor: pressed ? t.colors.surfaceRaised : 'transparent',
          borderRadius: t.radius.sm,
        },
      ]}>
      <Txt variant="body" color={selected ? t.colors.textPrimary : t.colors.textSecondary} style={{ flex: 1 }}>
        {label}
      </Txt>
      {/* A filled check rather than a bare ring: selection stays legible in
          greyscale and to a screen reader via accessibilityState. */}
      <Icon
        name={selected ? 'circle-check' : 'circle'}
        size={20}
        color={selected ? t.colors.success : t.colors.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { paddingTop: 8 },
  grabber: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 12, width: 38 },
  header: { alignItems: 'center', flexDirection: 'row', marginBottom: 18 },
  radioRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 46,
    paddingHorizontal: 4,
  },
});
