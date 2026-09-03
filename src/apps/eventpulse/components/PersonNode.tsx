/**
 * PersonNode — one real person, on the map.
 *
 * This is the component the whole product is about, so it earns a few notes:
 *
 *  - **It owns its own animation.** The parent hands it a target position; the
 *    node glides there. That way a snapshot containing 60 people does not
 *    schedule 60 layout passes — each node interpolates on the UI thread and
 *    React does nothing until the next snapshot.
 *  - **It appears and leaves gently.** Scale 0.85 → 1 with a fade on arrival,
 *    a fade to half opacity when the signal goes quiet, and a fade out on
 *    departure. No bounce: a node that overshoots reads as a person who moved.
 *  - **The info button is a real target.** 30 px, its own hit slop, and it does
 *    not compete with tapping the avatar itself.
 *  - **It never renders a distance in metres.** Band and range only.
 */

import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import type { NearbyPerson } from '../presence/PresenceController';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, elevation, motion, radius, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { AppText } from './primitives';

export interface PersonNodeProps {
  person: NearbyPerson;
  /** Screen position of the node's centre, in pixels. */
  x: number;
  y: number;
  selected: boolean;
  navigating: boolean;
  showLabel: boolean;
  /** Lower for people the map wants to de-emphasise under an active filter. */
  muted?: boolean;
  /** Pulses the info button once, the first time the map is opened. */
  hintInfo?: boolean;
  /** 'connected' | 'requested' | null — shown as a small corner badge. */
  connection?: 'connected' | 'requested' | null;
  onPress: (peerId: string) => void;
  onInfo: (peerId: string) => void;
  /** Long-press shortcut — goes straight to Find Me. */
  onLongPress?: (peerId: string) => void;
}

const NODE_WIDTH = 132;

function PersonNodeComponent({
  person,
  x,
  y,
  selected,
  navigating,
  showLabel,
  muted,
  hintInfo,
  connection,
  onPress,
  onInfo,
  onLongPress,
}: PersonNodeProps): React.ReactElement {
  const { colors, name } = useTheme();

  const translate = useRef(new Animated.ValueXY({ x, y })).current;
  const appear = useRef(new Animated.Value(0)).current;
  const emphasis = useRef(new Animated.Value(selected || navigating ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: motion.appear,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [appear]);

  useEffect(() => {
    Animated.timing(translate, {
      toValue: { x, y },
      duration: motion.reposition,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [translate, x, y]);

  useEffect(() => {
    Animated.timing(emphasis, {
      toValue: selected || navigating ? 1 : 0,
      duration: motion.select,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [emphasis, selected, navigating]);

  // A single, slow pulse the first time the map is shown. The info button is the
  // whole product flow — "tap ⓘ, get the profile" — and it is small by
  // necessity, so it gets pointed at once and then never again.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!hintInfo) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
      { iterations: 3 },
    );
    animation.start();
    return () => animation.stop();
  }, [hintInfo, pulse]);

  // Press feedback. A node is a small target on a busy canvas, so the tap needs
  // to acknowledge itself before the sheet has a chance to animate in.
  const press = useRef(new Animated.Value(0)).current;
  const setPressed = (down: boolean): void => {
    Animated.spring(press, {
      toValue: down ? 1 : 0,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };

  const scale = Animated.add(
    appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
    Animated.add(
      emphasis.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] }),
      press.interpolate({ inputRange: [0, 1], outputRange: [0, -0.08] }),
    ),
  );

  const opacity = Animated.multiply(
    appear,
    person.fading ? 0.45 : muted && !selected ? 0.35 : 1,
  );

  const accent = person.category ? categoryColor(person.category, name) : colors.textTertiary;
  const ringed = selected || navigating;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          opacity,
          transform: [
            { translateX: Animated.subtract(translate.x, NODE_WIDTH / 2) },
            { translateY: translate.y },
            { scale },
          ],
        },
      ]}
    >
      {/* A plate, not a card. The design system reserves borders and cards for
          decisions; a name on the map is neither, so it gets the quietest
          treatment that still keeps text legible over the radar. An outline
          appears only when this person is selected or being navigated to. */}
      {showLabel ? (
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: colors.mapLabel,
              borderColor: ringed ? colors.accent : 'transparent',
              borderWidth: ringed ? 1 : 0,
            },
          ]}
        >
          {/* A Text only ellipsizes when its width is actually constrained. The
              bubble's `maxWidth` does not propagate, so the constraint goes on
              the Text itself — without it the name overflows the bubble and gets
              hard-clipped with no visual cue that anything is missing. */}
          <AppText variant="mapName" numberOfLines={1} style={styles.bubbleText}>
            {person.resolved ? person.displayName : `${person.displayName}…`}
          </AppText>
        </View>
      ) : null}

      <View style={styles.avatarRow}>
        <Pressable
          onPress={() => onPress(person.peerId)}
          onLongPress={onLongPress ? () => onLongPress(person.peerId) : undefined}
          delayLongPress={350}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={`${person.displayName}${person.subtitle ? `, ${person.subtitle}` : ''}`}
          accessibilityHint="Tap for a quick preview, press and hold to navigate to them"
        >
          <Avatar
            avatar={person.attendee?.profile.avatar}
            name={person.displayName}
            size="map"
            availability={person.availability}
            highlighted={ringed}
            dimmed={person.fading}
          />
        </Pressable>

        <Pressable
          onPress={() => onInfo(person.peerId)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`View ${person.displayName}'s full profile`}
          style={[
            styles.infoButton,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: ringed ? colors.accent : colors.borderStrong,
            },
          ]}
        >
          {hintInfo ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.infoPulse,
                {
                  borderColor: colors.accent,
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
                  transform: [
                    { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) },
                  ],
                },
              ]}
            />
          ) : null}
          <AppText variant="micro" tone={ringed ? 'accent' : 'primary'}>
            i
          </AppText>
        </Pressable>

        {connection ? (
          <View
            style={[
              styles.connectionBadge,
              {
                backgroundColor: connection === 'connected' ? colors.accent : colors.surfaceElevated,
                borderColor: connection === 'connected' ? colors.accent : colors.borderStrong,
              },
            ]}
          >
            <AppText variant="micro" tone={connection === 'connected' ? 'inverse' : 'secondary'}>
              {connection === 'connected' ? '✓' : '🤝'}
            </AppText>
          </View>
        ) : null}
      </View>

      {showLabel && person.subtitle ? (
        <View style={styles.metaRow}>
          <View style={[styles.categoryDot, { backgroundColor: accent }]} />
          <AppText variant="mapMeta" tone="tertiary" numberOfLines={1} style={styles.meta}>
            {person.subtitle}
          </AppText>
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * The map re-renders a node only when something it draws actually changed.
 * Position is compared with a small epsilon: sub-pixel drift from the position
 * engine must not cost a React render on every snapshot.
 */
export const PersonNode = memo(PersonNodeComponent, (previous, next) => {
  return (
    previous.person === next.person &&
    Math.abs(previous.x - next.x) < 0.5 &&
    Math.abs(previous.y - next.y) < 0.5 &&
    previous.selected === next.selected &&
    previous.navigating === next.navigating &&
    previous.showLabel === next.showLabel &&
    previous.muted === next.muted &&
    previous.hintInfo === next.hintInfo &&
    previous.connection === next.connection &&
    previous.onLongPress === next.onLongPress
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: NODE_WIDTH,
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginBottom: 6,
    maxWidth: NODE_WIDTH,
  },
  bubbleText: { maxWidth: NODE_WIDTH - space.md * 2 },
  avatarRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoButton: {
    position: 'absolute',
    right: -8,
    bottom: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPulse: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
  },
  connectionBadge: {
    position: 'absolute',
    left: -8,
    bottom: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 4,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    maxWidth: NODE_WIDTH,
  },
  categoryDot: { width: 5, height: 5, borderRadius: 2.5 },
  meta: { flexShrink: 1 },
});
