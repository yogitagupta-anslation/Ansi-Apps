import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Image, StyleSheet, Text, View} from 'react-native';
import {ProximityLevel} from '../models/game';
import {PROXIMITY_TIER_BY_LEVEL} from '../config/gameConfig';

/**
 * The kit's flame banner, announcing a warmer reading.
 *
 * The art ships with "YOU'RE GETTING WARMER!" painted on; that was erased so
 * the same frame can carry whichever tier the hunter just reached. It only
 * fires when proximity *improves* — announcing every change would mean a
 * banner on screen constantly while wandering.
 */

const BANNER_RATIO = 487 / 125;
/** The well the label sits in, as fractions of the art. */
const LABEL_X = 104 / 487;
const LABEL_W = (458 - 104) / 487;

interface Props {
  level: ProximityLevel | null;
  width?: number;
  onDone: () => void;
}

export function TierBanner({level, width = 300, onDone}: Props) {
  const anim = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!level) {
      return;
    }
    anim.setValue(0);
    const run = Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(1.6)),
        useNativeDriver: true,
      }),
      Animated.delay(1300),
      Animated.timing(anim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    run.start(({finished}) => {
      if (finished) {
        doneRef.current();
      }
    });
    return () => run.stop();
  }, [anim, level]);

  if (!level) {
    return null;
  }

  const height = width / BANNER_RATIO;
  const tier = PROXIMITY_TIER_BY_LEVEL[level];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          opacity: anim,
          transform: [
            {translateY: anim.interpolate({inputRange: [0, 1], outputRange: [-18, 0]})},
            {scale: anim.interpolate({inputRange: [0, 1], outputRange: [0.86, 1]})},
          ],
        },
      ]}>
      <View style={{width, height}}>
        <Image
          source={require('../assets/banner-tier.png')}
          style={{width, height}}
          resizeMode="contain"
          fadeDuration={0}
        />
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[
            styles.label,
            {
              left: width * LABEL_X,
              width: width * LABEL_W,
              top: height * 0.33,
              fontSize: height * 0.27,
              color: tier?.color,
            },
          ]}>
          {tier?.label ?? ''}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  label: {
    position: 'absolute',
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: 0.8,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 2},
    textShadowRadius: 4,
  },
});
