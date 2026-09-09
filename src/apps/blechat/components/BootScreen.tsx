import React from 'react';
import {View} from 'react-native';

import {AppText, DenseText} from './AppText';
import {BreathingDot} from './Motion';
import {RippleStage} from './ui/RippleStage';
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

  return (
    <View style={styles.root}>
      <RippleStage size={150} />

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
  words: {alignItems: 'center', marginTop: spacing.xl},
  name: {...typography.title, color: t.text},
  status: {...typography.caption, color: t.textDim, marginTop: 6},
  dots: {flexDirection: 'row', gap: 5, marginTop: spacing.xl + spacing.md},
}));
