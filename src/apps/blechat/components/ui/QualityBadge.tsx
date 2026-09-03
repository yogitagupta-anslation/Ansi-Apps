import React from 'react';
import {View} from 'react-native';
import {radius, spacing, typography} from '../../config/theme';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';
import type {Theme} from '../../config/theme';
import {DenseText} from '../AppText';
import {qualityLabel} from '../../peers/LinkMetrics';

/**
 * "Excellent / Good / Fair / Poor" — the same words `qualityLabel` already used in the
 * Debug and Nearby screens as plain text, now a coloured pill. Deliberately not renamed to
 * "Excellent / Good / Weak / Unstable": the score is one number computed one way, and
 * showing it under two different vocabularies on two different screens would read as two
 * different measurements to anyone who saw both.
 *
 * Renders nothing below `MIN_SAMPLES_FOR_QUALITY` round trips — a badge guessing at
 * "Poor" from zero evidence is worse than no badge, which is exactly what `qualityLabel`
 * already encodes by returning null.
 */
export function QualityBadge({score}: {score: number | null}) {
  const styles = useStyles();
  const theme = useTheme();
  const label = qualityLabel(score);
  if (label === null || score === null) {
    return null;
  }
  const tone = toneFor(score, theme);
  return (
    <View style={[styles.badge, {backgroundColor: tone + '1a'}]}>
      <View style={[styles.dot, {backgroundColor: tone}]} />
      <DenseText style={[styles.text, {color: tone}]} numberOfLines={1}>
        {label}
      </DenseText>
    </View>
  );
}

function toneFor(score: number, t: Theme): string {
  if (score >= 80) {
    return t.ok;
  }
  if (score >= 60) {
    return t.tileBlueFg;
  }
  if (score >= 40) {
    return t.warn;
  }
  return t.error;
}

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  dot: {width: 6, height: 6, borderRadius: 3},
  text: {...typography.caption, fontWeight: '700'},
}));
