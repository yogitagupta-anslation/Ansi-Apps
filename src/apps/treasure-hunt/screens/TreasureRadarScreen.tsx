import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  CompassRadar,
  GameBackground,
  Panel,
  Screen,
  ScreenHeader,
} from '../components';
import {useGame} from '../state/GameContext';
import {PROXIMITY_TIER_BY_LEVEL} from '../config/gameConfig';
import {alpha, colors, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'TreasureRadar'>;

/**
 * The dedicated radar view.
 *
 * Everything here comes from the host's proximity report: a tier, a quantised
 * distance band, and a bearing only when a Hint or Radar power-up is running.
 * The dial never shows the treasure's actual coordinates.
 */
export function TreasureRadarScreen({navigation}: Props) {
  const {proximity} = useGame();
  const tier = PROXIMITY_TIER_BY_LEVEL[proximity.level];

  return (
    <Screen>
      <GameBackground variant="map">
        <ScreenHeader
          title="Treasure Radar"
          onBack={() => navigation.goBack()}
          rightGlyph="❓"
        />

        {/* Dial on the left, readout on the right: stacked, the panel and
            footnote fall off the bottom of a landscape screen. */}
        <View style={styles.body}>
          <View style={styles.radarWrap}>
            <CompassRadar
              level={proximity.level}
              bearingDeg={proximity.bearingDeg}
              distanceBand={proximity.distanceBand}
              size={250}
            />
          </View>

          <View style={styles.column}>
          <Panel style={styles.readout}>
            <Text style={typography.sectionLabel}>Proximity</Text>
            <View style={styles.readoutRow}>
              <Text style={styles.readoutGlyph}>{tier.glyph}</Text>
              <Text style={[styles.readoutLevel, {color: tier.color}]}>
                {tier.label}
              </Text>
            </View>
            <Text style={styles.readoutHint}>
              {proximity.boosted
                ? 'Radar lock — readings are sharper right now.'
                : proximity.bearingDeg !== undefined
                  ? 'Hint active — the dial shows a rough bearing.'
                  : 'Move around and watch the reading change.'}
            </Text>
          </Panel>

          <Text style={styles.footnote}>
            Distance is measured between virtual world coordinates — never from
            Bluetooth signal strength.
          </Text>
          </View>
        </View>
      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.xl,
  },
  column: {
    flex: 1,
    gap: spacing.md,
  },
  radarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  readoutGlyph: {
    fontSize: 26,
  },
  readoutLevel: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1,
  },
  readoutHint: {
    ...typography.bodyMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  footnote: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 16,
    color: alpha(colors.textMuted, 0.9),
  },
});
