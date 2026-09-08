import React, {useMemo} from 'react';
import {View} from 'react-native';
import Svg, {Circle, Line} from 'react-native-svg';
import {AppText, DenseText} from '../AppText';
import {RadarPing, Touchable} from '../Motion';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';
import {radius as radii, typography} from '../../config/theme';

export interface Blip {
  key: string;
  name: string;
  /** Raw dBm. Null when the platform did not report one. */
  rssi: number | null;
  /** Still advertising — drives the ripple, and only that. */
  live: boolean;
  onPress?: () => void;
}

/**
 * Where a blip sits, radially, from its RSSI.
 *
 * −40 dBm or better is on top of you; −95 is at the rim. This is a monotonic mapping of
 * a measured value and nothing else — no smoothing, no invented "distance in metres".
 * RSSI is not a distance (a body between two phones costs more than a few metres of
 * air), so the ring labels say dBm and the caption says measured, not "near".
 */
function radiusFor(rssi: number | null, max: number): number {
  if (rssi === null) {
    // Unknown signal parks at the rim rather than the centre: the centre means "right
    // here", which is a claim, and the rim means "we cannot say", which is the truth.
    return max;
  }
  const clamped = Math.min(-40, Math.max(-95, rssi));
  return ((-40 - clamped) / 55) * max;
}

/**
 * A stable angle per peer.
 *
 * Derived from the key rather than from list position, so a peer does not swing around
 * the dial every time the sort order changes or another device appears. The dial is not
 * a direction — BLE gives no bearing — so the only property that matters is that it
 * stays put.
 */
function angleFor(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return (hash / 360) * Math.PI * 2;
}

/**
 * The discovery radar.
 *
 * This is the spinner the pull-to-rescan gesture turns into, so the transition has to be
 * worth making: a radar that placed blips arbitrarily would be a decorative replacement
 * for an honest spinner, which is a straight downgrade. Every blip's distance from the
 * centre is its measured RSSI, and each one ripples only while it is still advertising —
 * so a peer that has gone quiet visibly stops moving before it disappears.
 */
export function Radar({
  size,
  blips,
  scanning,
}: {
  size: number;
  blips: Blip[];
  /** Drives the sweep behind the rings. Never true when the radio is not scanning. */
  scanning: boolean;
}) {
  const styles = useStyles();
  const theme = useTheme();

  const centre = size / 2;
  const maxRadius = size / 2 - 18;

  const placed = useMemo(
    () =>
      blips.map(blip => {
        const r = radiusFor(blip.rssi, maxRadius);
        const a = angleFor(blip.key);
        return {
          ...blip,
          x: centre + r * Math.cos(a),
          y: centre + r * Math.sin(a),
          // Labels sit to the right of their blip by default, which runs them off the
          // dial — and off the screen — for anything near the right rim. Past the
          // midline they flip to the left instead, so the text stays inside the radar
          // whatever the signal happens to be.
          flip: centre + r * Math.cos(a) > centre,
          tone:
            blip.rssi === null
              ? theme.textFaint
              : blip.rssi >= -60
              ? theme.ok
              : blip.rssi >= -75
              // Blue, not the chrome accent: that is a neutral now, and a neutral blip
              // would read as "signal unknown", which is the one thing it is not.
              ? theme.tileBlueFg
              : theme.tileAmberFg,
        };
      }),
    [blips, centre, maxRadius, theme],
  );

  return (
    <View style={{width: size, height: size, alignSelf: 'center'}}>
      <Svg width={size} height={size} style={{position: 'absolute'}}>
        {[1, 0.72, 0.44, 0.16].map(scale => (
          <Circle
            key={scale}
            cx={centre}
            cy={centre}
            r={maxRadius * scale}
            stroke={theme.border}
            strokeWidth={1}
            fill="none"
          />
        ))}
        <Line
          x1={centre}
          y1={centre - maxRadius}
          x2={centre}
          y2={centre + maxRadius}
          stroke={theme.border}
          strokeWidth={1}
        />
        <Line
          x1={centre - maxRadius}
          y1={centre}
          x2={centre + maxRadius}
          y2={centre}
          stroke={theme.border}
          strokeWidth={1}
        />
      </Svg>

      {/* The sweep, and only while the radio is genuinely sweeping. */}
      <View style={[styles.centreWrap, {left: centre - 4, top: centre - 4}]}>
        <RadarPing active={scanning} size={maxRadius * 2} color={theme.accent} duration={2400} />
        <RadarPing
          active={scanning}
          size={maxRadius * 2}
          color={theme.accent}
          delay={1200}
          duration={2400}
        />
        <View style={[styles.you, {backgroundColor: theme.accent}]} />
      </View>

      {placed.map(blip => (
        <View key={blip.key} style={[styles.blipWrap, {left: blip.x - 8, top: blip.y - 8}]}>
          {/* The ripple is the "still advertising" signal, nothing else. A peer that
              has stopped advertising keeps its position but goes still, which is what
              makes the difference visible before it is culled from the list. */}
          <RadarPing active={blip.live} size={30} color={blip.tone} duration={2000} />
          <Touchable scale={false} onPress={blip.onPress} hitSlop={10}>
            <View style={[styles.blip, {backgroundColor: blip.tone}]} />
          </Touchable>
          <View
            style={[
              styles.label,
              blip.flip ? styles.labelLeft : styles.labelRight,
              {backgroundColor: theme.surface, borderColor: theme.border},
            ]}>
            <AppText style={styles.labelName} numberOfLines={1} maxFontSizeMultiplier={1}>
              {blip.name}
            </AppText>
            <DenseText style={styles.labelRssi} maxFontSizeMultiplier={1}>
              {blip.rssi === null ? '—' : blip.rssi}
            </DenseText>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * How recently we must have heard an advertisement for a blip to count as live.
 *
 * Deliberately much shorter than the 15s after which the store culls a device: the
 * point of the ripple is that a peer visibly goes still *before* it vanishes, so the
 * list does not appear to lose rows at random. A BLE peripheral advertises every second
 * or so, which makes five seconds three missed intervals — enough to be a real absence
 * rather than one dropped packet.
 */
const ADVERTISING_WINDOW_MS = 5_000;

/** A device is "still advertising" if we have heard from it very recently. */
export function isLive(lastSeen: number): boolean {
  return Date.now() - lastSeen < ADVERTISING_WINDOW_MS;
}

const useStyles = makeStyles(t => ({
  centreWrap: {position: 'absolute', width: 8, height: 8, alignItems: 'center', justifyContent: 'center'},
  you: {width: 8, height: 8, borderRadius: 4},
  blipWrap: {position: 'absolute', width: 16, height: 16, alignItems: 'center', justifyContent: 'center'},
  blip: {width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: t.bg},
  label: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  labelRight: {left: 18},
  labelLeft: {right: 18, flexDirection: 'row-reverse'},
  // Capped so a long name cannot push the pill back out over the rim it was just
  // moved away from.
  labelName: {
    ...typography.caption,
    color: t.text,
    fontWeight: '700',
    fontSize: 11,
    maxWidth: 88,
  },
  labelRssi: {...typography.caption, color: t.textFaint, fontSize: 10},
}));
