import React from 'react';
import {ActivityIndicator, TouchableOpacity, View} from 'react-native';
import {radius, spacing} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from './AppText';
import type {Theme} from '../config/theme';
import {signalStrength} from '../peers/PeerManager';
import {describeFailure} from '../ble/LinkErrors';
import {relativeTime} from '../utils/time';
import type {Peer} from '../types/Peer';
import {sharedInterests} from '../config/interests';
import {ConnectionIndicator} from './ConnectionIndicator';

interface Props {
  peer: Peer;
  onConnect: (peer: Peer) => void;
  onDisconnect: (peer: Peer) => void;
  onOpenChat: (peer: Peer) => void;
  /** Our own interests, so the overlap can be highlighted. */
  myInterests?: string[];
}

const SIGNAL_LABEL = {
  strong: 'Strong',
  medium: 'Medium',
  weak: 'Weak',
  unknown: 'Unknown',
};

function signalColor(strength: keyof typeof SIGNAL_LABEL, t: Theme): string {
  return strength === 'strong'
    ? t.ok
    : strength === 'medium'
    ? t.warn
    : strength === 'weak'
    ? t.error
    : t.textDim;
}

export function PeerCard({
  peer,
  onConnect,
  onDisconnect,
  onOpenChat,
  myInterests = [],
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const strength = signalStrength(peer.rssi);
  const connected = peer.state === 'connected';
  const busy =
    peer.state === 'connecting' ||
    peer.state === 'discovering' ||
    peer.state === 'handshaking' ||
    peer.state === 'reconnecting';

  // A name, never a hex string. Someone who has not introduced themselves yet is
  // "Someone nearby" — honest, and readable, which an advertising id is not.
  const title = peer.displayName ?? 'Someone nearby';
  const shared = sharedInterests(myInterests, peer.interests);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <AppText style={styles.name} numberOfLines={1}>
            {title}
          </AppText>
          <DenseText style={styles.service} numberOfLines={1}>
            BLE Chat
          </DenseText>
          <View style={styles.metaRow}>
            <View style={[styles.dot, {backgroundColor: signalColor(strength, theme)}]} />
            <DenseText style={styles.meta}>
              {SIGNAL_LABEL[strength]}
              {peer.rssi !== null ? '  ' + peer.rssi + ' dBm' : ''}
              {'   Last seen ' + relativeTime(peer.lastSeen)}
            </DenseText>
          </View>
        </View>
        <ConnectionIndicator state={peer.state} compact />
      </View>

      {/*
        What you would actually start a conversation about. Shared interests come first
        and are highlighted, because that is the whole reason to tap on one stranger
        rather than another.
      */}
      {peer.interests.length > 0 ? (
        <View style={styles.interestRow}>
          {/* maxFontSizeMultiplier=1: a short badge label like this has no slack between
              the text's un-scaled auto-measured width and the pill's rounded edge — any
              accessibility scaling here is exactly what clips a trailing character with
              no ellipsis. */}
          {shared.map(interest => (
            <View key={interest} style={[styles.tag, styles.tagShared]}>
              <DenseText
                style={[styles.tagText, styles.tagTextShared]}
                numberOfLines={1}
                maxFontSizeMultiplier={1}>
                {interest}
              </DenseText>
            </View>
          ))}
          {peer.interests
            .filter(i => !shared.some(s2 => s2.toLowerCase() === i.toLowerCase()))
            .map(interest => (
              <View key={interest} style={styles.tag}>
                <DenseText style={styles.tagText} numberOfLines={1} maxFontSizeMultiplier={1}>
                  {interest}
                </DenseText>
              </View>
            ))}
        </View>
      ) : (
        <DenseText style={styles.idHint}>
          {peer.peerId ? 'No interests shared' : 'No interests advertised'}
        </DenseText>
      )}

      {peer.queuedCount > 0 && (
        <DenseText style={styles.queued}>
          {peer.queuedCount} message{peer.queuedCount === 1 ? '' : 's'} queued for
          delivery
        </DenseText>
      )}

      {peer.failure && (
        <View style={styles.failureBox}>
          <DenseText style={styles.failureReason}>
            {describeFailure(peer.failure)}
          </DenseText>
          <DenseText style={styles.failureDetail} numberOfLines={2}>
            {peer.failure.reason} during {peer.failure.phase}
          </DenseText>
        </View>
      )}

      <View style={styles.actions}>
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator size="small" color={theme.accent} />
            <DenseText style={styles.busyText} numberOfLines={1}>
              {peer.state}
            </DenseText>
          </View>
        )}

        {!busy && !connected && (
          <TouchableOpacity style={styles.primary} onPress={() => onConnect(peer)}>
            <AppText style={styles.primaryText} numberOfLines={1}>
              Connect
            </AppText>
          </TouchableOpacity>
        )}

        {connected && (
          <>
            <TouchableOpacity style={styles.primary} onPress={() => onOpenChat(peer)}>
              <AppText style={styles.primaryText} numberOfLines={1}>
                Open chat
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => onDisconnect(peer)}>
              <AppText style={styles.secondaryText} numberOfLines={1}>
                Disconnect
              </AppText>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  headerRow: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm},
  flex: {flex: 1, marginRight: spacing.sm},
  name: {color: t.text, fontSize: 16, fontWeight: '600'},
  metaRow: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  dot: {width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs},
  meta: {color: t.textDim, fontSize: 12},
  id: {
    color: t.textDim,
    fontSize: 11,
    marginTop: spacing.sm,
    fontFamily: 'monospace',
  },
  idHint: {color: t.textDim, fontSize: 11, marginTop: spacing.sm},
  interestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  // flexShrink: 0 — this sits in a flexWrap row; without it, a flex layout is allowed to
  // squeeze a chip narrower than its text needs before it wraps to the next line, which
  // can clip the last character or two with no ellipsis to show for it.
  tag: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    flexShrink: 0,
  },
  // A shared interest is the reason to talk to this person rather than the next one, so
  // it is filled rather than outlined and sorted to the front.
  tagShared: {backgroundColor: t.accentSoft, borderColor: t.accent},
  tagText: {color: t.textDim, fontSize: 11},
  tagTextShared: {color: t.accent, fontWeight: '700'},
  service: {color: t.textDim, fontSize: 11, marginTop: 1},
  failureBox: {
    marginTop: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: t.error,
    paddingLeft: spacing.sm,
  },
  queued: {color: t.warn, fontSize: 11, marginTop: spacing.sm},
  failureReason: {color: t.error, fontSize: 12},
  failureDetail: {color: t.textDim, fontSize: 10, fontFamily: 'monospace'},
  actions: {flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm},
  primary: {
    backgroundColor: t.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryText: {color: t.onAccent, fontWeight: '600', fontSize: 13},
  secondary: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  secondaryText: {color: t.textDim, fontWeight: '600', fontSize: 13},
  busy: {flexDirection: 'row', alignItems: 'center'},
  busyText: {color: t.textDim, marginLeft: spacing.sm, fontSize: 13},
}));
