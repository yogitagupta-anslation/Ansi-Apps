import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text} from 'react-native';
import {alpha, colors, radius, spacing} from '../theme';

export interface ToastMessage {
  id: string;
  kind: 'info' | 'warn' | 'error';
  message: string;
}

interface Props {
  toast: ToastMessage;
  onDone: (id: string) => void;
}

const KIND_COLOR: Record<ToastMessage['kind'], string> = {
  info: colors.cyan,
  warn: colors.warning,
  error: colors.danger,
};

const VISIBLE_MS = 2600;

/** Slide-in notice used for joins, drops, pickups and BLE problems. */
export function Toast({toast, onDone}: Props) {
  const slide = useRef(new Animated.Value(0)).current;
  const accent = KIND_COLOR[toast.kind];

  useEffect(() => {
    Animated.spring(slide, {
      toValue: 1,
      useNativeDriver: true,
      speed: 16,
      bounciness: 8,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(slide, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => onDone(toast.id));
    }, VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [slide, toast.id, onDone]);

  const translateY = slide.interpolate({inputRange: [0, 1], outputRange: [-24, 0]});

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          borderColor: alpha(accent, 0.55),
          backgroundColor: alpha(accent, 0.14),
          opacity: slide,
          transform: [{translateY}],
        },
      ]}>
      <Text style={[styles.text, {color: accent}]} numberOfLines={2}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
