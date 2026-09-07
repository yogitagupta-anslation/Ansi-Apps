import React, {useCallback, useEffect, useState} from 'react';
import {Alert, AppState, ScrollView, Switch, View} from 'react-native';

import {AppText, DenseText} from '../components/AppText';
import {Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {MascotAvatar} from '../components/ui/Mascot';
import {Screen} from '../components/ui/Screen';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing} from '../config/theme';
import {useAppStore} from '../state/appStore';
import {bleChat} from '../services/BleChatService';
import {storage} from '../storage/LocalStorage';
import type {RootTabScreenProps} from '../navigation/types';

/**
 * You — the top of the settings tree.
 *
 * Six entries, which is the whole point of it. The app has eleven sections' worth of
 * settings and every one of them still exists; what changed is that this screen stopped
 * being all of them at once. The two toggles anyone actually reaches for are here, and
 * the rest sit behind Edit, Appearance, Blocked and Advanced — one tap, and off a screen
 * you open to change one thing.
 */
export function YouScreen({navigation}: RootTabScreenProps<'You'>) {
  const styles = useStyles();
  const theme = useTheme();
  const settings = useAppStore(s => s.settings);
  const identity = useAppStore(s => s.identity);
  const blockedPeerIds = useAppStore(s => s.blockedPeerIds);
  /**
   * Read from storage rather than the settings object, which does not carry it: the PIN
   * and its enabled flag live in the secure store. Re-read on foreground so a lock set
   * from the detail screen is reflected here without a restart.
   */
  const [lock, setLock] = useState(false);
  const refreshLock = useCallback(() => {
    void storage.loadAppLock().then(({enabled}) => setLock(enabled));
  }, []);
  useEffect(() => {
    refreshLock();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshLock();
      }
    });
    return () => sub.remove();
  }, [refreshLock]);

  const name = identity?.displayName?.trim() || 'No name set';
  const interests = settings.interests ?? [];

  const openDetail = (section: 'profile' | 'app' | 'system') =>
    navigation.navigate('Settings', {section});

  const save = (patch: Parameters<typeof bleChat.updateSettings>[0]) => {
    bleChat
      .updateSettings(patch)
      .catch(err => Alert.alert('Settings', err instanceof Error ? err.message : String(err)));
  };

  return (
    <Screen>
      <View style={styles.head}>
        <AppText style={styles.title}>You</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Who other people see. The same mascot and the same interest line that appear
            on their Nearby row, so this reads as a preview rather than a form. */}
        <View style={styles.profile}>
          <MascotAvatar size={48} tint={theme.accent} />
          <View style={styles.grow}>
            <AppText style={styles.name} numberOfLines={1}>
              {name}
            </AppText>
            <DenseText style={styles.interests} numberOfLines={1}>
              {interests.length > 0 ? interests.join(' · ') : 'No interests yet'}
            </DenseText>
          </View>
          <Touchable
            scale={false}
            onPress={() => openDetail('profile')}
            style={styles.editPill}
            accessibilityRole="button"
            accessibilityLabel="Edit your profile">
            <Icon name="pencil" size={12} color={theme.text} strokeWidth={2} />
            <DenseText style={styles.editText}>Edit</DenseText>
          </Touchable>
        </View>

        <SectionLabel first>Being found</SectionLabel>
        <ToggleRow
          icon="broadcast"
          label="Let people find me"
          hint="You appear in their Nearby list"
          value={settings.autoAdvertise}
          onChange={v => save({autoAdvertise: v})}
        />
        <ToggleRow
          icon="radar"
          label="Look for people automatically"
          hint="Uses a little more battery"
          value={settings.autoStartScanning}
          onChange={v => save({autoStartScanning: v})}
        />

        <SectionLabel>Privacy</SectionLabel>
        <ToggleRow
          icon="key"
          label="Lock the app"
          hint={
            lock
              ? 'On · a PIN is needed after every time you leave'
              : 'Off · anyone holding this phone can read'
          }
          value={lock}
          // Turning a lock ON needs a PIN chosen, and turning it off needs the current
          // one — both are conversations, not a switch, so the row hands over rather
          // than pretending to toggle in place.
          onChange={() => openDetail('system')}
        />
        <LinkRow
          icon="block"
          label="Blocked people"
          value={blockedPeerIds.length > 0 ? String(blockedPeerIds.length) : undefined}
          onPress={() => openDetail('system')}
        />

        <SectionLabel>App</SectionLabel>
        <LinkRow
          icon="gear"
          label="Appearance"
          value={
            settings.themeMode === 'system'
              ? 'System'
              : settings.themeMode === 'light'
              ? 'Light'
              : 'Dark'
          }
          onPress={() => openDetail('app')}
        />
        <LinkRow icon="code" label="Advanced" onPress={() => navigation.navigate('Debug')} />
      </ScrollView>
    </Screen>
  );
}

function SectionLabel({children, first}: {children: string; first?: boolean}) {
  const styles = useStyles();
  return (
    <View style={[styles.sectionLabel, first ? styles.sectionLabelFirst : null]}>
      <DenseText style={styles.sectionLabelText}>{children.toUpperCase()}</DenseText>
    </View>
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
      <Icon name={icon} size={17} color={theme.textDim} strokeWidth={1.9} />
      <View style={styles.grow}>
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

function LinkRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <Touchable
      scale={false}
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}>
      <Icon name={icon} size={17} color={theme.textDim} strokeWidth={1.9} />
      <AppText style={[styles.rowLabel, styles.grow]}>{label}</AppText>
      {value ? <DenseText style={styles.rowValue}>{value}</DenseText> : null}
      <Icon name="chevronRight" size={16} color={theme.textFaint} />
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  grow: {flex: 1},
  head: {paddingHorizontal: 18, paddingTop: 14},
  title: {fontSize: 28, fontWeight: '600', letterSpacing: -1, lineHeight: 28, color: t.text},
  content: {paddingBottom: spacing.xl},

  profile: {flexDirection: 'row', alignItems: 'center', gap: 13, padding: 18, paddingTop: 22, paddingBottom: 20},
  name: {fontSize: 20, fontWeight: '500', letterSpacing: -0.3, color: t.text},
  interests: {fontSize: 13, lineHeight: 18, color: t.textDim, marginTop: 2},
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
    flexShrink: 0,
  },
  editText: {fontSize: 12.5, fontWeight: '500', color: t.text},

  sectionLabel: {paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, borderTopWidth: 1, borderTopColor: t.divider, marginTop: 8},
  // The first label sits right under the profile block, which already has the hairline.
  sectionLabelFirst: {marginTop: 0, paddingTop: 5},
  sectionLabelText: {fontSize: 10.5, fontWeight: '500', letterSpacing: 1, color: t.textDim},

  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 18},
  rowLabel: {fontSize: 14.5, color: t.text},
  rowHint: {fontSize: 12.5, lineHeight: 17, color: t.textDim, marginTop: 2},
  rowValue: {fontSize: 13, color: t.textDim},
}));
