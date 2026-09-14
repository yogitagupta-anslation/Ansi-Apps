/**
 * The small shared vocabulary: button, chip, card, field, empty state.
 *
 * Deliberately few and deliberately plain. The visual interest in this product
 * belongs to the map and to people's faces; chrome that competes with them is a
 * bug. Everything here is a neutral surface with one accent available.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space, typography } from '../theme/tokens';

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

type TextVariant = keyof typeof typography;
type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'inverse';

export function AppText({
  children,
  variant = 'body',
  tone = 'primary',
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}): React.ReactElement {
  const { colors } = useTheme();
  const color =
    tone === 'secondary'
      ? colors.textSecondary
      : tone === 'tertiary'
        ? colors.textTertiary
        : tone === 'accent'
          ? colors.accent
          : tone === 'danger'
            ? colors.danger
            : tone === 'inverse'
              ? colors.textInverse
              : colors.textPrimary;

  return (
    <Text style={[typography[variant], { color }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  full,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Spoken instead of the visible label, for when the word alone is ambiguous.
   *
   * "Accept" is unmistakable beside a person's face and meaningless in a
   * screen-reader's linear list of six identical buttons — this is what lets a
   * row say "Accept request from Anja Park" without printing it.
   */
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  const background =
    variant === 'primary'
      ? colors.accent
      : variant === 'secondary'
        ? colors.surfaceElevated
        : variant === 'danger'
          ? 'transparent'
          : 'transparent';

  const textColor =
    variant === 'primary'
      ? colors.accentText
      : variant === 'danger'
        ? colors.danger
        : colors.textPrimary;

  const borderColor =
    variant === 'secondary'
      ? colors.border
      : variant === 'danger'
        ? colors.danger
        : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor,
          borderWidth: variant === 'primary' ? 0 : 1,
          // 0.45 put disabled labels under the contrast floor — legible enough
          // to notice, not to read. A disabled control still has to say what it
          // is, especially when it is reporting a completed action.
          opacity: disabled ? 0.7 : pressed ? 0.82 : 1,
          flex: full ? 1 : undefined,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon ? <Text style={[styles.buttonIcon, { color: textColor }]}>{icon}</Text> : null}
          <Text style={[typography.bodyStrong, { color: textColor }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Chip
 * ------------------------------------------------------------------ */

export function Chip({
  label,
  selected,
  onPress,
  color,
  compact,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  compact?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const tint = color ?? colors.accent;

  const body = (
    <View
      style={[
        styles.chip,
        compact && styles.chipCompact,
        {
          backgroundColor: selected ? tint : colors.surfaceElevated,
          borderColor: selected ? tint : colors.border,
        },
      ]}
    >
      <Text
        style={[
          compact ? typography.micro : typography.caption,
          { color: selected ? colors.accentText : colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
    >
      {body}
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {children}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export function Card({
  children,
  onPress,
  style,
  raised,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const content = (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        raised ? elevation.low : null,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {content}
    </Pressable>
  );
}

export function Divider(): React.ReactElement {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </AppText>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button">
          <AppText variant="caption" tone="accent">
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Form
 * ------------------------------------------------------------------ */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  multiline,
  keyboardType,
  autoCapitalize = 'sentences',
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'url';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  hint?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={styles.field}>
      <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
        {label.toUpperCase()}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[
          styles.input,
          typography.body,
          {
            backgroundColor: colors.surfaceSunken,
            borderColor: error ? colors.danger : colors.border,
            color: colors.textPrimary,
            minHeight: multiline ? 88 : 46,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="tertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

export function EmptyState({
  emoji,
  title,
  body,
  actionLabel,
  onAction,
}: {
  emoji: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <AppText variant="heading" style={styles.centered}>
        {title}
      </AppText>
      <AppText variant="body" tone="secondary" style={[styles.centered, styles.emptyBody]}>
        {body}
      </AppText>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" />
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      {label ? (
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonIcon: { fontSize: 15 },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 190,
  },
  chipCompact: { paddingHorizontal: space.sm, paddingVertical: 3 },
  chipRow: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  sectionTitle: { letterSpacing: 0.8 },
  field: { gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.sm },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.md,
  },
  emptyEmoji: { fontSize: 40 },
  emptyBody: { maxWidth: 280 },
  centered: { textAlign: 'center' },
  loading: { padding: space.xl, alignItems: 'center', gap: space.sm },
});
