import React from 'react';
import {View} from 'react-native';
import {RadarPing} from '../Motion';
import {DenseText} from '../AppText';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';
import {typography} from '../../config/theme';
import {TRAFFIC_WINDOW, formatRate, type LinkTraffic} from '../../peers/useLinkTraffic';

/**
 * A ring around an avatar that expands only while bytes are actually crossing the link.
 *
 * The rule this enforces is the whole point: two live links, one carrying traffic, must
 * not look the same. Animating presence on every connected peer would make a healthy
 * idle link identical to a busy one — and "idle" is a perfectly good state, quite
 * different from "in trouble", which is the distinction a pulsing ring would destroy.
 *
 * So a still ring here means a live link with nothing on it. That is information, not an
 * animation that failed to start.
 */
export function TrafficRing({
  size,
  active,
  children,
}: {
  /** Diameter of the thing being ringed — the rings are drawn outside it. */
  size: number;
  active: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{width: size, height: size, alignItems: 'center', justifyContent: 'center'}}>
      {/* Two rings, half a cycle apart, so a sustained transfer reads as continuous
          rather than as a single ping repeating. */}
      <RadarPing active={active} size={size + 26} color={theme.ok} duration={1500} />
      <RadarPing active={active} size={size + 26} color={theme.ok} delay={750} duration={1500} />
      {children}
    </View>
  );
}

/**
 * The last few seconds of throughput, as bars.
 *
 * Deliberately unlabelled per bar and unscaled to any absolute axis: the question it
 * answers is "is anything moving, and is it steady or bursty", which is what BLE
 * throughput actually varies by. Putting a KB/s axis on five samples would imply a
 * precision the radio does not have.
 */
export function ByteSparkline({traffic}: {traffic: LinkTraffic}) {
  const styles = useStyles();
  const theme = useTheme();

  // Pad the left so the bars fill from the right as samples arrive, instead of the
  // whole strip resizing every second while the window warms up.
  const samples = [
    ...Array(Math.max(0, TRAFFIC_WINDOW - traffic.history.length)).fill(0),
    ...traffic.history,
  ];
  const peak = Math.max(1, ...samples);

  return (
    <View style={styles.sparkline}>
      <View style={styles.bars}>
        {samples.map((value, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                // A floor of 2px: a zero-height bar disappears, and an empty second is
                // itself worth seeing in the run of bars.
                height: Math.max(2, Math.round((value / peak) * 18)),
                backgroundColor: value > 0 ? theme.ok : theme.border,
              },
            ]}
          />
        ))}
      </View>
      <DenseText style={styles.caption} numberOfLines={1}>
        Bytes on the link, last {TRAFFIC_WINDOW} seconds
      </DenseText>
    </View>
  );
}

/** "Receiving · 1.4 KB/s" while something is moving, "idle" when nothing is. */
export function trafficLabel(traffic: LinkTraffic): string {
  if (!traffic.active) {
    return 'idle';
  }
  const verb = traffic.direction === 'rx' ? 'Receiving' : 'Sending';
  return `${verb} · ${formatRate(traffic.rate)}`;
}

const useStyles = makeStyles(t => ({
  sparkline: {marginTop: 10},
  bars: {flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 18},
  bar: {flex: 1, borderRadius: 2, maxWidth: 14},
  caption: {...typography.caption, color: t.textFaint, fontSize: 10, marginTop: 4},
}));
