/**
 * CheckInButton.tsx
 * -----------------------------------------------------------------------------
 * The big circular check-in control on the Employee home — concentric rings
 * with a pressable core, per the agreed punch-clock design.
 *
 * WHAT PRESSING IT MEANS in this architecture: "Check in" starts broadcasting
 * this phone's employee ID so the office Host can detect it and record the
 * check-in; "Check out" stops broadcasting. The button controls the RADIO —
 * the times shown elsewhere on the screen come only from what the Host
 * delivers back over the reply channel, never from this button being pressed.
 *
 * While live, one ring breathes gently on the UI thread. Honesty rule: the
 * animation runs only while the advertiser is genuinely ACTIVE.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Icon } from './Icon';
import { Txt } from './ui';

const DIAMETER = 232;
/** Ring diameters, outermost first, echoing the reference's ripple. */
const RINGS = [1, 0.86, 0.72, 0.58];

export function CheckInButton({
  live,
  busy = false,
  disabled = false,
  onPress,
}: {
  /** REAL advertiser state — drives colour, label and the breathing ring. */
  live: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!live) {
      breath.stopAnimation(() => breath.setValue(0));
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, breath]);

  const tone = live ? t.colors.success : t.colors.textMuted;
  const coreBg = live ? t.colors.successSoft : t.colors.surface;

  return (
    <View style={[styles.wrap, { height: DIAMETER, width: DIAMETER }]}>
      {/* Static ripple rings. Hairline, fading outward like the reference. */}
      {RINGS.map((scale, i) => (
        <View
          key={scale}
          style={[
            styles.ring,
            {
              borderColor: live ? t.colors.successBorder : t.colors.border,
              borderRadius: (DIAMETER * scale) / 2,
              height: DIAMETER * scale,
              opacity: 0.35 + i * 0.2,
              width: DIAMETER * scale,
            },
          ]}
        />
      ))}

      {/* One breathing ring while genuinely on air. */}
      {live ? (
        <Animated.View
          style={[
            styles.ring,
            {
              borderColor: t.colors.success,
              borderRadius: DIAMETER / 2,
              borderWidth: 1.5,
              height: DIAMETER,
              width: DIAMETER,
              opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.5] }),
              transform: [
                { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              ],
            },
          ]}
        />
      ) : null}

      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={live ? 'Check out' : 'Check in'}
        accessibilityState={{ disabled: disabled || busy, busy }}
        style={({ pressed }) => [
          styles.core,
          {
            backgroundColor: coreBg,
            borderColor: live ? t.colors.success : t.colors.border,
            height: DIAMETER * 0.44,
            width: DIAMETER * 0.44,
            borderRadius: (DIAMETER * 0.44) / 2,
            opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          },
          t.shadow(2),
        ]}>
        <Icon
          name={busy ? 'loader' : live ? 'log-out' : 'pointer'}
          size={22}
          color={tone}
        />
        <Txt variant="captionMedium" color={tone} style={{ marginTop: 6 }}>
          {busy ? 'Working…' : live ? 'Check out' : 'Check in'}
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center' },
  ring: { borderWidth: StyleSheet.hairlineWidth, position: 'absolute' },
  core: { alignItems: 'center', borderWidth: 1, justifyContent: 'center' },
});
