import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {GameBackground, GameButton, RadialGlow, Screen} from '../components';
import {useGame} from '../state/GameContext';
import {HIT_SLOP, alpha, colors, radius, spacing} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** On-screen width of the title sign, in points. */
const LOGO_WIDTH = 250;

/**
 * The title screen, laid out for landscape.
 *
 * Two columns: identity on the left, the three ways into a game on the right.
 * Stacking them vertically would push the buttons off a short landscape screen.
 */
export function HomeScreen({navigation}: Props) {
  const {profile} = useGame();
  const float = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    bob.start();
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {toValue: 1, duration: 1600, useNativeDriver: true}),
        Animated.timing(shimmer, {toValue: 0, duration: 1600, useNativeDriver: true}),
      ]),
    );
    glow.start();
    return () => {
      bob.stop();
      glow.stop();
    };
  }, [float, shimmer]);

  const translateY = float.interpolate({inputRange: [0, 1], outputRange: [0, -7]});
  const glowOpacity = shimmer.interpolate({inputRange: [0, 1], outputRange: [0.18, 0.42]});

  return (
    <Screen background={colors.abyss}>
      <GameBackground variant="lobby">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={HIT_SLOP}
          onPress={() => navigation.navigate('Settings')}
          style={({pressed}) => [styles.gear, pressed && {opacity: 0.6}]}>
          <Text style={styles.gearGlyph}>⚙️</Text>
        </Pressable>

        <View style={styles.columns}>
          {/* ---- left: identity ---- */}
          <View style={styles.brandColumn}>
            <Animated.View style={[styles.logoGlow, {opacity: glowOpacity}]}>
              <RadialGlow color={colors.amber} size={230} rings={9} step={0.05} />
            </Animated.View>
            <Animated.View style={{transform: [{translateY}], alignItems: 'center'}}>
              <Image
                source={require('../assets/logo-treasure-hunt.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel="Treasure Hunt"
              />
            </Animated.View>
            <Text style={styles.tagline}>
              Find the hidden treasure in a virtual world
            </Text>
            {profile ? (
              <View style={styles.profileStrip}>
                <Text style={styles.profileAvatar}>{profile.avatar}</Text>
                <Text style={styles.profileName} numberOfLines={1}>
                  {profile.name}
                </Text>
              </View>
            ) : null}
          </View>

          {/* ---- right: ways in ---- */}
          <View style={styles.actionColumn}>
            <GameButton
              label="Create Game"
              icon="👑"
              tone="gold"
              onPress={() => navigation.navigate('CreateGame')}
            />
            <GameButton
              label="Join Game"
              icon="🔍"
              tone="blue"
              onPress={() => navigation.navigate('Join')}
            />
            <GameButton
              label="How to Play"
              icon="❓"
              tone="dark"
              size="md"
              onPress={() => navigation.navigate('HowToPlay')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Solo practice"
              onPress={() => navigation.navigate('CreateGame', {solo: true})}
              style={({pressed}) => [styles.soloLink, pressed && {opacity: 0.6}]}>
              <Text style={styles.soloText}>🎯 Solo practice — no Bluetooth needed</Text>
            </Pressable>
          </View>
        </View>
      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gear: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha('#000000', 0.35),
    borderWidth: 1,
    borderColor: alpha(colors.text, 0.18),
    zIndex: 5,
  },
  gearGlyph: {
    fontSize: 18,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.xxl,
  },
  brandColumn: {
    flex: 1.1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    // Native art is 462x203; held to a third of the brand column so the sign
    // and its lantern stay legible without crowding the buttons.
    width: LOGO_WIDTH,
    height: LOGO_WIDTH * (203 / 462),
  },
  logoGlow: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: {
    marginTop: spacing.md,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: alpha(colors.text, 0.9),
  },
  profileStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: alpha('#000000', 0.3),
  },
  profileAvatar: {
    fontSize: 15,
  },
  profileName: {
    fontSize: 12,
    fontWeight: '700',
    color: alpha(colors.text, 0.85),
  },
  actionColumn: {
    flex: 1,
    gap: spacing.md,
    maxWidth: 380,
  },
  soloLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  soloText: {
    fontSize: 11,
    fontWeight: '600',
    color: alpha(colors.text, 0.75),
  },
});
