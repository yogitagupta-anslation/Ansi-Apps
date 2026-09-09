import React from 'react';
import {Alert, ScrollView, Switch, View} from 'react-native';

import {AppText, DenseText} from '../components/AppText';
import {Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {Screen} from '../components/ui/Screen';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';
import type {RootStackScreenProps} from '../navigation/types';

/**
 * Being found — everything that decides whether a handshake ever happens.
 *
 * Two halves that are easy to confuse and are kept apart here: whether other phones can
 * see YOU, and whether this phone goes looking for THEM. Bluetooth needs one of each for
 * a connection to exist, so switching both off is a working configuration in which
 * nothing will ever happen — which the screen says rather than leaving you to discover.
 */
export function BeingFoundScreen({navigation}: RootStackScreenProps<'BeingFound'>) {
  const styles = useStyles();
  const theme = useTheme();
  const settings = useAppStore(s => s.settings);

  const save = (patch: Parameters<typeof bleChat.updateSettings>[0]) => {
    bleChat
      .updateSettings(patch)
      .catch(err => Alert.alert('Being found', err instanceof Error ? err.message : String(err)));
  };

  const invisible = !settings.autoAdvertise && !settings.autoStartScanning;

  return (
    <Screen>
      <View style={styles.head}>
        <Touchable
          scale={false}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevronLeft" size={20} color={theme.text} />
        </Touchable>
        <AppText style={styles.title}>Being found</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {invisible ? (
          <View style={styles.warning}>
            <Icon name="alert" size={15} color={theme.warn} strokeWidth={2} />
            <DenseText style={styles.warningText}>
              With both of these off nothing can happen — you cannot be found and you are
              not looking. That is a valid way to leave the app, but it is not a quiet
              mode, it is off.
            </DenseText>
          </View>
        ) : null}

        <DenseText style={styles.sectionLabel}>THEM FINDING YOU</DenseText>
        <ToggleRow
          icon="broadcast"
          label="Let people find me"
          hint="Your name and interests go out in a broadcast anyone in range can hear"
          value={settings.autoAdvertise}
          onChange={v => save({autoAdvertise: v})}
        />

        <DenseText style={styles.sectionLabel}>YOU FINDING THEM</DenseText>
        <ToggleRow
          icon="radar"
          label="Look for people automatically"
          hint="Starts as soon as Bluetooth is available. Uses a little more battery"
          value={settings.autoStartScanning}
          onChange={v => save({autoStartScanning: v})}
        />
        <ToggleRow
          icon="link"
          label="Say hi automatically"
          hint="Connect to everyone found, up to the limit below. Off is a fair choice in a crowded room"
          value={settings.autoConnect}
          onChange={v => save({autoConnect: v})}
        />
        <ToggleRow
          icon="clock"
          label="Reconnect automatically"
          hint="Try again, less often each time, after somebody drops out of range"
          value={settings.autoReconnect}
          onChange={v => save({autoReconnect: v})}
        />

        <DenseText style={styles.sectionLabel}>AT ONCE</DenseText>
        <View style={styles.stepperRow}>
          <View style={[styles.rowIcon, {backgroundColor: theme.accent + (theme.isDark ? '26' : '14')}]}>
            <Icon name="people" size={16} color={theme.accent} strokeWidth={1.9} />
          </View>
          <View style={styles.rowText}>
            <AppText style={styles.rowLabel}>People at the same time</AppText>
            <DenseText style={styles.rowHint}>
              {/* The chip decides the real ceiling; this is a request, not a promise. */}
              Bluetooth chips hold a handful of links. Asking for more than yours can do
              does not break anything — it simply refuses the extra
            </DenseText>
          </View>
          <View style={styles.stepper}>
            <Touchable
              scale={false}
              onPress={() => save({maxConnections: Math.max(1, settings.maxConnections - 1)})}
              style={styles.stepButton}
              accessibilityRole="button"
              accessibilityLabel="Fewer">
              <AppText style={styles.stepGlyph}>−</AppText>
            </Touchable>
            <AppText style={styles.stepValue}>{settings.maxConnections}</AppText>
            <Touchable
              scale={false}
              onPress={() => save({maxConnections: Math.min(8, settings.maxConnections + 1)})}
              style={styles.stepButton}
              accessibilityRole="button"
              accessibilityLabel="More">
              <AppText style={styles.stepGlyph}>+</AppText>
            </Touchable>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: IconName;
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, {backgroundColor: theme.accent + (theme.isDark ? '26' : '14')}]}>
        <Icon name={icon} size={16} color={theme.accent} strokeWidth={1.9} />
      </View>
      <View style={styles.rowText}>
        <AppText style={styles.rowLabel}>{label}</AppText>
        <DenseText style={styles.rowHint}>{hint}</DenseText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{false: theme.border, true: theme.accent}}
        thumbColor="#ffffff"
        accessibilityLabel={label}
      />
    </View>
  );
}

const useStyles = makeStyles(t => ({
  head: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10},
  back: {padding: 4},
  title: {fontSize: 28, fontWeight: '600', letterSpacing: -1, color: t.text, flex: 1},
  content: {paddingBottom: spacing.xl},

  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 18,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: t.warn + '14',
  },
  warningText: {...typography.caption, color: t.textDim, flex: 1},

  sectionLabel: {
    ...typography.overline,
    color: t.textDim,
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 8,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 18},
  rowIcon: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  rowText: {flex: 1},
  rowLabel: {fontSize: 14.5, color: t.text},
  rowHint: {...typography.caption, color: t.textDim, marginTop: 2},

  stepperRow: {flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 18},
  stepper: {flexDirection: 'row', alignItems: 'center', gap: 4},
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {fontSize: 16, color: t.text, lineHeight: 20},
  stepValue: {fontSize: 15, fontWeight: '500', color: t.text, minWidth: 22, textAlign: 'center'},
}));
