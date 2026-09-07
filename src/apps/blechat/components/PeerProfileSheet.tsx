import React, {useState} from 'react';
import {Alert, Clipboard, Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {fonts, radius, spacing, speakerTint, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon} from './ui/Icon';
import {QualityBadge} from './ui/QualityBadge';
import {SignalBars} from './ui/Primitives';
import {sharedInterests} from '../config/interests';
import {relativeTime} from '../utils/time';
import {describeFailure} from '../ble/LinkErrors';
import {
  markPeerVerified,
  toggleFavoritePeer,
  unmarkPeerVerified,
  useAppStore,
} from '../state/appStore';
import {describeAssessment, isSuspicious} from '../security/IdentityWatch';
import type {Peer} from '../types/Peer';

/** Signal strength as a word. The bars carry it visually; this names it. */
function qualityWord(rssi: number): string {
  if (rssi >= -60) {
    return 'Strong signal';
  }
  if (rssi >= -75) {
    return 'Good signal';
  }
  return 'Weak signal';
}

/**
 * The first two groups only.
 *
 * Enough to tell two identities apart at a glance in a warning, which is all that block
 * is for. The full code lives behind "View security code", because a comparison you are
 * meant to read aloud should be made deliberately rather than skimmed inside an alert.
 */
function shortCode(peerId: string): string {
  const groups = peerId.match(/.{1,4}/g) ?? [peerId];
  return groups.slice(0, 2).join(' ').toUpperCase();
}

/**
 * Groups a 32-hex-char peerId into "XXXX XXXX  XXXX XXXX" — the same idea as Signal's
 * safety number or WhatsApp's security code, applied to the identity hash this app
 * already computes and already verifies at the handshake. Comparing this on both
 * screens, in person, is what actually rules out a first-contact impersonation — a
 * successful handshake only proves the session matches the CLAIMED peerId, not that the
 * peerId belongs to the person the user thinks it does.
 */
function formatFingerprint(peerId: string): string {
  const groups = peerId.match(/.{1,4}/g) ?? [peerId];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 4) {
    lines.push(groups.slice(i, i + 4).join(' '));
  }
  return lines.join('\n');
}

interface Props {
  visible: boolean;
  peer: Peer | null;
  myInterests: string[];
  onClose: () => void;
  onBlock: () => void;
  onUnblock?: () => void;
  blocked: boolean;
  onOpenChat?: () => void;
}

export function PeerProfileSheet({
  visible,
  peer,
  myInterests,
  onClose,
  onBlock,
  onUnblock,
  blocked,
  onOpenChat,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const verifiedPeerIds = useAppStore(s => s.verifiedPeerIds);
  const identityAlerts = useAppStore(s => s.identityAlerts);
  const favoritePeerIds = useAppStore(s => s.favoritePeerIds);
  const [showFingerprint, setShowFingerprint] = useState(false);

  if (!peer?.peerId) {
    return null;
  }
  const peerId = peer.peerId;
  const trustConfirmed = verifiedPeerIds.includes(peerId);
  const isFavorite = favoritePeerIds.includes(peerId);
  const shared = sharedInterests(myInterests, peer.interests);
  const other = peer.interests.filter(
    i => !shared.some(s => s.toLowerCase() === i.toLowerCase()),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close"
        />
        {/* The Modal renders outside ChatScreen/NearbyScreen's own SafeAreaView, so this
            sheet must reserve the bottom gesture-nav inset itself — otherwise "Open
            chat"/"Block" (or "Leave group" in ChatScreen's own sheet) sit right under a
            phone's gesture strip, easy to miss or to trigger the system gesture instead. */}
        <View
          style={[
            styles.card,
            {paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md)},
          ]}>
          <View style={styles.header}>
            <View style={[styles.avatar, {backgroundColor: speakerTint(theme, peerId) + '33'}]}>
              <Icon name="bluetooth" color={speakerTint(theme, peerId)} size={22} />
            </View>
            <View style={styles.headerText}>
              <AppText style={styles.name} numberOfLines={1}>
                {peer.displayName ?? 'Someone you have met'}
              </AppText>
              <View style={styles.badgeRow}>
                {peer.authenticated && (
                  <View style={styles.miniBadge}>
                    <Icon name="shield" color={theme.tileGreenFg} size={11} strokeWidth={2.4} />
                    <DenseText style={[styles.miniBadgeText, {color: theme.tileGreenFg}]}>
                      Verified
                    </DenseText>
                  </View>
                )}
                <QualityBadge score={peer.metrics?.quality ?? null} />
              </View>
            </View>
            <Touchable
              scale={false}
              onPress={() => toggleFavoritePeer(peerId)}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Icon
                name={isFavorite ? 'starFilled' : 'star'}
                color={isFavorite ? theme.tileAmberFg : theme.textDim}
                size={19}
              />
            </Touchable>
            <Touchable
              scale={false}
              onPress={onClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityLabel="Close">
              <Icon name="close" color={theme.textDim} size={18} />
            </Touchable>
          </View>

          {(() => {
            const alert = peerId ? identityAlerts[peerId] : undefined;
            if (!alert || !isSuspicious(alert.verdict)) {
              return null;
            }
            const severe = alert.verdict === 'impersonatesVerified';
            return (
              <View
                style={[
                  styles.identityWarning,
                  severe ? styles.identityWarningSevere : null,
                ]}>
                <Icon
                  name="alert"
                  color={severe ? theme.error : theme.warn}
                  size={16}
                />
                <View style={styles.grow}>
                  <AppText
                    style={[
                      styles.identityWarningTitle,
                      {color: severe ? theme.error : theme.warn},
                    ]}>
                    {severe
                      ? `This might not be the ${peer.displayName ?? 'person'} you know`
                      : 'Name already in use'}
                  </AppText>
                  <DenseText style={styles.identityWarningBody}>
                    {describeAssessment(alert)}
                  </DenseText>

                  {/*
                    Both codes, side by side.

                    A warning that says "this may not be who you think" and stops leaves
                    the reader with no way to check. The identity we already confirmed is
                    in `conflictsWith`, so the comparison the warning is asking for can
                    actually be made here rather than described.
                  */}
                  {alert.conflictsWith.length > 0 ? (
                    <View style={styles.codeCompare}>
                      {alert.conflictsWith.slice(0, 1).map(known => (
                        <View key={known.peerId} style={styles.codeRow}>
                          <Icon name="shield" color={theme.ok} size={14} strokeWidth={1.9} />
                          <DenseText style={styles.codeWho}>
                            {known.verified ? 'The one you confirmed' : 'The one you knew'}
                          </DenseText>
                          <DenseText style={[styles.codeValue, {color: theme.ok}]}>
                            {shortCode(known.peerId)}
                          </DenseText>
                        </View>
                      ))}
                      <View style={styles.codeRow}>
                        <Icon name="alert" color={theme.error} size={14} strokeWidth={1.9} />
                        <DenseText style={styles.codeWho}>This phone</DenseText>
                        <DenseText style={[styles.codeValue, {color: theme.error}]}>
                          {shortCode(peerId)}
                        </DenseText>
                      </View>
                      <DenseText style={styles.codeFootnote}>
                        It could be innocent — a new phone gets a new identity. Reading the
                        code aloud together is the only way to be sure.
                      </DenseText>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })()}

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <SignalBars rssi={peer.rssi} size="sm" />
              <DenseText style={styles.statLabel}>
                {/* Bars, not a number. dBm is a measurement, and the sheet's job is to
                    say how well this is likely to go — the exact figure lives in
                    Diagnostics for anyone who needs it. */}
                {peer.rssi !== null ? qualityWord(peer.rssi) : 'No signal yet'}
              </DenseText>
            </View>
            <View style={styles.stat}>
              <AppText style={styles.statValue}>{peer.connectCount}</AppText>
              <DenseText style={styles.statLabel}>Times connected</DenseText>
            </View>
            <View style={styles.stat}>
              <AppText style={styles.statValue} numberOfLines={1}>
                {relativeTime(peer.lastSeen)}
              </AppText>
              <DenseText style={styles.statLabel}>Last seen</DenseText>
            </View>
            <View style={styles.stat}>
              <AppText style={styles.statValue} numberOfLines={1}>
                {relativeTime(peer.firstSeen)}
              </AppText>
              {/* Now meaningful: both this and the connection count survive a restart,
                  so they describe the relationship rather than the current session. */}
              <DenseText style={styles.statLabel}>Known since</DenseText>
            </View>
          </View>

          {/* Only the two reasons that actually mean "this link did not trust the
              identity it was talking to" — a timeout or an out-of-range drop is not a
              security event and does not belong here. */}
          {peer.failure &&
            (peer.failure.reason === 'AuthenticationFailed' ||
              peer.failure.reason === 'Blocked') && (
              <View style={styles.warningBox}>
                <Icon name="alert" color={theme.error} size={14} />
                <DenseText style={styles.warningText}>
                  {describeFailure(peer.failure)}
                </DenseText>
              </View>
            )}

          {(shared.length > 0 || other.length > 0) && (
            <View style={styles.section}>
              <DenseText style={styles.sectionLabel}>INTERESTS</DenseText>
              {/* maxFontSizeMultiplier=1: a short badge label like this has no slack
                  between the text's un-scaled auto-measured width and the pill's rounded
                  edge — any accessibility scaling here is exactly what clips a trailing
                  character with no ellipsis. */}
              <View style={styles.tagRow}>
                {shared.map(interest => (
                  <View key={interest} style={[styles.tag, styles.tagShared]}>
                    <DenseText
                      style={[styles.tagText, styles.tagTextShared]}
                      maxFontSizeMultiplier={1}>
                      {interest}
                    </DenseText>
                  </View>
                ))}
                {other.map(interest => (
                  <View key={interest} style={styles.tag}>
                    <DenseText style={styles.tagText} maxFontSizeMultiplier={1}>
                      {interest}
                    </DenseText>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Touchable
              scale={false}
              onPress={() => setShowFingerprint(v => !v)}
              style={styles.fingerprintToggle}>
              <Icon name="key" color={theme.textDim} size={14} />
              <DenseText style={styles.fingerprintToggleText}>
                {showFingerprint ? 'Hide security code' : 'View security code'}
              </DenseText>
              <View style={styles.grow} />
              {trustConfirmed && (
                <View style={styles.miniBadge}>
                  <Icon name="check" color={theme.tileGreenFg} size={11} strokeWidth={2.6} />
                  <DenseText style={[styles.miniBadgeText, {color: theme.tileGreenFg}]}>
                    Verified
                  </DenseText>
                </View>
              )}
            </Touchable>

            {showFingerprint && (
              <View style={styles.fingerprintBox}>
                {/*
                  The limit of what the cryptography can tell you, said plainly.

                  The handshake is real and it is checked, but it proves the session
                  matches a key — not that the key belongs to the person whose name is on
                  the row. Only reading the code aloud closes that gap, and a screen that
                  showed the code without saying why would leave people believing the tick
                  already meant this.
                */}
                <View style={styles.fingerprintNote}>
                  <Icon name="info" color={theme.textDim} size={14} strokeWidth={2} />
                  <DenseText style={styles.fingerprintHint}>
                    A handshake proves the session matches a key. It cannot prove that key
                    belongs to the person you think. Reading this aloud, in person, does.
                  </DenseText>
                </View>

                <DenseText style={styles.fingerprintLabel}>
                  {(peer.displayName ?? 'THEIR').toUpperCase()}
                  {peer.displayName ? "'S CODE" : ' CODE'}
                </DenseText>
                <DenseText style={styles.fingerprintCode} selectable>
                  {formatFingerprint(peerId)}
                </DenseText>

                <Touchable
                  scale={false}
                  onPress={() => {
                    // Flattened to one line: the two-line layout is for reading aloud
                    // off the screen, not for what lands on the clipboard.
                    Clipboard.setString(formatFingerprint(peerId).split('\n').join(' '));
                    Alert.alert(
                      'Copied',
                      'The code is on the clipboard. It is only useful read aloud against their screen — sending it over a channel someone could tamper with proves nothing.',
                    );
                  }}
                  style={styles.copyCode}
                  accessibilityLabel="Copy security code">
                  <Icon name="copy" color={theme.textDim} size={12} />
                  <DenseText style={styles.copyCodeText}>Copy</DenseText>
                </Touchable>

                <DenseText style={styles.fingerprintAsk}>
                  Ask {peer.displayName ?? 'them'} to open the same screen and read theirs
                  out loud.
                </DenseText>
                <Touchable
                  scale={false}
                  onPress={() =>
                    trustConfirmed ? unmarkPeerVerified(peerId) : markPeerVerified(peerId)
                  }
                  style={
                    trustConfirmed
                      ? [styles.verifyButton, styles.verifyButtonActive]
                      : styles.verifyButton
                  }>
                  <Icon
                    name={trustConfirmed ? 'check' : 'shield'}
                    color={trustConfirmed ? theme.onAccent : theme.tileGreenFg}
                    size={14}
                  />
                  <DenseText
                    style={[
                      styles.verifyButtonText,
                      trustConfirmed && styles.verifyButtonTextActive,
                    ]}>
                    {trustConfirmed ? "It's a match — verified" : 'Codes match — mark verified'}
                  </DenseText>
                </Touchable>
              </View>
            )}
          </View>

          <View style={styles.actions}>
            {onOpenChat && (
              <Touchable
                scale={false}
                onPress={onOpenChat}
                style={styles.primaryAction}>
                <Icon name="link" color={theme.onAccent} size={14} />
                <DenseText style={styles.primaryActionText}>Open chat</DenseText>
              </Touchable>
            )}
            <Touchable
              scale={false}
              onPress={blocked ? onUnblock : onBlock}
              style={styles.secondaryAction}>
              <Icon name="block" color={theme.error} size={14} />
              <DenseText style={styles.secondaryActionText}>
                {blocked ? 'Unblock' : 'Block'}
              </DenseText>
            </Touchable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(t => ({
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  card: {
    backgroundColor: t.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  header: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {flex: 1, gap: 4},
  name: {...typography.title, color: t.text},
  badgeRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap'},
  miniBadge: {flexDirection: 'row', alignItems: 'center', gap: 3},
  miniBadgeText: {fontSize: 11, fontWeight: '700'},
  closeButton: {padding: 4},

  // Sits directly under the name, before anything else, because a warning placed after
  // the stats is a warning read after the decision has already been made.
  identityWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.warn,
    backgroundColor: t.warn + '14',
  },
  identityWarningSevere: {borderColor: t.error, backgroundColor: t.error + '1a'},
  identityWarningTitle: {...typography.callout, fontWeight: '800'},
  identityWarningBody: {
    ...typography.caption,
    color: t.text,
    lineHeight: 16,
    marginTop: 2,
  },

  statRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  stat: {flex: 1, alignItems: 'center', gap: 4},
  statValue: {...typography.callout, color: t.text, fontWeight: '700'},
  statLabel: {...typography.caption, color: t.textDim, fontSize: 11},

  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.error + '1a',
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
  },
  warningText: {...typography.caption, color: t.error, flex: 1, lineHeight: 16},

  section: {marginTop: spacing.lg},
  sectionLabel: {...typography.overline, color: t.textDim, marginBottom: spacing.sm},
  tagRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs},
  // flexShrink: 0 — this sits in a flexWrap row; without it, a flex layout is allowed to
  // squeeze a chip narrower than its text needs before it wraps to the next line, which
  // can clip the last character or two with no ellipsis to show for it.
  tag: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexShrink: 0,
  },
  tagShared: {backgroundColor: t.accentSoft, borderColor: t.accent},
  tagText: {color: t.textDim, fontSize: 11},
  tagTextShared: {color: t.accent, fontWeight: '700'},

  grow: {flex: 1},
  fingerprintToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  fingerprintToggleText: {...typography.callout, color: t.textDim, fontWeight: '600'},
  fingerprintBox: {
    marginTop: spacing.md,
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  codeCompare: {marginTop: spacing.md, gap: 2},
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.divider,
  },
  codeWho: {...typography.caption, color: t.textDim, flex: 1},
  codeValue: {...typography.monoSmall},
  codeFootnote: {...typography.caption, color: t.textDim, marginTop: spacing.sm},

  fingerprintNote: {flexDirection: 'row', alignItems: 'flex-start', gap: 9},
  fingerprintHint: {...typography.caption, color: t.textDim, flex: 1},
  fingerprintLabel: {...typography.overline, color: t.textDim, marginTop: spacing.lg},
  fingerprintAsk: {...typography.caption, color: t.textDim, marginTop: spacing.md},
  copyCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: spacing.md,
  },
  copyCodeText: {...typography.caption, color: t.textDim},
  fingerprintCode: {
    fontFamily: fonts.mono,
    fontSize: 17,
    fontWeight: '500',
    color: t.text,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: spacing.md,
    lineHeight: 24,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: t.tileGreenFg,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
  },
  verifyButtonActive: {backgroundColor: t.tileGreenFg},
  verifyButtonText: {...typography.callout, color: t.tileGreenFg, fontWeight: '700'},
  verifyButtonTextActive: {color: t.onAccent},

  actions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl},
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
  },
  primaryActionText: {...typography.callout, color: t.onAccent, fontWeight: '700'},
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.error,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  secondaryActionText: {...typography.callout, color: t.error, fontWeight: '700'},
}));
