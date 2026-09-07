import React, {useEffect, useRef} from 'react';
import {Alert, Animated, Easing, View} from 'react-native';

import {Icon} from './Icon';
import {Touchable, useReduceMotion} from '../Motion';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';

/**
 * "What am I looking at?", as a tappable ⓘ.
 *
 * The Debug screen is the one place in the app that is unapologetically technical — MTU,
 * duty cycle, replayed packets, ACK latency. Every one of those is a real measurement
 * worth showing, and none of them explains itself to somebody who did not write the
 * transport. The alternative to this was a paragraph of help text under each section,
 * which would have doubled the length of the screen to explain things most readers only
 * need explained once.
 *
 * So the explanation is one tap away and invisible until asked for. A plain Alert holds
 * it rather than a custom sheet: it is a page of text with an OK button, the platform
 * already draws that correctly, and a bespoke overlay here would be one more thing to
 * maintain for no gain.
 */
export function InfoDot({
  /** Shown as the alert's heading — normally the section's own title. */
  title,
  /** Plain English. One short paragraph per term, in the order they appear above. */
  body,
  size = 15,
}: {
  title: string;
  body: string;
  size?: number;
}) {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <Touchable
      scale={false}
      hitSlop={10}
      onPress={() => Alert.alert(title, body)}
      accessibilityRole="button"
      accessibilityLabel={`What does ${title} mean?`}
      style={styles.dot}>
      <Icon name="info" size={size} color={theme.textFaint} strokeWidth={1.7} />
    </Touchable>
  );
}

/**
 * The same affordance, breathing once when the screen first appears.
 *
 * Used on the first section only. An ⓘ that never moves is furniture — it took several
 * visits to this screen before anyone noticed the one that was already there — and a
 * single slow pulse on arrival is enough to say "these are tappable" without a coach
 * mark or a tooltip queue. It runs twice and stops; a control that pulses forever is
 * asking for attention it does not deserve after the first time.
 */
export function InfoDotHint({title, body}: {title: string; body: string}) {
  const styles = useStyles();
  const theme = useTheme();
  const reduced = useReduceMotion();
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      return;
    }
    const beat = Animated.sequence([
      Animated.timing(halo, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(halo, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    // Twice, then never again for this mount.
    const loop = Animated.sequence([Animated.delay(600), beat, Animated.delay(400), beat]);
    loop.start();
    return () => loop.stop();
  }, [halo, reduced]);

  return (
    <View style={styles.hintWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            backgroundColor: theme.accentSoft,
            opacity: halo.interpolate({inputRange: [0, 1], outputRange: [0, 0.9]}),
            transform: [
              {scale: halo.interpolate({inputRange: [0, 1], outputRange: [0.6, 1.5]})},
            ],
          },
        ]}
      />
      <InfoDot title={title} body={body} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  dot: {padding: 2},
  hintWrap: {alignItems: 'center', justifyContent: 'center'},
  halo: {position: 'absolute', width: 26, height: 26, borderRadius: 13},
}));
