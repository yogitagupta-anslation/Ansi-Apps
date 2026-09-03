import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

export const REACTIONS = ['😂', '😱', '🔥', '🤦', '👀'];

export interface IncomingReaction {
  /** Unique per arrival so repeats still animate. */
  key: string;
  name: string;
  emoji: string;
}

/** Five taps, no keyboard — the whole chat system a party game needs. */
export function ReactionBar({ onSend, disabled }: { onSend(emoji: string): void; disabled?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bar}>
      {REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onSend(emoji)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`React ${emoji}`}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Reactions from the room, floating up over the board and fading out. */
export function ReactionStream({ items }: { items: IncomingReaction[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View pointerEvents="none" style={styles.stream}>
      {items.map((item) => (
        <FloatingReaction key={item.key} item={item} />
      ))}
    </View>
  );
}

function FloatingReaction({ item }: { item: IncomingReaction }) {
  const styles = useThemedStyles(makeStyles);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, {
      toValue: 1,
      duration: 2200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [rise]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -46] });
  const opacity = rise.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View style={[styles.float, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.floatEmoji}>{item.emoji}</Text>
      <Text style={styles.floatName}>{item.name}</Text>
    </Animated.View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pressed: {
    opacity: 0.6,
    transform: [{ scale: 0.94 }],
  },
  disabled: {
    opacity: 0.4,
  },
  emoji: {
    fontSize: 16,
  },
  stream: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.xxl,
    alignItems: 'flex-end',
    gap: 4,
  },
  float: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  floatEmoji: {
    fontSize: 18,
  },
  floatName: {
    ...fonts.label,
    color: colors.textSecondary,
    fontSize: 10,
  },
});
