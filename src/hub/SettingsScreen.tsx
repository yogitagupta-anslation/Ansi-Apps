/**
 * Settings.
 *
 * Worth being precise about what "shared" means here, because a settings screen that
 * overstates its reach is worse than one that admits its limits.
 *
 *   - The permissions genuinely are shared. All five apps live in one APK behind one
 *     manifest, so a grant made here is the grant every one of them sees. The counts are
 *     read off the registry rather than written into the copy, so they cannot drift.
 *   - The name and the theme are the hub's own. Each app arrived with its own theme
 *     system and its own idea of who you are, and reaching into five apps to overwrite
 *     that is not a settings screen, it is a rewrite. So the labels say what these
 *     actually do instead of implying more.
 */

import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './components/Icon';
import { Press } from './components/Press';
import { Card, Section } from './components/Section';
import { APPS, appsNeeding } from './registry';
import {
  initialsOf,
  setDisplayName,
  setThemeMode,
  useHubPermissions,
  useHubSettings,
  type HubPermissionId,
} from './settings';
import { font, radius, space, typeScale as t, type HubThemeMode } from './theme';
import { useHubTheme } from './useHubTheme';

const PERMISSION_ICON: Record<HubPermissionId, IconName> = {
  bluetooth: 'bluetooth',
  location: 'map-pin',
  camera: 'camera',
  notifications: 'bell',
};

const THEMES: Array<{ mode: HubThemeMode; label: string }> = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

export function SettingsScreen(): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { displayName, themeMode } = useHubSettings();
  const { permissions, request } = useHubPermissions();

  const granted = permissions.filter((permission) => permission.granted).length;

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: space.xxl * 2 },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={[t.eyebrow, { color: theme.accent }]}>Hub settings</Text>
        <Text style={[t.title, { color: theme.text }]}>Settings</Text>
      </View>

      <View>
        <Section title="You" />
        <Card>
          <View style={styles.profile}>
            <View
              style={[styles.avatar, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}
            >
              <Text style={[t.figure, { color: theme.accent }]}>
                {displayName.trim() ? initialsOf(displayName) : '·'}
              </Text>
            </View>
            <View style={styles.profileText}>
              <Text style={[t.micro, { color: theme.textFaint }]}>Display name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Add your name"
                placeholderTextColor={theme.textFaint}
                style={[styles.nameInput, { color: theme.text }]}
                returnKeyType="done"
                maxFontSizeMultiplier={1.4}
              />
            </View>
          </View>
          <Note text="Used by the hub's own screens. Each app keeps the name you set inside it." />
        </Card>
      </View>

      <View>
        <Section title="Appearance" />
        <Card>
          <View style={styles.segment}>
            {THEMES.map((option) => {
              const on = option.mode === themeMode;
              return (
                <Press
                  key={option.mode}
                  onPress={() => setThemeMode(option.mode)}
                  scaleTo={0.95}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.segmentItem,
                    {
                      backgroundColor: on ? theme.chipOn : 'transparent',
                      borderColor: on ? theme.chipOn : theme.border,
                    },
                  ]}
                >
                  <Text style={[t.metaStrong, { color: on ? theme.chipOnText : theme.textDim }]}>
                    {option.label}
                  </Text>
                </Press>
              );
            })}
          </View>
          <Note text="Sets the hub's own screens. The apps ship with their own themes and keep them." />
        </Card>
      </View>

      <View>
        <Section title="Shared with every app" />
        <Card>
          {permissions.map((permission, index) => {
            const users = appsNeeding(permission.id);
            return (
              <View
                key={permission.id}
                style={[
                  styles.row,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.divider,
                  },
                ]}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.surfaceAlt }]}>
                  <Icon
                    name={PERMISSION_ICON[permission.id]}
                    size={17}
                    color={permission.granted ? theme.accent : theme.textFaint}
                  />
                </View>

                <View style={styles.rowText}>
                  <Text style={[t.bodyStrong, { color: theme.text }]}>{permission.label}</Text>
                  <Text style={[t.meta, { color: theme.textDim }]}>{permission.detail}</Text>
                  <Text style={[t.micro, { color: theme.textFaint }]}>
                    {/* Counted from the registry, so it can never claim an app that
                        stopped needing it — or miss one that started. */}
                    {users.length === 0
                      ? 'No app asks for this yet'
                      : `${users.length} of ${APPS.length} apps`}
                  </Text>
                </View>

                <Switch
                  value={permission.granted}
                  onValueChange={() => request(permission.id)}
                  trackColor={{ false: theme.surfaceAlt, true: theme.accent }}
                  thumbColor={theme.isDark ? '#F2F5FA' : '#FFFFFF'}
                  accessibilityLabel={permission.label}
                />
              </View>
            );
          })}
          <Note
            text={
              // Android has no API for handing a permission back, so the honest thing is
              // to say where it can be done rather than to imply the switch does it.
              'Granted once for the whole hub. Turning one off happens in Android settings, which this opens.'
            }
          />
        </Card>
      </View>

      <View>
        <Section title="About" />
        <Card>
          <View style={styles.aboutRow}>
            <Text style={[t.body, { color: theme.textDim }]}>Apps in this build</Text>
            <Text style={[t.bodyStrong, { color: theme.text }]}>{APPS.length}</Text>
          </View>
          <View
            style={[styles.aboutRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}
          >
            <Text style={[t.body, { color: theme.textDim }]}>Permissions granted</Text>
            <Text style={[t.bodyStrong, { color: theme.text }]}>
              {granted} of {permissions.length}
            </Text>
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}

/** The line under a card that says what the control above it really touches. */
function Note({ text }: { text: string }): React.ReactElement {
  const theme = useHubTheme();
  return (
    <View style={[styles.note, { borderTopColor: theme.divider, backgroundColor: theme.surfaceAlt }]}>
      <Text style={[t.micro, { color: theme.textFaint }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, gap: space.lg },
  header: { gap: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { flex: 1, gap: 2 },
  nameInput: {
    fontFamily: font.display,
    fontSize: 17,
    letterSpacing: -0.3,
    padding: 0,
    includeFontPadding: false,
  },
  segment: { flexDirection: 'row', gap: space.sm, padding: space.md },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  rowIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  note: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.sm },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
  },
});
