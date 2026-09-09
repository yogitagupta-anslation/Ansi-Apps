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
import {MascotAvatar} from './ui/Mascot';
import {sharedInterests} from '../config/interests';
import {relativeTime} from '../utils/time';
import {formatDuration} from '../peers/LinkMetrics';
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
          {/* The grip. A sheet you dismiss by dragging needs something to say so. */}
          <View style={styles.grip} />

          {/* Only Close up here. Favourite already has a place in the action row below,
              next to block, where the two decisions you can make about a person sit
              together — offering it twice on one card just asks which one is the real
              button. */}
          <View style={styles.cornerActions}>
            <Touchable
              scale={false}
              onPress={onClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityLabel="Close">
              <Icon name="close" color={theme.textDim} size={18} />
            </Touchable>
          </View>

          <View style={styles.header}>
            {/* The same face they have in Nearby and at the top of the thread. It was a
                generic Bluetooth glyph here, so opening someone's card turned the person
                you had been talking to into a radio symbol. */}
            <MascotAvatar
              size={64}
              tint={speakerTint(theme, peerId)}
              status={peer.state === 'connected' ? theme.ok : null}
            />
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
          </View>


          {/* Directly under the name, as drawn: one filled action and two round ones.
              A sheet you opened by tapping somebody has an obvious main verb, and it
              should not be at the bottom past everything else about them. */}
          <View style={styles.actions}>
            {onOpenChat ? (
              <Touchable scale={false} onPress={onOpenChat} style={styles.primaryAction}>
                <Icon name="tabChats" color={theme.onAccent} size={15} strokeWidth={2} />
                <DenseText style={styles.primaryActionText}>Open chat</DenseText>
              </Touchable>
            ) : null}
            <Touchable
              scale={false}
              onPress={() => toggleFavoritePeer(peerId)}
              style={styles.roundAction}
              accessibilityLabel={isFavorite ? 'Remove from favourites' : 'Add to favourites'}>
              <Icon
                name={isFavorite ? 'starFilled' : 'star'}
                color={isFavorite ? theme.tileAmberFg : theme.textDim}
                size={17}
              />
            </Touchable>
            <Touchable
              scale={false}
              onPress={blocked ? onUnblock : onBlock}
              style={styles.roundAction}
              accessibilityLabel={blocked ? 'Unblock' : 'Block'}>
              <Icon name="block" color={theme.error} size={17} />
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

          <DenseText style={styles.sectionLabel}>CONNECTION</DenseText>

          <View style={styles.connRow}>
            <SignalBars rssi={peer.rssi} size="sm" />
            <DenseText style={styles.connLabel}>Signal</DenseText>
            <DenseText style={styles.connValue}>
              {peer.rssi !== null ? qualityWord(peer.rssi) : 'Not measured'}
            </DenseText>
          </View>

          <View style={[styles.connRow, styles.connRowLast]}>
            <Icon name="clock" color={theme.textDim} size={15} strokeWidth={1.9} />
            <DenseText style={styles.connLabel}>
              {peer.state === 'connected' ? 'Connected for' : 'Last seen'}
            </DenseText>
            <DenseText style={styles.connMono}>
              {peer.state === 'connected'
                ? formatDuration(peer.metrics?.currentUptimeMs ?? 0)
                : relativeTime(peer.lastSeen)}
            </DenseText>
          </View>

          {shared.length > 0 || other.length > 0 ? (
            <>
              <DenseText style={styles.sectionLabel}>
                {shared.length > 0 ? 'SHARED INTERESTS' : 'INTERESTS'}
              </DenseText>
              {/* maxFontSizeMultiplier=1: a short badge label like this has no slack
                  between the text's un-scaled auto-measured width and the pill's rounded
                  edge — any accessibility scaling here is exactly what clips a trailing
                  character with no ellipsis. */}
              <View style={styles.tagRow}>
                {(shared.length > 0 ? shared : other).map(interest => (
                  <View key={interest} style={styles.tag}>
                    <Icon name="check" color={theme.textDim} size={11} strokeWidth={2.4} />
                    <DenseText style={styles.tagText} maxFontSizeMultiplier={1}>
                      {interest}
                    </DenseText>
                  </View>
                ))}
              </View>
              {/* The rest as a sentence rather than more chips: what you have in common
                  is the reason to talk to them, and everything else is context. */}
              {shared.length > 0 && other.length > 0 ? (
                <DenseText style={styles.alsoInto}>Also into {other.join(', ')}</DenseText>
              ) : null}
            </>
          ) : null}

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
  cornerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: -8,
  },
  header: {alignItems: 'center', gap: 10, paddingTop: 2, paddingBottom: 4},
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {alignItems: 'center', gap: 6},
  name: {...typography.title, color: t.text, textAlign: 'center'},
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
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

  grip: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: t.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  actions: {flexDirection: 'row', gap: 8, marginTop: 18},
  primaryAction: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryActionText: {fontSize: 14.5, fontWeight: '500', color: t.onAccent},
  roundAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.divider,
  },
  connRowLast: {borderBottomWidth: 0},
  connLabel: {fontSize: 13.5, color: t.textDim, flex: 1},
  connValue: {fontSize: 13.5, color: t.text},
  connMono: {...typography.monoSmall, color: t.text},
  alsoInto: {fontSize: 13, color: t.textDim, marginTop: 8},

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
}));
