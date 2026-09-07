import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

/**
 * The whole motion vocabulary, in one file.
 *
 * Three effects, none of them decorative:
 *
 *   - content settles in rather than snapping in
 *   - a control acknowledges being pressed
 *   - something genuinely ongoing breathes, so "scanning" is distinguishable from stuck
 *
 * Everything is short (under 250ms), eased out rather than sprung, and runs on the native
 * driver so it cannot stutter behind JS work. There is no bounce and no overshoot: a
 * spring that overshoots reads as playful, and this app is asking people to trust it with
 * a conversation.
 *
 * All of it is disabled when the OS reduce-motion setting is on. That is not a nicety —
 * for some people motion is nausea, and an app that ignores the setting is not
 * professional whatever it looks like.
 */

const DURATION = {
  enter: 220,
  press: 90,
  pulse: 1400,
};

/** Tracks the OS reduce-motion setting, live. */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!cancelled) {
        setReduced(value);
      }
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduced;
}

interface FadeInProps {
  children: React.ReactNode;
  /**
   * Stagger, in list index. Capped internally — a long list must not make the last row
   * wait, so beyond a handful of items everything arrives together.
   */
  index?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Fade and a 6px rise.
 *
 * Small enough that it reads as the content settling rather than as an animation. The
 * rise is what makes it feel deliberate; without it a bare fade looks like a slow image
 * load.
 */
export function FadeIn({children, index = 0, style}: FadeInProps) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    // Capped at 5 so the sixth row onwards is not left waiting behind the stagger.
    const delay = Math.min(index, 5) * 40;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.enter,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/**
 * The bubble leaving the composer.
 *
 * A larger rise than `FadeIn`'s, and only for a message you just wrote: the point is
 * that the thing you typed visibly travels from the box at the bottom into the thread,
 * so the send is acknowledged before any tick can be. It runs once, on mount, and only
 * for outgoing messages that arrive while the screen is open — a thread being scrolled
 * back through must not re-animate its history.
 */
export function SendIn({children}: {children: React.ReactNode}) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {translateY: progress.interpolate({inputRange: [0, 1], outputRange: [22, 0]})},
          {scale: progress.interpolate({inputRange: [0, 1], outputRange: [0.94, 1]})},
        ],
      }}>
      {children}
    </Animated.View>
  );
}

/**
 * A tick landing.
 *
 * Replays whenever `token` changes, which callers key on delivery status — so the first
 * tick lands when the BLE write completes and the second when the peer's ACK arrives,
 * and nothing moves in between. That is the entire point: the motion marks a real event
 * on the wire, so a message that is merely sitting there never appears to progress.
 */
export function LandIn({token, children}: {token: string; children: React.ReactNode}) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced, token]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {scale: progress.interpolate({inputRange: [0, 1], outputRange: [0.5, 1]})},
        ],
      }}>
      {children}
    </Animated.View>
  );
}

interface TouchableProps extends PressableProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Off for full-width rows, where scaling the whole row looks wrong. */
  scale?: boolean;
}

/**
 * A press that acknowledges itself.
 *
 * Opacity always, a 1% scale only where it suits the shape. The point is confirmation
 * that the tap landed — on a BLE app half the actions take a second or two to show any
 * result, and silence in that gap is what makes people tap twice.
 */
export function Touchable({
  children,
  style,
  scale = true,
  ...rest
}: TouchableProps) {
  const reduced = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;

  const animate = (to: number) => {
    if (reduced) {
      return;
    }
    Animated.timing(value, {
      toValue: to,
      duration: DURATION.press,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  // Layout props (flex, width, height...) only take effect on the element that is
  // actually the flex child of the parent — that is this Pressable, not the Animated.View
  // nested inside it — so the FULL style belongs on the Pressable. It used to be
  // duplicated onto the inner view too, on the theory that paint props just draw twice
  // over each other; that is only true when the inner view exactly fills the outer one.
  // Any style carrying padding does not: the inner view's own copy of that padding insets
  // it a second time from content the Pressable's padding has already inset once, so a
  // border+padding style — a pill button, a chip, anything with both — rendered as two
  // concentric borders with a visible gap, not one. Only the subset that arranges the
  // CHILDREN of a row/column (flexDirection, alignItems, gap, ...) still needs to reach
  // the Animated.View, since icon+label are its direct children and Pressable itself only
  // ever has this one child to arrange.
  const flat = StyleSheet.flatten(style) ?? {};
  const childLayout: ViewStyle = {
    flexDirection: flat.flexDirection,
    alignItems: flat.alignItems,
    justifyContent: flat.justifyContent,
    flexWrap: flat.flexWrap,
    gap: flat.gap,
    rowGap: flat.rowGap,
    columnGap: flat.columnGap,
  };

  return (
    <Pressable
      {...rest}
      style={style}
      onPressIn={e => {
        animate(1);
        rest.onPressIn?.(e);
      }}
      onPressOut={e => {
        animate(0);
        rest.onPressOut?.(e);
      }}>
      <Animated.View
        style={[
          childLayout,
          {
            opacity: value.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.82],
            }),
            transform: scale
              ? [
                  {
                    scale: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 0.985],
                    }),
                  },
                ]
              : [],
          },
        ]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * One ring of a radar ping: expands from the centre and fades out, on a loop.
 *
 * Used only where "actively searching" is genuinely true — `active` should track the
 * real scan state, never play by default. Transform and opacity only, so it stays on the
 * native driver, and it respects reduce-motion like everything else here.
 */
export function RadarPing({
  active,
  size,
  color,
  delay = 0,
  duration = 1800,
}: {
  active: boolean;
  size: number;
  color: string;
  /** Offset before this ring's cycle starts, so several rings ping in sequence. */
  delay?: number;
  duration?: number;
}) {
  const reduced = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduced) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        // Snap back for the next lap. A timing back to 0 would visibly shrink the ring
        // before it disappears, which reads as the ping reversing rather than a new one
        // starting.
        Animated.timing(value, {toValue: 0, duration: 0, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, value, delay, duration]);

  if (!active && reduced) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity: active
          ? value.interpolate({inputRange: [0, 1], outputRange: [0.55, 0]})
          : 0,
        transform: [
          {
            scale: value.interpolate({inputRange: [0, 1], outputRange: [0.55, 1]}),
          },
        ],
      }}
    />
  );
}

/**
 * A slow breath, for something that is genuinely ongoing.
 *
 * Used only on the scanning indicator, where the alternative is a static dot that looks
 * identical whether the radio is working or wedged. Opacity only, no scale, and slow
 * enough not to pull the eye away from what the user is reading.
 */
export function Pulse({
  children,
  active,
  style,
}: {
  children: React.ReactNode;
  active: boolean;
  style?: ViewStyle | ViewStyle[];
}) {
  const reduced = useReduceMotion();
  const value = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || reduced) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.45,
          duration: DURATION.pulse / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: DURATION.pulse / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, value]);

  return <Animated.View style={[style, {opacity: value}]}>{children}</Animated.View>;
}

/**
 * The design's breathing dot: opacity 1 → 0.3 → 1 over 1.2s, ease-in-out, forever.
 *
 * Separate from `Pulse` rather than a prop on it because the two mean different things.
 * `Pulse` marks one element as live and fades to 0.45; this is the "something is ongoing"
 * beat used in three places — the scanning dot on Nearby, and the three typing dots in a
 * thread, which are the reason `delay` exists. Staggering them by 0.18s is what turns
 * three blinking dots into one travelling wave.
 *
 * It honours reduce-motion by holding at full opacity. A caller that needs the state to
 * survive that must say it in text as well — a dot that has stopped moving cannot be the
 * only thing reporting that a scan is running.
 */
export function BreathingDot({
  size = 6,
  color,
  delay = 0,
  active = true,
  style,
}: {
  size?: number;
  color: string;
  /** Seconds-scale offset, in ms. The design staggers by 180 and 360. */
  delay?: number;
  active?: boolean;
  style?: ViewStyle | ViewStyle[];
}) {
  const reduced = useReduceMotion();
  const value = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || reduced) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.3,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    // Delay once, before the loop, rather than inside it: a delay inside the sequence
    // would insert a pause into every cycle and the three dots would stutter together
    // instead of chasing each other.
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [active, delay, reduced, value]);

  return (
    <Animated.View
      style={[
        {width: size, height: size, borderRadius: size / 2, backgroundColor: color},
        style,
        {opacity: value},
      ]}
    />
  );
}
