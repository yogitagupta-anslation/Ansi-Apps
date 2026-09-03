import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatDuration } from '../util/format';
import { Palette, fonts } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

/**
 * Live elapsed clock. Kept in its own component so the 10 Hz tick re-renders
 * one Text node instead of the whole board.
 */
export default function Stopwatch({ startedAt, running }: { startedAt: number; running: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running, startedAt]);

  // When `running` flips off the interval stops, so this freezes on its own.
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
  return <Text style={styles.text}>{formatDuration(elapsed)}</Text>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  text: {
    ...fonts.numeric,
    color: colors.textSecondary,
    fontSize: 14,
  },
});
