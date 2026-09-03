import React from 'react';
import {View} from 'react-native';
import {spacing} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {DenseText} from './AppText';
import {Icon, type IconName} from './ui/Icon';
import {Pulse} from './Motion';
import type {Theme} from '../config/theme';
import type {LinkState} from '../types/BLE';

interface Props {
  state: LinkState;
  label?: string;
  compact?: boolean;
}

export const LABELS: Record<LinkState, string> = {
  disconnected: 'Disconnected',
  // "Available" rather than "Found nearby": it says what the user can DO about it.
  discovering: 'Available',
  connecting: 'Connecting',
  discoveringServices: 'Discovering services',
  negotiatingMtu: 'Negotiating MTU',
  enablingNotifications: 'Enabling notifications',
  handshaking: 'Handshaking',
  connected: 'Connected',
  disconnecting: 'Disconnecting',
  reconnecting: 'Reconnecting',
  failed: 'Connection failed',
};

/** Step N of the connection sequence, for a progress hint while connecting. */
const STEP: Partial<Record<LinkState, string>> = {
  connecting: '1/5',
  discoveringServices: '2/5',
  negotiatingMtu: '3/5',
  enablingNotifications: '4/5',
  handshaking: '5/5',
};

export function dotColor(state: LinkState, t: Theme): string {
  switch (state) {
    case 'connected':
      return t.ok;
    case 'failed':
      return t.error;
    case 'disconnected':
      return t.textDim;
    default:
      // Every intermediate state is genuinely in progress, not a fake "connecting".
      return t.warn;
  }
}

/**
 * One glyph per state, not just a colour: "signal strength or pairing status" shown as an
 * actual icon is what the BLE-chat pattern calls for, and a colour-blind reader has
 * nothing else to go on if the dot is the only cue.
 */
function stateIcon(state: LinkState): IconName {
  switch (state) {
    case 'connected':
      return 'link';
    case 'failed':
      return 'alert';
    case 'disconnected':
      return 'block';
    default:
      return 'clock';
  }
}

/**
 * Genuinely still happening — as opposed to `discovering` ("Available", a peer just sitting
 * there connectable) or one of the three settled states. Only this set gets the pulse.
 */
function isTransient(state: LinkState): boolean {
  return (
    state !== 'connected' &&
    state !== 'failed' &&
    state !== 'disconnected' &&
    state !== 'discovering'
  );
}

/** Reflects real transport state only — it is driven by transport events, never guessed. */
export function ConnectionIndicator({state, label, compact}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const tone = dotColor(state, theme);

  if (compact) {
    // Unchanged: a dot is all the room a compact row has, and this path is exercised by
    // nothing user-visible right now, so it is left as the plainest, lowest-risk form.
    return (
      <View style={styles.row}>
        <View style={[styles.dot, {backgroundColor: tone}]} />
        <DenseText
          style={[styles.text, styles.compact]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}>
          {label ?? LABELS[state]}
        </DenseText>
      </View>
    );
  }

  return (
    <View style={[styles.badge, {backgroundColor: tone + '1a'}]}>
      <Pulse active={isTransient(state)}>
        <Icon name={stateIcon(state)} color={tone} size={13} strokeWidth={2.2} />
      </Pulse>
      {/*
        flexShrink lets the label shorten gracefully rather than the row overflowing;
        maxFontSizeMultiplier stops an enlarged system font from pushing "Connected"
        out to "Connect…".
      */}
      <DenseText
        style={[styles.text, {color: tone}]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}>
        {label ?? LABELS[state]}
      </DenseText>
      {!label && STEP[state] && (
        <DenseText
          style={[styles.step, {color: tone}]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}>
          {STEP[state]}
        </DenseText>
      )}
    </View>
  );
}

const useStyles = makeStyles(t => ({
  row: {flexDirection: 'row', alignItems: 'center', flexShrink: 1},
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    flexShrink: 1,
  },
  text: {color: t.text, fontSize: 14, fontWeight: '600', flexShrink: 1},
  compact: {fontSize: 12, color: t.textDim, fontWeight: '400'},
  step: {fontSize: 11, marginLeft: spacing.xs, flexShrink: 0, opacity: 0.75},
}));
