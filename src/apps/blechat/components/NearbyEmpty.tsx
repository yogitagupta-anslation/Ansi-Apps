import React from 'react';
import {View} from 'react-native';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {RippleStage} from './ui/RippleStage';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius} from '../config/theme';

/**
 * The three ways Nearby can be empty, which are three different problems.
 *
 * A radio that is switched off, a permission Android will not ask for again, and a room
 * with nobody in it need three different next steps — so they get three headlines, three
 * buttons and three footnotes rather than one apologetic paragraph. The footnote is the
 * part that earns its place: it answers the question the empty screen actually raises,
 * which is "is this broken, or is there genuinely nobody here?".
 */
export type NearbyEmptyKind = 'off' | 'blocked' | 'searching';

export function NearbyEmpty({
  kind,
  queuedCount,
  otherDevices,
  onPrimary,
}: {
  kind: NearbyEmptyKind;
  /** Messages waiting in the outbox — only mentioned when there are any. */
  queuedCount: number;
  /** Non-chat Bluetooth devices in range: proof the radio is sweeping. */
  otherDevices: number;
  onPrimary: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();

  if (kind === 'searching') {
    return (
      <View style={styles.root}>
        <RippleStage size={150} />
        <AppText style={styles.title}>Nobody here yet</AppText>
        <DenseText style={styles.body}>
          Anyone who opens BLE Chat within about a room&apos;s distance turns up on their
          own.
        </DenseText>
        <Touchable
          scale={false}
          onPress={onPrimary}
          style={styles.ghostButton}
          accessibilityRole="button"
          accessibilityLabel="Look again">
          <Icon name="radar" size={14} color={theme.text} strokeWidth={2} />
          <DenseText style={styles.ghostLabel}>Look again</DenseText>
        </Touchable>
        {otherDevices > 0 ? (
          <Footnote icon="info" tone={theme.textDim}>
            {otherDevices} other Bluetooth device{otherDevices === 1 ? '' : 's'} in range —
            headphones, watches, that sort of thing. Nothing to chat with.
          </Footnote>
        ) : null}
      </View>
    );
  }

  const off = kind === 'off';
  const tone = off ? theme.warn : theme.error;

  return (
    <View style={styles.root}>
      <View style={[styles.disc, {backgroundColor: tone + '1f'}]}>
        <Icon
          name={off ? 'bluetoothOff' : 'block'}
          size={28}
          color={tone}
          strokeWidth={1.8}
        />
      </View>

      <AppText style={styles.title}>
        {off ? "Turn on Bluetooth to see who's around" : "BLE Chat can't look for people"}
      </AppText>
      <DenseText style={styles.body}>
        {off
          ? "It's the only way BLE Chat reaches other phones — there's no internet fallback."
          : "Android won't ask again, so it has to be changed in Settings."}
      </DenseText>

      <Touchable
        scale={false}
        onPress={onPrimary}
        style={styles.primaryButton}
        accessibilityRole="button"
        accessibilityLabel={off ? 'Turn on Bluetooth' : 'Open Settings'}>
        <Icon
          name={off ? 'bluetooth' : 'gear'}
          size={15}
          color={theme.onAccent}
          strokeWidth={2}
        />
        <DenseText style={styles.primaryLabel}>
          {off ? 'Turn on Bluetooth' : 'Open Settings'}
        </DenseText>
      </Touchable>

      {off ? (
        queuedCount > 0 ? (
          <Footnote icon="clock" tone={theme.warn}>
            {queuedCount} message{queuedCount === 1 ? '' : 's'}{' '}
            {queuedCount === 1 ? 'is' : 'are'} waiting to send. They&apos;ll go out once
            the radio is back on.
          </Footnote>
        ) : null
      ) : (
        <Footnote icon="shield" tone={theme.ok}>
          This doesn&apos;t include location. BLE Chat reads signal strength and a service
          ID, nothing about where you are.
        </Footnote>
      )}
    </View>
  );
}

/** The quiet line under the action, after a hairline. */
function Footnote({
  icon,
  tone,
  children,
}: {
  icon: IconName;
  tone: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.footnote}>
      <Icon name={icon} size={13} color={tone} strokeWidth={2.2} />
      <DenseText style={styles.footnoteText}>{children}</DenseText>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  root: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28},
  disc: {width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center'},
  title: {
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: -0.3,
    lineHeight: 26,
    color: t.text,
    marginTop: 22,
    textAlign: 'center',
  },
  body: {fontSize: 14, lineHeight: 21, color: t.textDim, marginTop: 10, textAlign: 'center'},
  primaryButton: {
    alignSelf: 'stretch',
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 24,
  },
  primaryLabel: {fontSize: 14.5, fontWeight: '500', color: t.onAccent},
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 24,
  },
  ghostLabel: {fontSize: 14, fontWeight: '500', color: t.text},
  footnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 26,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: t.divider,
  },
  footnoteText: {fontSize: 12.5, lineHeight: 19, color: t.textDim, flex: 1},
}));
