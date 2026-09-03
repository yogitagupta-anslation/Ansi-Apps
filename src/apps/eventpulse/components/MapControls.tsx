/**
 * Map controls and the map's status strip.
 *
 * The controls stay out of the way: a single column of round glass buttons on
 * the right, thumb-reachable, never covering the centre of the canvas where the
 * people are. The status strip is the honest counterweight — it says how many
 * people we can actually see, whether the directory is still syncing, and
 * whether the compass is being lied to by the building.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';


import type { HeadingQuality } from '../positioning/HeadingService';
import { zoomDefinition, type ZoomLevel } from '../positioning/Clustering';
import type { SyncStatus } from '../event/EventService';
import type { MapOrientation } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space } from '../theme/tokens';
import { AppText } from './primitives';

export function MapControls({
  zoom,
  orientation,
  headingQuality,
  panned,
  onZoomIn,
  onZoomOut,
  onRecenter,
  onToggleOrientation,
  onOpenVenuePlan,
  onOpenLegend,
  basemap,
  basemapAvailable,
  onToggleBasemap,
}: {
  zoom: ZoomLevel;
  orientation: MapOrientation;
  headingQuality: HeadingQuality;
  /** Highlights recentre once the user has dragged away from themselves. */
  panned?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  onToggleOrientation: () => void;
  onOpenVenuePlan: () => void;
  onOpenLegend: () => void;
  basemap?: 'plain' | 'satellite';
  /** False when the organiser published no venue coordinates. */
  basemapAvailable?: boolean;
  onToggleBasemap?: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const zoomDef = zoomDefinition(zoom);

  return (
    <View style={styles.column} pointerEvents="box-none">
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }, elevation.low]}>
        <ControlButton label="+" onPress={onZoomIn} accessibilityLabel="Zoom in" />
        <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
        <ControlButton label="−" onPress={onZoomOut} accessibilityLabel="Zoom out" />
        <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
        <ControlButton
          label="⌖"
          onPress={onRecenter}
          accessibilityLabel="Recentre the map on you"
          tint={panned ? colors.accent : undefined}
        />
      </View>

      <ControlPill
        onPress={onToggleOrientation}
        accessibilityLabel={
          orientation === 'heading_up'
            ? 'Map follows your heading. Switch to north up.'
            : 'Map is north up. Switch to follow your heading.'
        }
      >
        <AppText variant="micro" tone={headingQuality === 'interference' ? 'danger' : 'secondary'}>
          {orientation === 'heading_up' ? '⌃ AHEAD' : 'N ↑'}
        </AppText>
      </ControlPill>

      {/* Hidden entirely when the event has no coordinates: a control that
          cannot do anything is worse than one that is not there. */}
      {basemapAvailable && onToggleBasemap ? (
        <ControlPill
          onPress={onToggleBasemap}
          accessibilityLabel={
            basemap === 'satellite'
              ? 'Satellite view of the venue is on. Switch to the plain radar.'
              : 'Show satellite imagery of the venue.'
          }
        >
          <AppText variant="micro" tone={basemap === 'satellite' ? 'accent' : 'secondary'}>
            🛰 SAT
          </AppText>
        </ControlPill>
      ) : null}

      <ControlPill onPress={onOpenVenuePlan} accessibilityLabel="Open the venue plan">
        <AppText variant="micro" tone="secondary">
          VENUE
        </AppText>
      </ControlPill>

      <ControlPill onPress={onOpenLegend} accessibilityLabel="How this map works">
        <AppText variant="micro" tone="secondary">
          ?
        </AppText>
      </ControlPill>

      <View style={[styles.zoomLabel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AppText variant="micro" tone="tertiary">
          {zoomDef.label.toUpperCase()}
        </AppText>
      </View>
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  accessibilityLabel,
  tint,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  tint?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.controlButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppText variant="heading" tone="secondary" style={tint ? { color: tint } : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

function ControlPill({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        elevation.low,
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Status strip
 * ------------------------------------------------------------------ */

export function MapStatusStrip({
  peopleCount,
  sync,
  headingQuality,
  offline,
  advertising,
  onPress,
}: {
  peopleCount: number;
  sync: SyncStatus | null;
  headingQuality: HeadingQuality;
  offline: boolean;
  advertising: boolean;
  /** Opens the non-spatial list of the same people. */
  onPress?: () => void;
}): React.ReactElement | null {
  const { colors } = useTheme();

  // Only ever one line, and only when there is something worth saying.
  const message = (() => {
    if (offline) return { text: 'Offline — showing your cached copy of this event', tone: 'warn' as const };
    if (!advertising) return { text: 'You are hidden — others cannot see you', tone: 'warn' as const };
    if (sync?.phase === 'syncing') {
      return {
        text: sync.total
          ? `Loading attendees… ${sync.loaded} of ${sync.total}`
          : `Loading attendees… ${sync.loaded}`,
        tone: 'info' as const,
      };
    }
    if (headingQuality === 'interference') {
      return { text: 'Compass is unreliable here — direction is approximate', tone: 'warn' as const };
    }
    if (peopleCount > 0) {
      return {
        text: `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} nearby`,
        tone: 'info' as const,
      };
    }
    return null;
  })();

  if (!message) return null;

  // A radar is a poor way to answer "is anyone here from Google", and some
  // people simply do not read radars — so the count is a door into a plain list.
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${message.text}. Open the list.` : undefined}
      style={({ pressed }) => [
        styles.status,
        {
          backgroundColor: colors.surface,
          borderColor: message.tone === 'warn' ? colors.warning : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
        elevation.low,
      ]}
    >
      <AppText variant="caption" tone={message.tone === 'warn' ? 'primary' : 'secondary'}>
        {message.text}
      </AppText>
      {onPress ? (
        <AppText variant="caption" tone="accent" style={styles.statusAction}>
          View list →
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: {
    position: 'absolute',
    right: space.lg,
    top: '32%',
    alignItems: 'center',
    gap: space.sm,
  },
  group: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  groupDivider: { height: StyleSheet.hairlineWidth, width: '100%' },
  controlButton: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    minWidth: 44,
    paddingHorizontal: space.sm,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  statusAction: { marginLeft: 'auto' },
  status: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
