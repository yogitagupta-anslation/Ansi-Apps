import React from 'react';
import {
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
import {SafeAreaView, type Edge} from 'react-native-safe-area-context';

import {radius, spacing, type, useHitchTheme, type HitchTheme} from '../../config/theme';

/**
 * The handful of pieces every Hitch screen is built from.
 *
 * Kept in one file on purpose. Six primitives spread across six files is a directory to
 * navigate before anything can be read; at this size the whole vocabulary fitting on one
 * screen is worth more than the tidiness of separate modules.
 */

export function useT(): HitchTheme {
  return useHitchTheme();
}

// ---------------------------------------------------------------- text

type TextProps = React.ComponentProps<typeof Text> & {
  /** Semantic size. `display` for a screen's one big line, `caption` for asides. */
  variant?: keyof typeof type;
  tone?: 'default' | 'dim' | 'faint' | 'accent' | 'ok' | 'warn' | 'error' | 'onAccent';
};

export function T({variant = 'body', tone = 'default', style, ...rest}: TextProps) {
  const t = useT();
  const colours: Record<NonNullable<TextProps['tone']>, string> = {
    default: t.text,
    dim: t.textDim,
    faint: t.textFaint,
    accent: t.accent,
    ok: t.ok,
    warn: t.warn,
    error: t.error,
    onAccent: t.onAccent,
  };
  return <Text {...rest} style={[type[variant], {color: colours[tone]}, style]} />;
}

// ---------------------------------------------------------------- screen

export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  return (
    <SafeAreaView edges={edges} style={[{flex: 1, backgroundColor: t.bg}, style]}>
      {children}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- buttons

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  glyph,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  glyph?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const fills: Record<string, ViewStyle> = {
    primary: {backgroundColor: disabled ? t.surfaceAlt : t.accent},
    secondary: {backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border},
    danger: {backgroundColor: 'transparent', borderWidth: 1, borderColor: t.error},
    ghost: {backgroundColor: 'transparent'},
  };
  const inks: Record<string, string> = {
    primary: disabled ? t.textFaint : t.onAccent,
    secondary: t.text,
    danger: t.error,
    ghost: t.textDim,
  };
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      accessibilityLabel={label}
      style={({pressed}) => [
        {
          height: 52,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: pressed && !disabled ? 0.85 : 1,
        },
        fills[kind],
        style,
      ]}>
      {glyph ? <Text style={{fontSize: 17}}>{glyph}</Text> : null}
      <Text style={[type.heading, {color: inks[kind]}]}>{label}</Text>
    </Pressable>
  );
}

/** A row that behaves like a button but looks like content. */
export function Row({
  glyph,
  title,
  detail,
  right,
  onPress,
  tone,
}: {
  glyph?: string;
  title: string;
  detail?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  tone?: 'default' | 'error';
}) {
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={({pressed}) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: 14,
        paddingHorizontal: spacing.lg,
        opacity: pressed && onPress ? 0.7 : 1,
      })}>
      {glyph ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            backgroundColor: t.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{fontSize: 18}}>{glyph}</Text>
        </View>
      ) : null}
      <View style={{flex: 1}}>
        <T variant="body" tone={tone === 'error' ? 'error' : 'default'}>
          {title}
        </T>
        {detail ? (
          <T variant="caption" tone="faint" style={{marginTop: 2}}>
            {detail}
          </T>
        ) : null}
      </View>
      {right ?? (onPress ? <T variant="body" tone="faint">›</T> : null)}
    </Pressable>
  );
}

export function Divider() {
  const t = useT();
  return <View style={{height: StyleSheet.hairlineWidth, backgroundColor: t.divider}} />;
}

export function SectionLabel({children}: {children: React.ReactNode}) {
  return (
    <T
      variant="overline"
      tone="faint"
      style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm}}>
      {children}
    </T>
  );
}

// ---------------------------------------------------------------- inputs

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'words' | 'characters';
  maxLength?: number;
  hint?: string;
}) {
  const t = useT();
  return (
    <View style={{marginBottom: spacing.lg}}>
      <T variant="label" tone="dim" style={{marginBottom: 6}}>
        {label}
      </T>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.textFaint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={{
          height: 50,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.surface,
          paddingHorizontal: 14,
          color: t.text,
          ...type.body,
        }}
      />
      {hint ? (
        <T variant="caption" tone="faint" style={{marginTop: 6}}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** A row of choices where exactly one is on. */
export function Chips({
  options,
  selected,
  onToggle,
  multi,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  multi?: boolean;
}) {
  const t = useT();
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      {options.map(option => {
        const on = selected.includes(option);
        return (
          <Pressable
            key={option}
            onPress={() => onToggle(option)}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{selected: on}}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? 'transparent' : t.border,
              backgroundColor: on ? t.accentSoft : 'transparent',
            }}>
            <Text style={[type.label, {color: on ? t.accent : t.textDim}]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- containers

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: t.border,
          padding: spacing.lg,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/**
 * A badge that says something is not real yet.
 *
 * Used wherever simulated vehicles are shown. A prototype that looks exactly like the
 * finished thing is how a demo gets mistaken for a working product, and the vehicles on
 * the map are the one thing a viewer cannot check by eye.
 */
export function SimulatedBadge({style}: {style?: StyleProp<ViewStyle>}) {
  const t = useT();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-start',
          paddingHorizontal: 9,
          paddingVertical: 4,
          borderRadius: radius.pill,
          backgroundColor: t.isDark ? 'rgba(224,164,88,0.16)' : 'rgba(168,98,14,0.10)',
        },
        style,
      ]}>
      <View style={{width: 5, height: 5, borderRadius: 3, backgroundColor: t.warn}} />
      <Text style={[type.caption, {color: t.warn, fontWeight: '600'}]}>Simulated</Text>
    </View>
  );
}

/** Screen-level heading with an optional back affordance. */
export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
      }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <T variant="title" tone="dim">
            ‹
          </T>
        </Pressable>
      ) : null}
      <View style={{flex: 1}}>
        <T variant="title">{title}</T>
        {subtitle ? (
          <T variant="caption" tone="faint" style={{marginTop: 2}}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Scroll({children}: {children: React.ReactNode}) {
  return (
    <ScrollView
      contentContainerStyle={{padding: spacing.lg, paddingBottom: spacing.xxl}}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}
