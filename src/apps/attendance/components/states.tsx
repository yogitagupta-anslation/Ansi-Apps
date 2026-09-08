/**
 * states.tsx
 * -----------------------------------------------------------------------------
 * Empty, error and loading states.
 *
 * Every one of these answers two questions: what happened, and what can I do
 * about it. A blank area with "No data" fails both.
 *
 * Skeletons are used instead of spinners for content areas: they preserve
 * layout, so the screen does not jump when data arrives.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { Icon, type IconName } from './Icon';
import { Button, Card, Txt } from './ui';

/* ============================================================ illustrations == */

/**
 * The illustrated empty-state scenes.
 *
 * Named by SITUATION, not by file: a screen asks for `noEmployeesNearby`, not
 * for a path. Swapping the artwork later touches only this map.
 *
 * require() is deliberate — React Native resolves image assets at build time,
 * so the path cannot be built from a variable.
 */
export const EMPTY_ART = {
  noEmployeesNearby: require('../assets/no-employees-nearby.png'),
  noEmployeesRegistered: require('../assets/no-employees-registered.png'),
  noAttendanceToday: require('../assets/no-attendance-today.png'),
  noHistory: require('../assets/no-history.png'),
  noRecordsThisMonth: require('../assets/no-records-month.png'),
} as const;

export type EmptyArt = keyof typeof EMPTY_ART;

/* ============================================================= EmptyState == */

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  actionIcon,
  actionTone = 'gradient',
  compact = false,
  art,
}: {
  icon: IconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Leading glyph inside the CTA pill. */
  actionIcon?: IconName;
  /** Which of the design's two CTA pills to draw. */
  actionTone?: 'gradient' | 'soft';
  compact?: boolean;
  /**
   * Scene to draw instead of the icon disc. Each situation gets its own
   * illustration so two different empty states never look identical — the
   * picture should tell you WHICH nothing you are looking at.
   *
   * Omit it for minor or repeated empties, where a full illustration would
   * be noise rather than help.
   */
  art?: EmptyArt;
}) {
  const t = useTheme();
  return (
    <View style={[styles.centered, { paddingVertical: compact ? t.spacing.xxl : t.spacing.xxxl }]}>
      {art ? (
        <Image source={EMPTY_ART[art]} style={styles.illustration} accessible={false} />
      ) : (
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: t.colors.surfaceMuted, width: 64, height: 64, borderRadius: 32 },
          ]}>
          <Icon name={icon} size={26} color={t.colors.textMuted} />
        </View>
      )}

      <Txt variant="emptyTitle" style={{ marginTop: t.spacing.lg }} align="center">
        {title}
      </Txt>
      <Txt
        variant="emptyBody"
        color={t.colors.textMuted}
        align="center"
        style={{ marginTop: 8, maxWidth: 258 }}>
        {message}
      </Txt>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            actionTone === 'soft'
              ? {
                  backgroundColor: t.colors.primarySoft,
                  borderColor: t.colors.primaryBorderSoft,
                  height: 42,
                  paddingHorizontal: 18,
                }
              : { borderColor: 'transparent', height: 46, paddingHorizontal: 20 },
            pressed ? { transform: [{ scale: 0.97 }] } : null,
          ]}>
          {actionTone === 'gradient' ? (
            <LinearGradient
              colors={['#4F46E5', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {actionIcon ? (
            <Icon
              name={actionIcon}
              size={actionTone === 'soft' ? 15 : 16}
              color={actionTone === 'soft' ? t.colors.primaryTint : '#FFFFFF'}
            />
          ) : null}
          <Txt
            style={[
              actionTone === 'soft' ? styles.ctaLabelSoft : styles.ctaLabel,
              { color: actionTone === 'soft' ? t.colors.primaryTint : '#FFFFFF' },
            ]}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ============================================================= ErrorState == */

/**
 * User-facing failure. Technical detail belongs in the Debug screen, not here —
 * "Bluetooth is turned off" is actionable, a stack trace is not.
 */
export function ErrorState({
  icon = 'triangle-alert',
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <Card accent={t.colors.warning}>
      <View style={styles.row}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: t.colors.warningSoft, width: 40, height: 40, borderRadius: 20 },
          ]}>
          <Icon name={icon} size={19} color={t.colors.warning} />
        </View>
        <View style={{ flex: 1, marginLeft: t.spacing.md }}>
          <Txt variant="bodyStrong">{title}</Txt>
          <Txt variant="caption" color={t.colors.textSecondary} style={{ marginTop: 3 }}>
            {message}
          </Txt>
        </View>
      </View>
      {actionLabel && onAction ? (
        <View style={{ marginTop: t.spacing.md }}>
          <Button title={actionLabel} onPress={onAction} variant="neutral" size="sm" />
        </View>
      ) : null}
    </Card>
  );
}

/* =========================================================== Skeletons == */


/* ====================================================== DetectedEmptyState == */

/**
 * The "no employees found" empty state for the Host's live-detection list,
 * matching the agreed reference design: a friendly layered search illustration
 * built from the app's own primitives — a big soft circle, a person-search
 * glyph, and a small scanning accent — never an unrelated stock image.
 *
 * Shown ONLY while the scanner is genuinely running. A stopped scanner gets
 * the stopped state instead, because "no employees found" while not looking
 * would be a lie of omission.
 */
export function DetectedEmptyState({
  onCheckAgain,
  onClearFilters,
  filtersActive = false,
}: {
  onCheckAgain?: () => void;
  /** When the caller has active filters, clearing them is the better CTA. */
  onClearFilters?: () => void;
  filtersActive?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={[styles.centered, { paddingVertical: t.spacing.xxl }]}>
      {/*
       * Bundled flat illustration (person searching with binoculars, plant at
       * the side) rather than an icon composition — per the agreed reference
       * design. Drawn in-house and shipped as an asset: this app makes no
       * network requests, so a remote illustration was never an option. The
       * navy backdrop is baked in and reads correctly on both themes.
       */}
      <Image source={EMPTY_ART.noEmployeesNearby} style={styles.illustration} accessible={false} />

      <Txt variant="title" align="center" style={{ marginTop: t.spacing.lg }}>
        {filtersActive ? 'No employees found' : 'No employees nearby'}
      </Txt>
      <Txt
        variant="caption"
        color={t.colors.textSecondary}
        align="center"
        style={{ lineHeight: 19, marginTop: 6, maxWidth: 280 }}>
        {filtersActive
          ? 'No employees match your search or filters.'
          : "We didn't detect any registered employees in range."}
      </Txt>
      {!filtersActive ? (
        <Txt
          variant="caption"
          color={t.colors.textMuted}
          align="center"
          style={{ lineHeight: 18, marginTop: 6, maxWidth: 280 }}>
          Make sure employees are nearby and their attendance broadcasting is
          turned on.
        </Txt>
      ) : null}

      {filtersActive && onClearFilters ? (
        <SoftPill label="Clear filters" icon="x" onPress={onClearFilters} />
      ) : onCheckAgain ? (
        <SoftPill label="Check again" icon="refresh-cw" onPress={onCheckAgain} />
      ) : null}
    </View>
  );
}

/**
 * The approved secondary CTA: a 42px primarySoft capsule with a primaryTint
 * label. The design uses it wherever an empty state suggests a next step
 * without demanding it; the saturated gradient is reserved for first-run.
 */
function SoftPill({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.cta,
        {
          backgroundColor: t.colors.primarySoft,
          borderColor: t.colors.primaryBorderSoft,
          height: 42,
          paddingHorizontal: 18,
        },
        pressed ? { transform: [{ scale: 0.97 }] } : null,
      ]}>
      <Icon name={icon} size={15} color={t.colors.primaryTint} />
      <Txt style={[styles.ctaLabelSoft, { color: t.colors.primaryTint }]}>{label}</Txt>
    </Pressable>
  );
}

/** Gentle opacity pulse. Subtle on purpose — loading should not draw the eye. */
function useShimmer() {
  const value = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);

  return value;
}

export function SkeletonBlock({
  height = 14,
  width = '100%',
  radius,
  style,
}: {
  height?: number;
  width?: number | string;
  radius?: number;
  style?: object;
}) {
  const t = useTheme();
  const opacity = useShimmer();

  return (
    <Animated.View
      style={[
        {
          height,
          width: width as number,
          borderRadius: radius ?? t.radius.sm,
          backgroundColor: t.colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Placeholder shaped like an employee row, so layout does not shift on load. */
export function EmployeeSkeleton({ count = 4 }: { count?: number }) {
  const t = useTheme();
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <View style={styles.row}>
            <SkeletonBlock height={44} width={44} radius={22} />
            <View style={{ flex: 1, marginLeft: t.spacing.md }}>
              <SkeletonBlock height={14} width="55%" />
              <SkeletonBlock height={11} width="32%" style={{ marginTop: 8 }} />
            </View>
            <SkeletonBlock height={22} width={70} radius={t.radius.pill} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/** Placeholder for the dashboard summary tiles. */
export function SummarySkeleton() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md, marginBottom: t.spacing.md }}>
      {[0, 1, 2].map(i => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: t.colors.surface,
            borderRadius: t.cardRadius,
            padding: t.spacing.lg,
          }}>
          <SkeletonBlock height={26} width="60%" />
          <SkeletonBlock height={11} width="80%" style={{ marginTop: 10 }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cta: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    marginTop: 22,
    overflow: 'hidden',
  },
  ctaLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5 },
  ctaLabelSoft: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5 },
  illustration: { height: 168, width: 168 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  iconCircle: { alignItems: 'center', justifyContent: 'center' },
  row: { alignItems: 'center', flexDirection: 'row' },
});
