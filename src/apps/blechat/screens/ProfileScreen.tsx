import React, {useCallback, useEffect, useState} from 'react';
import {Alert, AppState, ScrollView, TextInput, View} from 'react-native';

import {AppText, DenseText} from '../components/AppText';
import {Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {MascotAvatar} from '../components/ui/Mascot';
import {Screen} from '../components/ui/Screen';
import {LogOutSheet} from '../components/LogOutSheet';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {fonts, radius, spacing, typography} from '../config/theme';
import {MAX_DISPLAY_NAME_LENGTH} from '../config/interests';
import {useAppStore} from '../state/appStore';
import {bleChat} from '../services/BleChatService';
import {storage} from '../storage/LocalStorage';
import type {RootTabScreenProps} from '../navigation/types';

/**
 * Profile — one screen that says who you are and what leaves this phone.
 *
 * Every row is something another person can see or something that decides whether they
 * can see you, which is why they sit together: interests and languages travel in the
 * handshake, "Being found" decides whether the handshake ever happens, and the rest is
 * about this device. The summary under each label is the current value, so the list can
 * be read without opening anything.
 *
 * Appearance and the two pickers expand in place or push, following the frames.
 */
export function ProfileScreen({navigation}: RootTabScreenProps<'You'>) {
  const styles = useStyles();
  const theme = useTheme();
  const settings = useAppStore(s => s.settings);
  const identity = useAppStore(s => s.identity);
  const blockedPeerIds = useAppStore(s => s.blockedPeerIds);
  const scanning = useAppStore(s => s.scanning);

  const [expanded, setExpanded] = useState<'appearance' | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [logOutVisible, setLogOutVisible] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);

  const refreshLock = useCallback(() => {
    void storage.loadAppLock().then(({enabled}) => setLockEnabled(enabled));
  }, []);
  useEffect(() => {
    refreshLock();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        refreshLock();
      }
    });
    return () => sub.remove();
  }, [refreshLock]);

  const save = (patch: Parameters<typeof bleChat.updateSettings>[0]) => {
    bleChat
      .updateSettings(patch)
      .catch(err => Alert.alert('Profile', err instanceof Error ? err.message : String(err)));
  };

  const interests = settings.interests ?? [];
  const languages = settings.languages ?? [];
  const name = identity?.displayName?.trim() || 'No name set';

  /**
   * Renaming, in place.
   *
   * The name at the top of this screen is the one other people see, so the shortest
   * possible path between reading it and changing it is tapping it. An empty or unchanged
   * draft is dropped rather than saved — there is no such thing as a nameless peer.
   */
  const commitName = () => {
    const trimmed = draftName.trim();
    setEditingName(false);
    if (trimmed && trimmed !== settings.displayName) {
      save({displayName: trimmed});
    }
  };

  /** "f858 18bd 95dd 0feb" — the identity, in the form you would read aloud. */
  const code = identity
    ? (identity.peerId.match(/.{1,4}/g) ?? []).slice(0, 4).join(' ')
    : '';

  return (
    <Screen>
      {/* "You", not "Profile" — the tab that opens this screen says You, and a heading
          that renames the destination the moment you arrive makes the reader check
          whether they landed where they meant to. */}
      <View style={styles.head}>
        <AppText style={styles.title}>You</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <MascotAvatar size={64} tint={theme.accent} />
          {editingName ? (
            <TextInput
              style={[styles.name, styles.nameInput]}
              value={draftName}
              onChangeText={setDraftName}
              onBlur={commitName}
              onSubmitEditing={commitName}
              placeholder="Your name"
              placeholderTextColor={theme.textFaint}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
            />
          ) : (
            <Touchable
              scale={false}
              onPress={() => {
                setDraftName(settings.displayName ?? '');
                setEditingName(true);
              }}
              hitSlop={8}
              style={styles.nameRow}
              accessibilityRole="button"
              accessibilityLabel={`${name}, tap to rename`}>
              <AppText style={styles.name} numberOfLines={1}>
                {name}
              </AppText>
              <Icon name="pencil" size={13} color={theme.textFaint} strokeWidth={1.9} />
            </Touchable>
          )}
          {code ? <DenseText style={styles.code}>{code}</DenseText> : null}
        </View>

        <Row
          icon="star"
          label="My interests"
          value={interests.length > 0 ? interests.join(' · ') : 'None yet'}
          onPress={() => navigation.navigate('InterestPicker')}
        />
        <Row
          icon="people"
          label="Languages I speak"
          value={languages.length > 0 ? languages.join(' · ') : 'None yet'}
          onPress={() => navigation.navigate('LanguagePicker')}
        />
        <Row
          icon="broadcast"
          label="Being found"
          value={`${settings.autoAdvertise ? 'Discoverable' : 'Hidden'} · scanning ${
            scanning ? 'on' : 'off'
          }`}
          onPress={() => navigation.navigate('BeingFound')}
        />

        <Row
          icon="gear"
          label="Appearance"
          value={
            settings.themeMode === 'system'
              ? 'System'
              : settings.themeMode === 'light'
              ? 'Light'
              : 'Dark'
          }
          expanded={expanded === 'appearance'}
          onPress={() => setExpanded(e => (e === 'appearance' ? null : 'appearance'))}
        />
        {expanded === 'appearance' ? (
          <View style={styles.expansion}>
            <View style={styles.themeRow}>
              {(['light', 'dark', 'system'] as const).map(mode => {
                const on = settings.themeMode === mode;
                return (
                  <Touchable
                    key={mode}
                    scale={false}
                    onPress={() => save({themeMode: mode})}
                    style={styles.themeCell}
                    accessibilityRole="button"
                    accessibilityState={{selected: on}}>
                    {/* A miniature of the thing itself rather than a swatch: the choice
                        is what the app will look like, so the preview is the app. */}
                    <View
                      style={[
                        styles.themeCard,
                        {
                          backgroundColor: mode === 'dark' ? '#18181B' : '#FBFBF9',
                          borderColor: on ? theme.accent : theme.border,
                          borderWidth: on ? 1.5 : 1,
                        },
                      ]}>
                      <View
                        style={[
                          styles.themeBarTop,
                          {backgroundColor: mode === 'dark' ? '#3F3F46' : '#E4E3DE'},
                        ]}
                      />
                      <View style={[styles.themeBarAccent, {backgroundColor: theme.accent}]} />
                    </View>
                    <View style={styles.themeLabelRow}>
                      {on ? <Icon name="check" size={11} color={theme.accent} strokeWidth={2.6} /> : null}
                      <DenseText
                        style={[styles.themeLabel, on ? {color: theme.text} : null]}>
                        {mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
                      </DenseText>
                    </View>
                  </Touchable>
                );
              })}
            </View>
            <View style={styles.note}>
              <Icon name="info" size={13} color={theme.textDim} strokeWidth={2} />
              <DenseText style={styles.noteText}>
                System follows your phone and switches as it does — including at sunset.
              </DenseText>
            </View>
          </View>
        ) : null}

        <Row
          icon="key"
          label="Privacy &amp; security"
          value={`App lock ${lockEnabled ? 'on' : 'off'} · ${blockedPeerIds.length} blocked`}
          onPress={() => navigation.navigate('Privacy')}
        />
        <Row
          icon="code"
          label="Advanced"
          onPress={() => navigation.navigate('Debug')}
        />
        <Row
          icon="unlock"
          label="Log out"
          tone={theme.error}
          onPress={() => setLogOutVisible(true)}
        />
      </ScrollView>

      <LogOutSheet visible={logOutVisible} onClose={() => setLogOutVisible(false)} />
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  tone,
  expanded,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  tone?: string;
  expanded?: boolean;
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
      accessibilityState={expanded === undefined ? undefined : {expanded}}
      accessibilityLabel={value ? `${label}, ${value}` : label}>
      {/* A tinted disc, not a bare glyph. It gives the list a left rail to scan down and
          keeps the icons from floating against the text. */}
      <View
        style={[
          styles.rowIcon,
          {backgroundColor: (tone ?? theme.accent) + (theme.isDark ? '26' : '14')},
        ]}>
        <Icon name={icon} size={16} color={tone ?? theme.accent} strokeWidth={1.9} />
      </View>
      <View style={styles.rowText}>
        <AppText style={[styles.rowLabel, tone ? {color: tone} : null]}>{label}</AppText>
        {value ? (
          <DenseText style={styles.rowValue} numberOfLines={1}>
            {value}
          </DenseText>
        ) : null}
      </View>
      <Icon
        name={expanded ? 'chevronDown' : 'chevronRight'}
        size={16}
        color={theme.textFaint}
      />
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  head: {paddingHorizontal: 18, paddingTop: 14},
  title: {fontSize: 28, fontWeight: '600', letterSpacing: -1, lineHeight: 28, color: t.text},
  content: {paddingBottom: spacing.xl},

  identity: {alignItems: 'center', paddingTop: 24, paddingBottom: 26},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12},
  name: {fontSize: 20, fontWeight: '500', letterSpacing: -0.3, color: t.text},
  nameInput: {
    marginTop: 12,
    minWidth: 180,
    textAlign: 'center',
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: t.accent,
    padding: 0,
    includeFontPadding: false,
  },
  // The identity, in the form you would read aloud to check it.
  code: {fontFamily: fonts.mono, fontSize: 11.5, color: t.textDim, marginTop: 4},

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: t.divider,
  },
  rowIcon: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  rowText: {flex: 1},
  rowLabel: {fontSize: 14.5, color: t.text},
  rowValue: {...typography.caption, color: t.textDim, marginTop: 2},

  expansion: {paddingHorizontal: 18, paddingBottom: 18},
  themeRow: {flexDirection: 'row', gap: 10, marginTop: 4},
  themeCell: {flex: 1, alignItems: 'center', gap: 7},
  themeCard: {width: '100%', height: 74, borderRadius: 10, padding: 8, gap: 6, overflow: 'hidden'},
  themeBarTop: {height: 5, borderRadius: 3, width: '70%'},
  themeBarAccent: {height: 9, borderRadius: 4, width: '100%', marginTop: 'auto'},
  themeLabelRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  themeLabel: {...typography.caption, color: t.textDim},
  note: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16},
  noteText: {...typography.caption, color: t.textDim, flex: 1},
}));
