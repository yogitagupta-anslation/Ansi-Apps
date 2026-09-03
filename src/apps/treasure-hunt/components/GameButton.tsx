import React, {useRef} from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {BUTTON_LIP, alpha, colors, elevate, radius, spacing, typography} from '../theme';

export type ButtonTone = 'gold' | 'blue' | 'green' | 'dark' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  /** Emoji or short glyph shown to the left of the label. */
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

interface Tone {
  face: string;
  highlight: string;
  lip: string;
  ink: string;
  border: string;
}

const TONES: Record<ButtonTone, Tone> = {
  gold: {
    face: '#2C2413',
    highlight: colors.frameGold,
    lip: '#120E07',
    ink: colors.gold,
    border: colors.frameGold,
  },
  blue: {
    face: '#101F31',
    highlight: colors.blue,
    lip: '#060D16',
    ink: colors.cyan,
    border: colors.blueDeep,
  },
  green: {
    face: '#122415',
    highlight: colors.green,
    lip: '#07120A',
    ink: colors.greenBright,
    border: colors.greenDeep,
  },
  danger: {
    face: '#2A1113',
    highlight: colors.danger,
    lip: '#150709',
    ink: '#F0797D',
    border: colors.dangerDeep,
  },
  dark: {
    face: '#151C28',
    highlight: colors.stoneLight,
    lip: '#080C13',
    ink: colors.text,
    border: colors.stoneDark,
  },
};

/**
 * The forged plate every action in the game sits on.
 *
 * The 3D look is built from layers rather than a gradient library: a darker
 * "lip" sits behind the face, a metal rim runs around it, and four studs clasp
 * the corners. Pressing collapses the lip, so the button physically depresses.
 */
export function GameButton({
  label,
  onPress,
  tone = 'gold',
  icon,
  disabled = false,
  loading = false,
  size = 'lg',
  style,
}: Props) {
  const t = TONES[tone];
  const inert = disabled || loading;
  const press = useRef(new Animated.Value(0)).current;

  const animate = (to: number) => {
    Animated.timing(press, {
      toValue: to,
      duration: 70,
      useNativeDriver: true,
    }).start();
  };

  const translateY = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, BUTTON_LIP],
  });

  return (
    <View style={[styles.wrap, inert && styles.inert, style]}>
      {/* The lip: a darker slab peeking out from under the face. */}
      <View
        style={[
          styles.lip,
          {backgroundColor: t.lip, height: size === 'lg' ? 58 : 48},
        ]}
      />
      <Animated.View style={{transform: [{translateY}]}}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{disabled: inert}}
          disabled={inert}
          onPressIn={() => animate(1)}
          onPressOut={() => animate(0)}
          onPress={onPress}
          style={[
            styles.face,
            {
              backgroundColor: t.face,
              borderColor: t.border,
              height: size === 'lg' ? 58 : 48,
            },
            elevate(4),
          ]}>
          {/* A faint band of lit metal along the top edge. */}
          <View
            pointerEvents="none"
            style={[styles.sheen, {backgroundColor: alpha(t.highlight, 0.14)}]}
          />
          {/* Corner studs, as on the reference plates. */}
          {STUDS.map((pos, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[styles.stud, pos, {backgroundColor: t.border}]}
            />
          ))}
          {/*
            * Both states stay mounted and are toggled with opacity rather than
            * swapped. Replacing a View with an ActivityIndicator in the same
            * slot right before the screen unmounts leaves the outgoing view
            * attached, and the Fabric mounting layer rejects the re-parent
            * ("View already has a parent"). A stable tree avoids it entirely.
            */}
          <View style={[styles.row, loading && styles.hidden]}>
            {icon ? <Text style={styles.icon}>{icon}</Text> : null}
            <Text
              style={[
                typography.button,
                {color: t.ink, fontSize: size === 'lg' ? 17 : 15},
              ]}
              numberOfLines={1}>
              {label}
            </Text>
          </View>
          <ActivityIndicator
            color={t.ink}
            animating={loading}
            style={[styles.spinner, !loading && styles.hidden]}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Stud placement inside the rim. */
const STUDS: ViewStyle[] = [
  {top: 5, left: 7},
  {top: 5, right: 7},
  {bottom: 5, left: 7},
  {bottom: 5, right: 7},
];

const styles = StyleSheet.create({
  stud: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.75,
  },
  wrap: {
    position: 'relative',
  },
  inert: {
    opacity: 0.45,
  },
  lip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: BUTTON_LIP,
    borderRadius: radius.lg,
  },
  face: {
    borderRadius: radius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '46%',
    borderTopLeftRadius: radius.lg - 2,
    borderTopRightRadius: radius.lg - 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    fontSize: 18,
  },
  spinner: {
    position: 'absolute',
  },
  hidden: {
    opacity: 0,
  },
});
