import React from 'react';
import {Image, StyleSheet, Text, View, type ImageSourcePropType} from 'react-native';
import {PlayerConnectionState, type Player} from '../models/player';
import {alpha, colors, typography} from '../theme';

/**
 * A roster row painted from the kit's players panel.
 *
 * The kit ships one fixed-width slot per style. Each was cut into a left cap,
 * a one-column middle and a right cap; the middle stretches, so a row fits any
 * width without pulling its rounded corners out of shape. React Native has no
 * nine-slice on Android (`capInsets` is iOS-only), so this is done by hand.
 */

type RowStyle = 'self' | 'peer' | 'empty';

interface Slice {
  left: ImageSourcePropType;
  middle: ImageSourcePropType;
  right: ImageSourcePropType;
  /** Native art height, used to keep the caps in proportion. */
  height: number;
}

const SLICES: Record<RowStyle, Slice> = {
  self: {
    left: require('../assets/row-self-l.png'),
    middle: require('../assets/row-self-m.png'),
    right: require('../assets/row-self-r.png'),
    height: 73,
  },
  peer: {
    left: require('../assets/row-peer-l.png'),
    middle: require('../assets/row-peer-m.png'),
    right: require('../assets/row-peer-r.png'),
    height: 70,
  },
  empty: {
    left: require('../assets/row-empty-l.png'),
    middle: require('../assets/row-empty-m.png'),
    right: require('../assets/row-empty-r.png'),
    height: 62,
  },
};

/** Native cap width, in the art's own pixels. */
const CAP = 14;
/** The avatar well the art leaves at the left of a row. */
const AVATAR_INSET = 5 / 70;
const AVATAR_SIZE = 62 / 70;

function RowFrame({
  variant,
  height,
  children,
}: {
  variant: RowStyle;
  height: number;
  children?: React.ReactNode;
}) {
  const slice = SLICES[variant];
  const cap = (CAP * height) / slice.height;
  return (
    <View style={[styles.frame, {height}]}>
      <View style={styles.frameArt} pointerEvents="none">
        <Image source={slice.left} style={{width: cap, height}} resizeMode="stretch" />
        <Image source={slice.middle} style={{flex: 1, height}} resizeMode="stretch" />
        <Image source={slice.right} style={{width: cap, height}} resizeMode="stretch" />
      </View>
      {children}
    </View>
  );
}

const CONNECTION_COLOR: Record<PlayerConnectionState, string> = {
  [PlayerConnectionState.Connected]: colors.greenBright,
  [PlayerConnectionState.Reconnecting]: colors.warning,
  [PlayerConnectionState.Disconnected]: colors.danger,
};

const CONNECTION_LABEL: Record<PlayerConnectionState, string> = {
  [PlayerConnectionState.Connected]: 'Online',
  [PlayerConnectionState.Reconnecting]: 'Reconnecting',
  [PlayerConnectionState.Disconnected]: 'Offline',
};

function SignalBars({strength, color}: {strength: number; color: string}) {
  return (
    <View style={styles.signal}>
      {[0, 1, 2].map(index => (
        <View
          key={index}
          style={[
            styles.signalBar,
            {
              height: 6 + index * 4,
              backgroundColor: index < strength ? color : alpha(colors.textFaint, 0.35),
            },
          ]}
        />
      ))}
    </View>
  );
}

interface Props {
  player: Player;
  isLocal: boolean;
  height?: number;
}

export function RosterRow({player, isLocal, height = 46}: Props) {
  const strength =
    player.connection === PlayerConnectionState.Connected
      ? 3
      : player.connection === PlayerConnectionState.Reconnecting
        ? 1
        : 0;
  const avatar = height * AVATAR_SIZE;

  return (
    <RowFrame variant={isLocal ? 'self' : 'peer'} height={height}>
      <View
        style={[
          styles.avatar,
          {
            left: height * AVATAR_INSET,
            width: avatar,
            height: avatar,
            borderRadius: avatar / 2,
            borderColor: isLocal ? colors.gold : colors.blue,
          },
        ]}>
        <Text style={{fontSize: avatar * 0.52}}>{player.avatar}</Text>
      </View>

      <View style={[styles.body, {marginLeft: height * AVATAR_INSET + avatar + 8}]}>
        <Text style={styles.name} numberOfLines={1}>
          {player.name}
          {isLocal ? <Text style={styles.you}> (You)</Text> : null}
          {player.isHost ? ' 👑' : ''}
        </Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {backgroundColor: CONNECTION_COLOR[player.connection]},
            ]}
          />
          <Text style={styles.statusText}>{CONNECTION_LABEL[player.connection]}</Text>
        </View>
      </View>

      <SignalBars strength={strength} color={CONNECTION_COLOR[player.connection]} />
    </RowFrame>
  );
}

/** A dashed slot for a seat nobody has taken yet. */
export function RosterEmptyRow({height = 46}: {height?: number}) {
  return (
    <RowFrame variant="empty" height={height}>
      <Text style={styles.waiting}>Waiting for player…</Text>
    </RowFrame>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  frameArt: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  avatar: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: alpha(colors.night, 0.85),
  },
  body: {
    flex: 1,
    marginRight: 8,
    gap: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  you: {
    color: colors.cyan,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    ...typography.bodyMuted,
    fontSize: 10,
  },
  signal: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginRight: 14,
  },
  signalBar: {
    width: 3,
    borderRadius: 1,
  },
  waiting: {
    ...typography.bodyMuted,
    fontSize: 11,
    marginLeft: 52,
  },
});
