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
          variant="overline"
          color={t.colors.textMuted}
          style={{ marginBottom: t.spacing.sm, marginLeft: 2 }}>
          {title.toUpperCase()}
        </Txt>
      ) : null}

      <View
        style={[
          {
            backgroundColor: t.colors.surface,
            borderRadius: t.cardRadius,
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
                  // Inset so the separator starts past the icon, as in iOS/Material lists.
                  marginLeft: 56,
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
    <View style={[styles.row, { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md }]}>
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: tone.bg, borderRadius: t.radius.sm },
          ]}>
          <Icon name={icon} size={16} color={tone.fg} />
        </View>
      ) : null}

      <View style={{ flex: 1, marginLeft: icon ? t.spacing.md : 0 }}>
        <Txt variant="bodyMedium" color={titleColor}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 1 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>

      {value ? (
        <Txt
          variant="captionMedium"
          color={valueTone ? toneColors(valueTone, t).fg : t.colors.textSecondary}
          style={{ marginLeft: t.spacing.sm }}>
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
        <Icon
          name="chevron-right"
          size={18}
          color={t.colors.textMuted}
          style={{ marginLeft: 6 } as object}
        />
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
  iconWrap: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
});
