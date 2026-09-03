import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {alpha, colors, elevate, radius, spacing, typography} from '../theme';

interface FieldProps {
  label: string;
  /** Emoji shown in the coloured tile on the left. */
  icon?: string;
  /** Rendered node for the tile, e.g. artwork. Takes precedence over `icon`. */
  iconNode?: React.ReactNode;
  iconColor: string;
  children: React.ReactNode;
}

/** A settings row: coloured icon tile, small caps label, and a control. */
export function FormRow({label, icon, iconNode, iconColor, children}: FieldProps) {
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.iconTile,
          {backgroundColor: alpha(iconColor, 0.22), borderColor: alpha(iconColor, 0.6)},
        ]}>
        {iconNode ?? <Text style={styles.iconGlyph}>{icon}</Text>}
      </View>
      <View style={styles.field}>
        <Text style={typography.fieldLabel}>{label}</Text>
        {children}
      </View>
    </View>
  );
}

interface TextFieldProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  /** Called when editing finishes, by blur or by the Done key. */
  onCommit?: () => void;
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  maxLength,
  onCommit,
}: TextFieldProps) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      maxLength={maxLength}
      style={styles.control}
      returnKeyType="done"
      onBlur={onCommit}
      onSubmitEditing={onCommit}
    />
  );
}

export interface Option<T> {
  label: string;
  value: T;
}

interface SelectProps<T> {
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (next: T) => void;
  accessibilityLabel: string;
}

/**
 * A dropdown.
 *
 * Deliberately expands inline instead of opening a Modal. A Modal hosts its own
 * native surface, and under the New Architecture unmounting a screen that owns
 * one while navigating away makes the Fabric mounting layer try to re-parent a
 * view that still belongs to the outgoing screen ("View already has a parent").
 * An in-tree list avoids that completely and keeps the control on one surface.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${selected?.label ?? ''}`}
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(current => !current)}
        style={({pressed}) => [
          styles.control,
          styles.select,
          open && styles.selectOpen,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.controlText} numberOfLines={1}>
          {selected?.label ?? '—'}
        </Text>
        <Text style={[styles.caret, open && styles.caretOpen]}>▾</Text>
      </Pressable>

      {open ? (
        <View style={styles.sheet}>
          {options.map(option => {
            const active = option.value === value;
            return (
              <Pressable
                key={String(option.value)}
                accessibilityRole="radio"
                accessibilityState={{selected: active}}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.sheetRow,
                  active && styles.sheetRowActive,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.sheetText, active && styles.sheetTextActive]}>
                  {option.label}
                </Text>
                {active ? <Text style={styles.tick}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 16,
  },
  field: {
    flex: 1,
    gap: 5,
  },
  control: {
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    justifyContent: 'center',
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectOpen: {
    borderColor: alpha(colors.gold, 0.7),
  },
  caretOpen: {
    color: colors.gold,
  },
  controlText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  caret: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  sheet: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.4),
    padding: spacing.sm,
    ...elevate(4),
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  sheetRowActive: {
    backgroundColor: alpha(colors.gold, 0.16),
    borderWidth: 1,
    borderColor: alpha(colors.gold, 0.6),
  },
  sheetText: {
    color: colors.textDim,
    fontSize: 15,
    fontWeight: '600',
  },
  sheetTextActive: {
    color: colors.gold,
    fontWeight: '800',
  },
  tick: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: '800',
  },
});
