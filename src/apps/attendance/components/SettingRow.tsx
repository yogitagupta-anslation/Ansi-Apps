/**
 * SettingRow.tsx
 * -----------------------------------------------------------------------------
 * Compact settings rows grouped into a card, rather than one large card per
 * setting. Grouping is what makes a settings screen scannable.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { toneColors, type BadgeTone } from './StatusBadge';
import { useTheme } from '../theme/ThemeContext';
import { Icon, type IconName } from './Icon';
import { Txt } from './ui';

/** Card that groups rows, with hairline separators between them. */
export function SettingGroup({
  title,
  children,
  footer,
}: {
  title?: string;
  children: React.ReactNode;
  footer?: string;
}) {
  const t = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={{ marginBottom: t.spacing.lg }}>
      {title ? (
        <Txt
          variant="groupLabel"
          color={t.colors.textMuted}
          style={{ marginBottom: 10, marginTop: 24 }}>
          {title.toUpperCase()}
        </Txt>
      ) : null}

      <View
        style={[
          {
            backgroundColor: t.colors.surface,
            // The approved settings card radius, a step softer than a
            // content card.
            borderRadius: 20,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.colors.border,
            overflow: 'hidden',
          },
          t.shadow(1),
        ]}>
        {items.map((child, index) => (
          <View key={index}>
            {index > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: t.colors.border,
                }}
              />
            ) : null}
            {child}
          </View>
        ))}
      </View>

      {footer ? (
        <Txt
          variant="caption"
          color={t.colors.textMuted}
          style={{ marginTop: t.spacing.sm, marginLeft: 2 }}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );
}

export function SettingRow({
  icon,
  iconTone = 'neutral',
  title,
  subtitle,
  value,
  valueTone,
  onPress,
  toggle,
  destructive = false,
  showChevron,
}: {
  icon?: IconName;
  iconTone?: BadgeTone;
  title: string;
  subtitle?: string;
  /** Right-aligned value text, e.g. the current theme. */
  value?: string;
  valueTone?: BadgeTone;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (next: boolean) => void };
  destructive?: boolean;
  showChevron?: boolean;
}) {
  const t = useTheme();
  const tone = destructive ? toneColors('danger', t) : toneColors(iconTone, t);
  const titleColor = destructive ? t.colors.error : t.colors.textPrimary;
  const chevron = showChevron ?? (!!onPress && !toggle);

  const body = (
    <View style={[styles.row, { gap: 13, padding: t.spacing.x14 }]}>
      {icon ? (
        <View
          style={[styles.iconWrap, { backgroundColor: tone.bg, borderRadius: t.radius.tile }]}>
          <Icon name={icon} size={17} color={tone.fg} />
        </View>
      ) : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="heading" color={titleColor}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt style={[styles.subtitle, { color: t.colors.textMuted }]}>{subtitle}</Txt>
        ) : null}
      </View>

      {value ? (
        <Txt
          style={[
            styles.value,
            { color: valueTone ? toneColors(valueTone, t).fg : t.colors.textMuted },
          ]}>
          {value}
        </Txt>
      ) : null}

      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ false: t.colors.surfaceMuted, true: t.colors.primary }}
          thumbColor={t.colors.textOnAccent}
          accessibilityLabel={title}
        />
      ) : null}

      {chevron ? (
        <Icon name="chevron-right" size={15} color={t.colors.textMuted} />
      ) : null}
    </View>
  );

  if (!onPress) {
    return body;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.colors.surfaceMuted : 'transparent',
      })}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 52 keeps every row above the 44dp accessibility floor.
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 52 },
  iconWrap: { alignItems: 'center', flexShrink: 0, height: 34, justifyContent: 'center', width: 34 },
  subtitle: { fontSize: 11.5, marginTop: 2 },
  // Named family, not a numeric weight: Android does not synthesise weights
  // for a custom font, so fontWeight '600' would silently render Regular.
  value: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12.5 },
});
