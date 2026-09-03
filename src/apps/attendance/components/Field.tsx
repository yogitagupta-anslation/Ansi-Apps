/**
 * Field.tsx
 * -----------------------------------------------------------------------------
 * Labelled text input, plus a picker variant for a fixed set of choices.
 *
 * Previously every form hand-rolled its own TextInput with local styles, which
 * is how the add-employee form and the profile form drifted apart. One
 * component means one focus ring, one error treatment and one height.
 * -----------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  mono = false,
  multiline = false,
  autoCapitalize = 'sentences',
  keyboardType,
  editable = true,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Explanatory text under the input. Suppressed when `error` is set. */
  hint?: string;
  error?: string | null;
  mono?: boolean;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? t.colors.error
    : focused
    ? t.colors.primary
    : t.colors.border;

  return (
    <View style={{ marginBottom: t.spacing.lg }}>
      <Txt variant="label" color={t.colors.textSecondary} style={{ marginBottom: 6 }}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        editable={editable}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          t.typography.body,
          styles.input,
          {
            backgroundColor: editable ? t.colors.surfaceRaised : t.colors.surfaceMuted,
            borderColor,
            // Grows by 1 on focus, so the ring does not shift the layout.
            borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
            borderRadius: t.radius.md,
            color: editable ? t.colors.textPrimary : t.colors.textMuted,
            minHeight: multiline ? 88 : 48,
            paddingTop: multiline ? 12 : 0,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          mono ? { fontFamily: t.fonts.mono } : null,
        ]}
      />
      {error ? (
        <Txt variant="caption" color={t.colors.error} style={{ marginTop: 5 }}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" color={t.colors.textMuted} style={{ lineHeight: 17, marginTop: 5 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ PickerField -- */

/**
 * Inline single-select. Renders the options as a wrapped row of chips rather
 * than opening a native picker: the option sets here are short (a handful of
 * departments), and a modal for four choices is more friction than it removes.
 */
export function PickerField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  hint,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={{ marginBottom: t.spacing.lg }}>
      <Txt variant="label" color={t.colors.textSecondary} style={{ marginBottom: 6 }}>
        {label}
      </Txt>

      <Pressable
        onPress={() => setOpen(o => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={[
          styles.picker,
          {
            backgroundColor: t.colors.surfaceRaised,
            borderColor: open ? t.colors.primary : t.colors.border,
            borderWidth: open ? 1.5 : StyleSheet.hairlineWidth,
            borderRadius: t.radius.md,
          },
        ]}>
        <Txt
          variant="body"
          color={value ? t.colors.textPrimary : t.colors.textMuted}
          style={{ flex: 1 }}>
          {value || placeholder}
        </Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.colors.textMuted} />
      </Pressable>

      {open ? (
        <View style={[styles.optionWrap, { marginTop: t.spacing.sm }]}>
          {options.map(o => {
            const active = o === value;
            return (
              <Pressable
                key={o}
                onPress={() => {
                  // Tapping the active option clears it, so a choice is undoable.
                  onChange(active ? '' : o);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[
                  styles.option,
                  {
                    backgroundColor: active ? t.colors.primarySoft : t.colors.surface,
                    borderColor: active ? t.colors.primary : t.colors.border,
                    borderRadius: t.radius.pill,
                  },
                ]}>
                <Txt
                  variant="captionMedium"
                  color={active ? t.colors.primary : t.colors.textSecondary}>
                  {o}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {hint ? (
        <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 5 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { paddingHorizontal: 14 },
  picker: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
});
