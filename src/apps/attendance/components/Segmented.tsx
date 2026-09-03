/**
 * Segmented.tsx
 * -----------------------------------------------------------------------------
 * Two-or-more-way exclusive toggle ("Day view" / "Summary").
 *
 * Distinct from FilterChips: chips scroll horizontally and can be many, a
 * segmented control is a small fixed set shown as one unit. Using chips for a
 * binary choice loses the "these are alternatives" reading.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          padding: 3,
          marginBottom: t.spacing.lg,
        },
      ]}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: active ? t.colors.success : 'transparent',
                borderRadius: t.radius.sm,
                opacity: pressed && !active ? 0.6 : 1,
              },
            ]}>
            <Txt
              variant="captionMedium"
              color={active ? t.colors.textOnAccent : t.colors.textSecondary}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  segment: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 9 },
});
