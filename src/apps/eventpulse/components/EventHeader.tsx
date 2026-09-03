/**
 * EventHeader — where am I, and who is here.
 *
 * The map used to open straight into filter chips, which left the most basic
 * orientation questions unanswered: which event is this, which part of the
 * venue am I looking at, and how many people can the app actually see.
 *
 * The zone line is not decoration. It is the manual position anchor that makes
 * the map's zone layer honest — BLE cannot tell us where in a building we are,
 * so the user tells us, once, by tapping it. Until they do it reads "Set your
 * zone" rather than quietly pretending to know.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { EventDetail, EventZone } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { AppText } from './primitives';

export function EventHeader({
  event,
  zone,
  peopleCount,
  syncing,
  onLeave,
  onPickZone,
  onOpenSettings,
}: {
  event: EventDetail;
  zone: EventZone | null;
  peopleCount: number;
  syncing: boolean;
  onLeave: () => void;
  onPickZone: () => void;
  onOpenSettings: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

  const peopleLabel = syncing
    ? 'looking around…'
    : `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} nearby`;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.mapCanvas }}>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={onLeave}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Leave this event"
          style={styles.iconButton}
        >
          <AppText variant="heading" tone="secondary">
            ←
          </AppText>
        </Pressable>

        <View style={styles.middle}>
          <AppText variant="heading" numberOfLines={1}>
            {event.name}
          </AppText>

          <Pressable
            onPress={onPickZone}
            accessibilityRole="button"
            accessibilityLabel={
              zone ? `You are in ${zone.name}. Change zone.` : 'Set the zone you are standing in'
            }
            style={styles.subtitleRow}
            hitSlop={6}
          >
            <AppText variant="caption" tone={zone ? 'secondary' : 'accent'} numberOfLines={1}>
              {zone ? `${zone.icon ?? '📍'} ${zone.name}` : '📍 Set your zone'}
            </AppText>
            <AppText variant="caption" tone="tertiary">
              {' ▾ · '}
            </AppText>
            <AppText variant="caption" tone="tertiary" numberOfLines={1}>
              {peopleLabel}
            </AppText>
          </Pressable>
        </View>

        <Pressable
          onPress={onOpenSettings}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Privacy and visibility settings"
          style={styles.iconButton}
        >
          <AppText variant="heading" tone="secondary">
            ⚙
          </AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * Zone picker. Doubles as the explanation of why we are asking: people are
 * rightly suspicious of an app that wants to know where they are standing, and
 * the honest answer — "so the map can point the right way, and it stays on your
 * phone" — is short enough to just say.
 */
export function ZonePickerList({
  zones,
  currentZoneId,
  onSelect,
}: {
  zones: EventZone[];
  currentZoneId: string | null;
  onSelect: (zoneId: string | null) => void;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={styles.zoneList}>
      <AppText variant="caption" tone="secondary">
        EventPulse cannot tell where you are inside a building — Bluetooth only says who is near.
        Telling it which zone you are in lets the map draw the rest of the venue in the right
        direction. It stays on your phone.
      </AppText>

      {zones.map((zone) => {
        const selected = currentZoneId === zone.id;
        return (
          <Pressable
            key={zone.id}
            onPress={() => onSelect(zone.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[
              styles.zoneRow,
              {
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.accentSoft : 'transparent',
              },
            ]}
          >
            <AppText variant="body">{zone.icon ?? '📍'}</AppText>
            <View style={styles.zoneText}>
              <AppText variant="bodyStrong">{zone.name}</AppText>
              <AppText variant="caption" tone="tertiary">
                {zone.kind}
              </AppText>
            </View>
            {selected ? (
              <AppText variant="caption" tone="accent">
                ✓
              </AppText>
            ) : null}
          </Pressable>
        );
      })}

      {currentZoneId ? (
        <Pressable
          onPress={() => onSelect(null)}
          accessibilityRole="button"
          style={styles.clearRow}
        >
          <AppText variant="caption" tone="secondary">
            Clear — hide the zone layer
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 1 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center' },
  zoneList: { gap: space.sm },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  zoneText: { flex: 1, gap: 1 },
  clearRow: { paddingVertical: space.md, alignItems: 'center' },
});
