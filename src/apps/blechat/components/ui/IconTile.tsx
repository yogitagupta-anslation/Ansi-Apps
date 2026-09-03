import React from 'react';
import {View} from 'react-native';
import {makeStyles} from '../../theme/ThemeProvider';
import {Icon, type IconName} from './Icon';

/** A rounded square of soft colour with a matching-hue icon centred in it. */
export function IconTile({
  icon,
  bg,
  fg,
  size = 40,
  iconSize,
}: {
  icon: IconName;
  bg: string;
  fg: string;
  size?: number;
  iconSize?: number;
}) {
  const styles = useStyles();
  return (
    <View
      style={[
        styles.tile,
        {width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg},
      ]}>
      <Icon name={icon} color={fg} size={iconSize ?? size * 0.5} />
    </View>
  );
}

/**
 * A row of small dots, fading toward the tail — the "signal" flourish under the
 * Scanning/Discoverable subcards. Purely decorative: it does not encode a real value,
 * it echoes the pulse this app already uses to show something is ongoing.
 */
export function DotTrail({color, count = 5}: {color: string; count?: number}) {
  const styles = useStyles();
  return (
    <View style={styles.trail}>
      {Array.from({length: count}, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {backgroundColor: color, opacity: 1 - i * (0.75 / count)},
          ]}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  tile: {alignItems: 'center', justifyContent: 'center'},
  trail: {flexDirection: 'row', gap: 4, marginTop: 8},
  dot: {width: 5, height: 5, borderRadius: 2.5},
}));
