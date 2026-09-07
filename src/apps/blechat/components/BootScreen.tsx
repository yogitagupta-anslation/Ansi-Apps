import React, {useEffect, useRef} from 'react';
import {Animated, Easing, View} from 'react-native';

import {AppText, DenseText} from './AppText';
import {BreathingDot, useReduceMotion} from './Motion';
import {Mascot} from './ui/Mascot';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {spacing, typography} from '../config/theme';

/**
 * The moment before the app exists.
 *
 * This replaced a bare spinner. The wait is real — identity is loaded from storage, the
 * conversation store is hydrated and the BLE stack is brought up — so there is something
 * true to say during it, and the ripples are the app's own visual language rather than a
 * platform spinner that could belong to anything.
 *
 * `status` is passed in rather than invented here: a boot screen that always says the
 * same reassuring sentence is a progress bar that only moves forward, and the one thing
 * this screen must not do is claim the radio is waking when it has not been asked to.
 */
export function BootScreen({status}: {status: string}) {
  const styles = useStyles();
  const theme = useTheme();
  const reduced = useReduceMotion();

  // Two rings, offset, so the second leaves before the first has finished — one ripple
  // on its own reads as a pulse rather than something travelling outwards.
  const first = useRef(new Animated.Value(0)).current;
  const second = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      return;
    }
    const ring = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 2800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {toValue: 0, duration: 0, useNativeDriver: true}),
        ]),
      );
    const a = ring(first, 0);
    const b = ring(second, 1400);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [first, second, reduced]);

  const ripple = (value: Animated.Value) => ({
    transform: [
      {scale: value.interpolate({inputRange: [0, 1], outputRange: [0.72, 1.5]})},
    ],
    opacity: value.interpolate({inputRange: [0, 1], outputRange: [0.38, 0]}),
  });

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, {borderColor: theme.accent}, ripple(first)]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, {borderColor: theme.accent}, ripple(second)]}
        />
        <Mascot size={86} tint={theme.accent} />
      </View>

      <View style={styles.words}>
        <AppText style={styles.name}>BLE Chat</AppText>
        <DenseText style={styles.status}>{status}</DenseText>
      </View>

      {/* The same three-dot beat the thread uses for "someone is typing" — it means
          "working on it" in both places, which is one idea rather than two. */}
      <View style={styles.dots}>
        <BreathingDot size={5} color={theme.textFaint} />
        <BreathingDot size={5} color={theme.textFaint} delay={180} />
        <BreathingDot size={5} color={theme.textFaint} delay={360} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  root: {flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center'},
  stage: {width: 150, height: 150, alignItems: 'center', justifyContent: 'center'},
  ring: {position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1},
  words: {alignItems: 'center', marginTop: spacing.xl},
  name: {...typography.title, color: t.text},
  status: {...typography.caption, color: t.textDim, marginTop: 6},
  dots: {flexDirection: 'row', gap: 5, marginTop: spacing.xl + spacing.md},
}));
