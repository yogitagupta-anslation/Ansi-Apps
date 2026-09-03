import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  GameBackground,
  GameButton,
  Panel,
  Screen,
  ScreenHeader,
} from '../components';
import {PROXIMITY_TIERS, SCORING} from '../config/gameConfig';
import {ProximityLevel} from '../models/game';
import {alpha, colors, radius, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'HowToPlay'>;

const STEPS = [
  {
    icon: '📡',
    color: colors.gold,
    title: 'Host or join',
    body: 'One phone hosts and shows a 4-digit code. Everyone else scans over Bluetooth and taps the hunt.',
  },
  {
    icon: '🌍',
    color: colors.green,
    title: 'A world appears',
    body: 'The host generates a random world. Only a tiny seed travels over Bluetooth — every phone rebuilds the same map locally.',
  },
  {
    icon: '🕹',
    color: colors.blue,
    title: 'Move and search',
    body: 'Drag anywhere on the map to walk — your hunter follows your finger. Sweep over coins and power-ups as you go.',
  },
  {
    icon: '🔥',
    color: colors.ember,
    title: 'Follow hot and cold',
    body: 'The banner and radar tell you how close the treasure is. Reach it first for the biggest score.',
  },
] as const;

const POWERUPS = [
  {glyph: '🔍', name: 'Treasure Radar', body: 'Sharpens the proximity reading.'},
  {glyph: '🧭', name: 'Hint', body: 'Reveals a rough bearing to the treasure.'},
  {glyph: '⚡', name: 'Speed Boost', body: 'Move faster for a short while.'},
  {glyph: '🔥', name: 'Double Points', body: 'Doubles everything you bank.'},
  {glyph: '🛡', name: 'Shield', body: 'Blocks tags from rival hunters.'},
] as const;

export function HowToPlayScreen({navigation}: Props) {
  return (
    <Screen>
      <GameBackground variant="popup">
        <ScreenHeader title="How to Play" onBack={() => navigation.goBack()} />

        <ScrollView
          removeClippedSubviews={false}
          style={styles.scrollFlex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          {/* Two columns: the walkthrough on the left, the reference tables on
              the right, so a landscape screen shows both at once. */}
          <View style={styles.columns}>
          <View style={styles.column}>
          {STEPS.map((step, index) => (
            <Panel key={step.title} padded={false} style={styles.step}>
              <View
                style={[
                  styles.stepIcon,
                  {
                    backgroundColor: alpha(step.color, 0.2),
                    borderColor: alpha(step.color, 0.6),
                  },
                ]}>
                <Text style={styles.stepGlyph}>{step.icon}</Text>
              </View>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>
                  {index + 1}. {step.title}
                </Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            </Panel>
          ))}

          <Panel accent={colors.cyan} style={styles.offline}>
            <Text style={styles.offlineTitle}>Fully offline</Text>
            <Text style={styles.offlineBody}>
              No internet, no GPS, no maps and no server. The world, the treasure
              and every position are virtual coordinates generated on your phone.
              Bluetooth only carries messages between players.
            </Text>
          </Panel>
          </View>

          <View style={styles.column}>
          <Text style={[typography.sectionLabel, styles.heading]}>Hot &amp; Cold</Text>
          <Panel>
            {PROXIMITY_TIERS.slice()
              .reverse()
              .map(tier => (
                <View key={tier.level} style={styles.tierRow}>
                  <Text style={styles.tierGlyph}>{tier.glyph}</Text>
                  <Text style={[styles.tierLabel, {color: tier.color}]}>{tier.label}</Text>
                  <Text style={styles.tierRange}>
                    {tier.maxDistance === Number.POSITIVE_INFINITY
                      ? 'far away'
                      : tier.level === ProximityLevel.Found
                        ? `within ${tier.maxDistance}`
                        : `under ${tier.maxDistance}`}
                  </Text>
                </View>
              ))}
            <Text style={styles.note}>
              Distance is measured between virtual world coordinates. Bluetooth
              signal strength is never used.
            </Text>
          </Panel>

          <Text style={[typography.sectionLabel, styles.heading]}>Scoring</Text>
          <Panel>
            <ScoreRow label="Treasure found" points={SCORING.treasureFound} />
            <ScoreRow label="First finder bonus" points={SCORING.firstFinderBonus} />
            <ScoreRow label="Rare gem" points={SCORING.gem} />
            <ScoreRow label="Power-up" points={SCORING.powerUp} />
            <ScoreRow label="Coin" points={SCORING.coin} />
            <ScoreRow label="Tagged by a rival" points={-SCORING.taggedPenalty} />
          </Panel>

          <Text style={[typography.sectionLabel, styles.heading]}>Power-ups</Text>
          <Panel>
            {POWERUPS.map(item => (
              <View key={item.name} style={styles.powerRow}>
                <Text style={styles.powerGlyph}>{item.glyph}</Text>
                <View style={styles.powerText}>
                  <Text style={styles.powerName}>{item.name}</Text>
                  <Text style={styles.powerBody}>{item.body}</Text>
                </View>
              </View>
            ))}
          </Panel>

          <View style={styles.actions}>
            <GameButton
              label="Got it"
              tone="gold"
              size="md"
              onPress={() => navigation.goBack()}
              style={styles.action}
            />
          </View>
          </View>
          </View>
        </ScrollView>

      </GameBackground>
    </Screen>
  );
}

function ScoreRow({label, points}: {label: string; points: number}) {
  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={[styles.scoreValue, points < 0 && {color: colors.danger}]}>
        {points > 0 ? `+${points}` : points}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  column: {
    flex: 1,
    gap: spacing.md,
  },
  /**
   * Actions live at the end of the scroll content, not in a pinned bar.
   * A short landscape screen has no room for a permanent footer, and a pinned
   * one clipped the last button against the gesture bar.
   */
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  action: {
    flex: 1,
    maxWidth: 260,
  },
  scrollFlex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontSize: 17,
  },
  stepText: {
    flex: 1,
    gap: 3,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  stepBody: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  heading: {
    marginTop: spacing.md,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
  },
  tierGlyph: {
    fontSize: 15,
    width: 26,
  },
  tierLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  tierRange: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  note: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  scoreLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDim,
  },
  scoreValue: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.gold,
  },
  powerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 7,
  },
  powerGlyph: {
    fontSize: 20,
    width: 28,
  },
  powerText: {
    flex: 1,
    gap: 2,
  },
  powerName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  powerBody: {
    fontSize: 11,
    color: colors.textMuted,
  },
  offline: {
    marginTop: spacing.md,
  },
  offlineTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.cyan,
    marginBottom: spacing.xs,
  },
  offlineBody: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
