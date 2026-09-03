import React from 'react';
import {View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {DenseText} from '../AppText';
import {Icon} from './Icon';
import {Pulse} from '../Motion';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';
import {spacing, typography} from '../../config/theme';
import type {LinkState} from '../../types/BLE';

/**
 * The five stages a link actually goes through, in the order the transport reports them.
 *
 * Not invented for the UI: these are `LinkState` members, emitted by BLECentral as each
 * step completes. That is what makes a progress ring here honest — every segment
 * corresponds to a real event, so a ring that stops at three is telling you MTU
 * negotiation is where it hung.
 */
export const CONNECT_STAGES: LinkState[] = [
  'connecting',
  'discoveringServices',
  'negotiatingMtu',
  'enablingNotifications',
  'handshaking',
];

export const STAGE_LABELS: Record<string, string> = {
  connecting: 'Connecting',
  discoveringServices: 'Discovering services',
  negotiatingMtu: 'Negotiating MTU',
  enablingNotifications: 'Enabling notifications',
  handshaking: 'Handshaking',
};

/** How many stages are behind us. -1 when this state is not part of the sequence. */
export function stageIndex(state: LinkState): number {
  return CONNECT_STAGES.indexOf(state);
}

export function isConnecting(state: LinkState): boolean {
  return stageIndex(state) >= 0;
}

/** One arc of a circle, as an SVG path. Angles in degrees, 0 = twelve o'clock. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/**
 * A five-segment ring drawn around whatever it wraps.
 *
 * Five discrete segments rather than a continuous sweep, because the underlying progress
 * IS discrete — there are five events, not a percentage. A smooth arc would have to
 * invent the motion between them, and inventing it is what turns a progress indicator
 * into a promise the transport never made.
 *
 * A stalled connection therefore looks stalled, at the segment where it stalled.
 */
export function ConnectRing({
  size,
  state,
  children,
}: {
  /** Diameter of the content; the ring is drawn just outside it. */
  size: number;
  state: LinkState;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const done = stageIndex(state);
  const ringSize = size + 10;
  const radius = (ringSize - 3) / 2;
  const centre = ringSize / 2;
  const gap = 7;
  const span = 360 / CONNECT_STAGES.length;

  return (
    <View
      style={{
        width: ringSize,
        height: ringSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Svg
        width={ringSize}
        height={ringSize}
        style={{position: 'absolute', left: 0, top: 0}}>
        {CONNECT_STAGES.map((_, i) => (
          <Path
            key={i}
            d={arc(centre, centre, radius, i * span + gap / 2, (i + 1) * span - gap / 2)}
            stroke={i <= done ? theme.accent : theme.border}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </Svg>
      {children}
    </View>
  );
}

/**
 * The same five stages as a list, with the one in flight marked.
 *
 * The ring says how far; this says which. Both are needed: a ring alone cannot name the
 * step that is taking too long, and the name is the only part a bug report can use.
 */
export function StageChecklist({state}: {state: LinkState}) {
  const styles = useStyles();
  const theme = useTheme();
  const current = stageIndex(state);

  return (
    <View style={styles.list}>
      {CONNECT_STAGES.map((stage, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={stage} style={styles.row}>
            <Pulse active={active}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done
                      ? theme.accent
                      : active
                      ? theme.accent
                      : theme.border,
                    opacity: active ? 0.55 : 1,
                  },
                ]}
              />
            </Pulse>
            <DenseText
              style={[
                styles.label,
                {
                  color: done || active ? theme.text : theme.textFaint,
                  fontWeight: done || active ? '600' : '400',
                },
              ]}
              numberOfLines={1}>
              {STAGE_LABELS[stage]}
            </DenseText>
            {done ? (
              <DenseText style={styles.ok}>ok</DenseText>
            ) : active ? (
              <DenseText style={styles.pending}>· · ·</DenseText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** "Handshaking 5/5" — the stage name and how far through the sequence it is. */
export function stageCaption(state: LinkState): string | null {
  const index = stageIndex(state);
  if (index < 0) {
    return null;
  }
  return `${STAGE_LABELS[state]} ${index + 1}/${CONNECT_STAGES.length}`;
}

/** The moment a link goes live, drawn once rather than looped. */
export function ConnectedRing({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const ringSize = size + 10;
  return (
    <View
      style={{
        width: ringSize,
        height: ringSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: 2,
          borderColor: theme.ok,
        }}
      />
      {children}
      <View style={[stylesStatic.check, {backgroundColor: theme.ok}]}>
        <Icon name="check" color="#ffffff" size={9} strokeWidth={3.5} />
      </View>
    </View>
  );
}

const stylesStatic = {
  check: {
    position: 'absolute' as const,
    right: 0,
    bottom: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};

const useStyles = makeStyles(t => ({
  list: {marginTop: spacing.md, gap: 7},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  dot: {width: 7, height: 7, borderRadius: 3.5},
  label: {...typography.caption, flex: 1},
  ok: {...typography.caption, color: t.textFaint, fontSize: 10},
  pending: {...typography.caption, color: t.textFaint, fontSize: 10, letterSpacing: 1},
}));
