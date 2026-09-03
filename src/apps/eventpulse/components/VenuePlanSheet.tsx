/**
 * VenuePlanSheet — the venue's own floor plan, kept honestly separate.
 *
 * Why this is a sheet and not a layer under the live map: without fixed
 * infrastructure we do not know where in the building you are standing. Drawing
 * the stage and the coffee table underneath your radar would imply we do, and
 * the first time someone walked toward a "food" label and found a wall, they
 * would stop trusting the people layer too.
 *
 * So the plan is shown as what it is — the organiser's layout of the space,
 * useful for orientation, with no claim about your position on it. When a venue
 * deploys BLE anchors (`AnchorSolver`) and we can honestly place you, this
 * component becomes the map's zone layer and gains a "you are here" marker.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

import type { EventDetail, EventZone } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space, typography } from '../theme/tokens';
import { AppText, Button, Divider } from './primitives';

const PLAN_HEIGHT = 260;

export function VenuePlanSheet({
  event,
  visible,
  onClose,
}: {
  event: EventDetail | null;
  visible: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!event) return null;

  const zones = event.zones ?? [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={onClose} />

      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation.high,
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <AppText variant="title">{event.venue.name}</AppText>
          {event.venue.address ? (
            <AppText variant="body" tone="secondary">
              {event.venue.address}
            </AppText>
          ) : null}

          {zones.length > 0 ? (
            <>
              <View style={[styles.plan, { backgroundColor: colors.mapCanvas, borderColor: colors.border }]}>
                <VenuePlan zones={zones} event={event} />
              </View>

              <AppText variant="caption" tone="tertiary">
                This is the organiser&apos;s layout of the space. EventPulse does not track where
                you are inside the venue, so nothing here shows your position.
              </AppText>

              <Divider />

              {zones.map((zone) => (
                <View key={zone.id} style={styles.zoneRow}>
                  <AppText variant="body">{`${zone.icon ?? '•'}  ${zone.name}`}</AppText>
                  <AppText variant="caption" tone="tertiary">
                    {zone.kind}
                  </AppText>
                </View>
              ))}
            </>
          ) : (
            <AppText variant="body" tone="secondary">
              The organiser has not published a floor plan for this event.
            </AppText>
          )}

          {event.sessions.length > 0 ? (
            <>
              <Divider />
              <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
                SESSIONS
              </AppText>
              {event.sessions.map((session) => (
                <View key={session.id} style={styles.sessionRow}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {session.title}
                  </AppText>
                  <AppText variant="caption" tone="secondary">
                    {`${formatTime(session.startTime)} · ${
                      zones.find((zone) => zone.id === session.zoneId)?.name ?? 'Venue'
                    }`}
                  </AppText>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Button label="Close" variant="secondary" onPress={onClose} full />
        </View>
      </View>
    </Modal>
  );
}

function VenuePlan({ zones, event }: { zones: EventZone[]; event: EventDetail }): React.ReactElement {
  const { colors } = useTheme();

  // Fit the organiser's coordinates into the plan box, with a margin so labels
  // near the edge are not clipped.
  const xs = zones.map((zone) => zone.x);
  const ys = zones.map((zone) => zone.y);
  const minX = Math.min(...xs) - 12;
  const maxX = Math.max(...xs) + 12;
  const minY = Math.min(...ys) - 12;
  const maxY = Math.max(...ys) + 12;

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = Math.min(320 / width, PLAN_HEIGHT / height);

  const project = (zone: EventZone): { x: number; y: number } => ({
    x: (zone.x - minX) * scale,
    // Venue coordinates run north-positive; SVG runs y-down.
    y: PLAN_HEIGHT - (zone.y - minY) * scale,
  });

  return (
    <Svg width="100%" height={PLAN_HEIGHT} viewBox={`0 0 ${width * scale} ${PLAN_HEIGHT}`}>
      {zones.map((zone) => {
        const point = project(zone);
        return (
          <React.Fragment key={zone.id}>
            <Circle
              cx={point.x}
              cy={point.y}
              r={Math.max(zone.radius * scale, 14)}
              fill={colors.mapZone}
              stroke={colors.mapRing}
              strokeWidth={1}
            />
            <SvgText
              x={point.x}
              y={point.y + 4}
              fill={colors.mapZoneText}
              fontSize={typography.mapMeta.fontSize}
              textAnchor="middle"
            >
              {zone.icon ?? zone.name}
            </SvgText>
          </React.Fragment>
        );
      })}
      <SvgText
        x={4}
        y={PLAN_HEIGHT - 6}
        fill={colors.mapZoneText}
        fontSize={typography.mapMeta.fontSize}
      >
        {`${event.venue.widthMeters} × ${event.venue.heightMeters} m`}
      </SvgText>
    </Svg>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingTop: space.sm,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.sm },
  content: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md },
  plan: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: space.sm,
  },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm },
  sessionRow: { paddingVertical: space.sm, gap: 2 },
  sectionTitle: { letterSpacing: 0.8, paddingTop: space.sm },
  actions: { padding: space.lg, flexDirection: 'row' },
});
