/**
 * EmployeeAvatar.tsx
 * -----------------------------------------------------------------------------
 * Initials avatar with a colour derived deterministically from the employee ID.
 *
 * Deterministic matters: the same person keeps the same colour on every screen
 * and across restarts, which makes a long list easier to scan. A random colour
 * per render would be actively worse than no colour.
 *
 * No photos: this app has no backend and stores no images.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

/** Muted, professional palette — these sit behind white text. */
const AVATAR_COLORS = [
  '#4F6BED',
  '#0E9F6E',
  '#7C5CE0',
  '#C27803',
  '#0891B2',
  '#BE5A83',
  '#3F7D58',
  '#5A67D8',
];

/** Stable hash so one employee always gets one colour. */
function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Up to two initials from a display name. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function EmployeeAvatar({
  name,
  employeeId,
  size = 44,
  dimmed = false,
  badge,
  photo,
}: {
  name: string;
  /** Seeds the colour, so it stays stable if the name is edited. */
  employeeId: string;
  size?: number;
  dimmed?: boolean;
  /**
   * Small dot on the lower-right corner. Pass a colour to show it.
   *
   * Only ever set from a real, known state — an unknown state must leave this
   * undefined rather than defaulting to green, which would read as a confident
   * "present" the app has no basis for.
   */
  badge?: string;
  /**
   * Profile photo as a data URI. When present it replaces the initials disc;
   * initials remain the fallback so a missing photo degrades gracefully.
   */
  photo?: string;
}) {
  const t = useTheme();
  const background = dimmed ? t.colors.surfaceMuted : colorFor(employeeId || name);
  // Scales with the avatar so it stays proportionate from 28px rows to 96px heroes.
  const dot = Math.max(9, Math.round(size * 0.28));

  /** Blank, "?" or punctuation-only names yield no usable initials. */
  const raw = initialsOf(name);
  const initials = /[A-Za-z0-9]/.test(raw) ? raw : '';

  return (
    <View style={{ width: size, height: size }}>
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: dimmed ? 0.5 : 1,
          }}
          accessible={false}
        />
      ) : (
      <View
        accessible={false}
        style={[
          styles.avatar,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
        ]}>
        {/* No usable name yet: a person glyph, not "?" — a question mark in a
            circle reads as a help button, which is what it looked like. */}
        {initials ? (
          <Txt
            variant={size >= 44 ? 'bodyStrong' : 'label'}
            color={dimmed ? t.colors.textMuted : '#FFFFFF'}>
            {initials}
          </Txt>
        ) : (
          <Icon
            name="user"
            size={Math.round(size * 0.45)}
            color={dimmed ? t.colors.textMuted : '#FFFFFF'}
          />
        )}
      </View>
      )}

      {badge ? (
        <View
          style={[
            styles.badge,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: badge,
              // Ring in the page colour so the dot separates from the avatar.
              borderColor: t.colors.background,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  badge: { borderWidth: 2, bottom: 0, position: 'absolute', right: 0 },
});
