/**
 * ui.tsx
 * -----------------------------------------------------------------------------
 * Core presentational primitives. Every screen is built from these, which is
 * what keeps spacing, radius and typography identical across the app.
 *
 * These components render what they are given. No Bluetooth, attendance or
 * storage logic lives here.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type RefreshControlProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gradient } from './Gradient';
import { gradients } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { Icon, type IconName } from './Icon';

/**
 * The bar's own height above its gesture padding: 8 top + a 48px item.
 * Exported so screens and the navigator agree on the clearance rather than each
 * guessing at it.
 */
export const TAB_BAR_HEIGHT = 56;

/* ================================================================= Screen == */

export function Screen({
  children,
  scroll = true,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const base = { flex: 1, backgroundColor: t.colors.background };

  /**
   * The screen owns its own top inset.
   *
   * These screens run with headerShown:false so they can render their own
   * PageHeader. That removes the navigation header that would otherwise have
   * pushed content clear of the status bar, so without this the greeting
   * collides with the clock and battery icons. Measured, not guessed — the
   * inset differs across notch, punch-hole and edge-to-edge devices.
   */
  const paddingTop = insets.top + t.spacing.sm;

  /**
   * Clearance for the bottom tab bar, which is 62dp plus the gesture inset (see
   * useTabScreenOptions). A fixed value silently traps the last card under the
   * bar on gesture-nav devices, so it is derived from the same inset rather
   * than guessed. Harmless on the few screens that have no tab bar.
   */
  const paddingBottom = TAB_BAR_HEIGHT + Math.max(insets.bottom, t.spacing.x22) + t.spacing.xl;

  if (!scroll) {
    return <View style={[base, { paddingTop }, contentStyle]}>{children}</View>;
  }

  return (
    <ScrollView
      style={base}
      contentContainerStyle={[
        {
          paddingHorizontal: t.screenPadding,
          paddingTop,
          paddingBottom,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}>
      {children}
    </ScrollView>
  );
}

/* =================================================================== Text == */

type TextVariant = keyof ReturnType<typeof useTheme>['typography'];

export function Txt({
  children,
  variant = 'body',
  color,
  mono,
  align,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  variant?: TextVariant;
  color?: string;
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();

  /**
   * A caller that sets its own fontSize must NOT inherit the variant's
   * lineHeight.
   *
   * `variant` defaults to `body`, which carries lineHeight 19.5 for 13px
   * text. Any style that overrode only fontSize — a 9px eyebrow, a 9.5px tile
   * label — kept that 19.5 line box, roughly 60% taller than the design called
   * for, which quietly inflated every small label in the app and squeezed the
   * layout around them. Dropping it lets RN derive the line box from the font
   * metrics, which is what the design's unitless CSS resolves to anyway.
   *
   * An explicit lineHeight in the caller's own style still wins, so the
   * deliberate ones on display text (which stop Android clipping these faces)
   * are untouched.
   */
  const own = StyleSheet.flatten(style) as TextStyle | undefined;
  let base: TextStyle = t.typography[variant];
  if (own?.fontSize !== undefined && own.lineHeight === undefined) {
    const { lineHeight: _inherited, ...rest } = base;
    base = rest;
  }

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        base,
        { color: color ?? t.colors.textPrimary },
        mono ? { fontFamily: t.fonts.mono } : null,
        align ? { textAlign: align } : null,
        style,
      ]}>
      {children}
    </Text>
  );
}

/* =================================================================== Card == */

export function Card({
  children,
  style,
  accent,
  padded = true,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Left edge accent, used to signal state at a glance. */
  accent?: string;
  padded?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();

  const body = (
    <View
      style={[
        {
          backgroundColor: t.colors.surface,
          borderRadius: t.cardRadius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          padding: padded ? t.spacing.lg : 0,
          marginBottom: t.spacing.md,
          overflow: 'hidden',
        },
        /**
         * The accent stripe is ALWAYS 3px wide; only its colour changes.
         *
         * Toggling borderLeftWidth (3 -> unset) on Android corrupts the clip
         * path of this overflow-hidden view, and every child stops painting —
         * the card renders as an empty white rectangle. Found live when the
         * Host scanner card went blank the moment scanning stopped and its
         * accent was removed. A constant width with a transparent colour is
         * visually identical and never mutates the border geometry.
         */
        { borderLeftWidth: 3, borderLeftColor: accent ?? 'transparent' },
        t.shadow(1),
        style,
      ]}>
      {children}
    </View>
  );

  if (!onPress) {
    return body;
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  );
}

/* ========================================================== SectionHeader == */

export function SectionHeader({
  title,
  subtitle,
  action,
  onAction,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  /** Small text button on the right, e.g. "See all". */
  action?: string;
  onAction?: () => void;
  /** Arbitrary right-hand slot, e.g. a status badge. */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[styles.sectionHeader, { marginBottom: t.spacing.md }, style]}>
      <View style={{ flex: 1 }}>
        <Txt variant="title">{title}</Txt>
        {subtitle ? (
          <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Txt variant="captionMedium" color={t.colors.primary}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
      {right}
    </View>
  );
}

/* ================================================================= Button == */

export type ButtonVariant = 'primary' | 'success' | 'danger' | 'neutral' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  busy = false,
  fullWidth = true,
  size = 'md',
  style,
  gradient = false,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  /**
   * Indigo-to-violet ramp for the single most important action on a screen.
   * Deliberately not available per-variant: if two buttons on one screen both
   * gradient, neither reads as primary any more.
   */
  gradient?: boolean;
}) {
  const t = useTheme();

  const palette: Record<
    ButtonVariant,
    { bg: string; pressed: string; fg: string; border?: string }
  > = {
    primary: { bg: t.colors.primary, pressed: t.colors.primaryPressed, fg: t.colors.textOnAccent },
    success: { bg: t.colors.success, pressed: t.colors.successBorder, fg: t.colors.textOnAccent },
    danger: { bg: t.colors.error, pressed: t.colors.errorPressed, fg: t.colors.textOnAccent },
    neutral: {
      bg: t.colors.surfaceRaised,
      pressed: t.colors.surfaceMuted,
      fg: t.colors.textPrimary,
      border: t.colors.border,
    },
    ghost: { bg: 'transparent', pressed: t.colors.surfaceMuted, fg: t.colors.primary },
  };

  /**
   * Disabled buttons drop to a neutral surface rather than a dimmed brand
   * colour.
   *
   * Fading a saturated fill to 40% over a dark background still lands on a
   * solid-looking colour — a disabled green button read as an enabled green
   * button. Swapping the fill removes the ambiguity, and the muted label
   * reinforces it. Fill AND text both change, so it does not rely on one cue.
   */
  const p = disabled
    ? {
        bg: t.colors.surfaceMuted,
        pressed: t.colors.surfaceMuted,
        fg: t.colors.textMuted,
        border: t.colors.border,
      }
    : palette[variant];
  // 48dp minimum keeps every target comfortably above the accessibility floor.
  const height = size === 'sm' ? 40 : size === 'lg' ? 56 : 48;

  const label = busy ? (
    <ActivityIndicator color={p.fg} size="small" />
  ) : (
    <>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 18} color={p.fg} /> : null}
      <Text
        style={[t.typography.bodyStrong, { color: p.fg, marginLeft: icon ? t.spacing.sm : 0 }]}>
        {title}
      </Text>
    </>
  );

  if (gradient && !disabled) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || busy, busy }}
        style={({ pressed }) => [
          {
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
            // Dim on press rather than swapping stops: re-interpolating the
            // whole ramp on every touch would rebuild all 16 slices.
            opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          },
          style,
        ]}>
        <Gradient colors={gradients.primary} radius={t.buttonRadius} style={{ height }}>
          <View
            style={[
              styles.button,
              { flex: 1, paddingHorizontal: size === 'sm' ? t.spacing.md : t.spacing.xl },
            ]}>
            {label}
          </View>
        </Gradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          borderRadius: t.buttonRadius,
          backgroundColor: pressed ? p.pressed : p.bg,
          opacity: disabled ? 0.75 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          paddingHorizontal: size === 'sm' ? t.spacing.md : t.spacing.xl,
          borderWidth: p.border ? StyleSheet.hairlineWidth : 0,
          borderColor: p.border,
        },
        style,
      ]}>
      {label}
    </Pressable>
  );
}

/* ================================================================ DataRow == */

/** Label/value pair for diagnostic detail. Not for primary content. */
export function DataRow({
  label,
  value,
  mono = true,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.dataRow, { paddingVertical: 5 }]}>
      <Txt variant="caption" color={t.colors.textMuted} style={{ flexShrink: 0 }}>
        {label}
      </Txt>
      <Text
        numberOfLines={2}
        style={[
          t.typography.caption,
          {
            color: valueColor ?? t.colors.textSecondary,
            flex: 1,
            textAlign: 'right',
            marginLeft: t.spacing.md,
          },
          mono ? { fontFamily: t.fonts.mono, fontSize: 12 } : null,
        ]}>
        {value}
      </Text>
    </View>
  );
}

/* ================================================================= Banner == */

export function Banner({
  tone,
  title,
  detail,
  actionLabel,
  onAction,
  icon,
}: {
  tone: 'danger' | 'warning' | 'info' | 'success';
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  const t = useTheme();
  const map = {
    danger: { fg: t.colors.error, bg: t.colors.errorSoft, defaultIcon: 'circle-alert' as IconName },
    warning: { fg: t.colors.warning, bg: t.colors.warningSoft, defaultIcon: 'triangle-alert' as IconName },
    info: { fg: t.colors.info, bg: t.colors.infoSoft, defaultIcon: 'info' as IconName },
    success: { fg: t.colors.success, bg: t.colors.successSoft, defaultIcon: 'circle-check' as IconName },
  };
  const c = map[tone];

  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderRadius: t.cardRadius,
        borderLeftWidth: 3,
        borderLeftColor: c.fg,
        padding: t.spacing.lg,
        marginBottom: t.spacing.md,
      }}>
      <View style={styles.rowCenter}>
        <Icon name={icon ?? c.defaultIcon} size={t.iconSize.sm} color={c.fg} />
        <Txt variant="bodyStrong" color={c.fg} style={{ marginLeft: t.spacing.sm, flex: 1 }}>
          {title}
        </Txt>
      </View>
      {detail ? (
        <Txt variant="caption" color={t.colors.textSecondary} style={{ marginTop: 6 }}>
          {detail}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: t.spacing.md, alignSelf: 'flex-start' }}>
          <Button title={actionLabel} onPress={onAction} variant="neutral" size="sm" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

/* ================================================================ Divider == */

export function Divider({ spacing: gap }: { spacing?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: t.colors.border,
        marginVertical: gap ?? t.spacing.md,
      }}
    />
  );
}

/* ============================================================ ProgressBar == */

export function ProgressBar({ progress, color }: { progress: number; color?: string }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View
      style={{
        height: 6,
        backgroundColor: t.colors.surfaceMuted,
        borderRadius: 3,
        overflow: 'hidden',
      }}>
      <View
        style={{
          height: 6,
          width: `${(pct * 100).toFixed(1)}%` as DimensionValue,
          backgroundColor: color ?? t.colors.primary,
          borderRadius: 3,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { alignItems: 'center', flexDirection: 'row' },
  button: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rowCenter: { alignItems: 'center', flexDirection: 'row' },
});
