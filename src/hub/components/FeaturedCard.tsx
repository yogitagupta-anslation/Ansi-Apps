/**
 * The featured slot.
 *
 * Larger than a row because it is doing a different job: a row helps you find the app you
 * already wanted, this one has to interest someone who wasn't looking. So it gets the
 * long description rather than the tagline, and a hairline of the app's own accent around
 * a tinted ground — enough for the card to belong to the app without the launcher
 * suddenly changing colour.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppTile } from './AppTile';
import { Icon } from './Icon';
import { Press } from './Press';
import type { HubApp } from '../registry';
import { lift, radius, space, typeScale as t } from '../theme';
import { useHubTheme } from '../useHubTheme';

export function FeaturedCard({
  app,
  onPress,
}: {
  app: HubApp;
  onPress(): void;
}): React.ReactElement {
  const theme = useHubTheme();

  return (
    <Press
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`Featured: ${app.name}. ${app.tagline}`}
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: app.accentSoft },
        lift(theme, 2),
      ]}
    >
      <LinearGradient
        colors={[app.accentSoft, 'transparent']}
        style={styles.wash}
        pointerEvents="none"
      />

      <View style={styles.head}>
        <AppTile app={app} size="lg" />
        <View style={styles.headText}>
          <Text style={[t.name, { color: theme.text }]} numberOfLines={1}>
            {app.name}
          </Text>
          <Text style={[t.metaStrong, { color: app.accent }]} numberOfLines={1}>
            {app.tagline}
          </Text>
        </View>
      </View>

      <Text style={[t.body, { color: theme.textDim }]} numberOfLines={3}>
        {app.description}
      </Text>

      <View style={styles.foot}>
        <View style={[styles.pill, { backgroundColor: app.accent }]}>
          <Text style={[t.metaStrong, styles.pillText]}>Open</Text>
          <Icon name="arrow-right" size={14} color="#0B1020" />
        </View>
        <Text style={[t.meta, { color: theme.textFaint }]}>{app.tags[0]}</Text>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.xxl,
    padding: space.lg,
    gap: space.md,
    overflow: 'hidden',
  },
  // A tint behind the header that fades out, rather than a flat band. A solid block ends
  // on a hard horizontal line across the middle of the card, which reads as a seam
  // between two cards rather than as one card with a tinted top.
  //
  // Written out rather than spread from `StyleSheet.absoluteFill`: that is a registered
  // style ID in this version of React Native, not an object, so spreading it yields
  // nothing and the band would quietly render in flow.
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 132 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, gap: 3 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  // Dark ink on a bright accent: every app accent in the registry is a light hue, so
  // this stays the readable direction for all of them.
  pillText: { color: '#0B1020' },
});
