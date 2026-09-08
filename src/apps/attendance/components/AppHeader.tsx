/**
 * AppHeader.tsx
 * -----------------------------------------------------------------------------
 * Dashboard header: greeting, identity, and an optional right-hand slot.
 *
 * The greeting is derived from the device clock rather than stored anywhere —
 * it is presentation, not data.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { EmployeeAvatar } from './EmployeeAvatar';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

/** "Good morning" / "Good afternoon" / "Good evening" from the local clock. */
export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

export function AppHeader({
  name,
  subtitle,
  avatarSeed,
  right,
  showAvatar = true,
}: {
  /** Person or place this device represents. */
  name: string;
  /** Employee ID, Host ID, or a short descriptor. */
  subtitle?: string;
  avatarSeed?: string;
  right?: React.ReactNode;
  showAvatar?: boolean;
}) {
  const t = useTheme();

  return (
    <View style={[styles.wrap, { marginBottom: t.spacing.xl }]}>
      {showAvatar ? (
        <View style={{ marginRight: t.spacing.md }}>
          <EmployeeAvatar name={name} employeeId={avatarSeed ?? name} size={46} />
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <Txt variant="caption" color={t.colors.textMuted}>
          {greetingFor()}
        </Txt>
        <Txt variant="title" numberOfLines={1} style={{ marginTop: 1 }}>
          {name}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" color={t.colors.textMuted} numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>

      {right}
    </View>
  );
}

/** Simple page title for non-dashboard screens. */
export function PageHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /**
   * Renders a back arrow before the title. Pushed screens (Scanner, employee
   * details, add employee, profile) run with the native header hidden so they
   * can own their layout — without this the system back gesture is the ONLY
   * way out, which is invisible. Tab-root screens omit it: they have nowhere
   * to go back to.
   */
  onBack?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.wrap, { marginBottom: t.spacing.x18 }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [
            styles.back,
            {
              backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
              borderColor: t.colors.border,
              borderRadius: t.radius.pill,
              marginRight: t.spacing.md,
            },
          ]}>
          <Icon name="chevron-left" size={18} color={t.colors.textPrimary} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt variant="display">{title}</Txt>
        {subtitle ? (
          <Txt variant="subtitle" color={t.colors.textMuted} style={{ marginTop: 3 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', flexDirection: 'row' },
  back: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
});
