/**
 * An app's page: what it is, what it will ask for, and the way in.
 *
 * The page earns its place through "Uses from your hub". Every one of these apps wants
 * the radio, and the usual way you find that out is a permission dialog thrown at you
 * three taps into a flow you had already committed to. Here the requirements are listed
 * against their live state before you start, so "Bluetooth is off" is something you read
 * rather than something you hit.
 *
 * That check is honest for one specific reason: the five apps ship inside a single APK
 * with a single manifest, so a permission this screen reads is the same grant the app
 * will see. It is not a proxy for the app's state — it is the app's state.
 *
 * The app's own accent runs the page. This is its page, so this is where it gets to.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTile } from './components/AppTile';
import { Icon, type IconName } from './components/Icon';
import { Press } from './components/Press';
import { Card, Section } from './components/Section';
import type { HubApp } from './registry';
import { useHubPermissions, type HubPermissionId } from './settings';
import { lift, radius, space, typeScale as t } from './theme';
import { useHubTheme } from './useHubTheme';

const PERMISSION_ICON: Record<HubPermissionId, IconName> = {
  bluetooth: 'bluetooth',
  location: 'map-pin',
  camera: 'camera',
  notifications: 'bell',
};

export function AppDetailScreen({
  app,
  onLaunch,
  onBack,
}: {
  app: HubApp;
  onLaunch(): void;
  onBack(): void;
}): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { permissions, request } = useHubPermissions();

  const required = useMemo(
    () => permissions.filter((permission) => app.needs.includes(permission.id)),
    [permissions, app.needs],
  );
  const missing = required.filter((permission) => !permission.granted);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xxl * 2 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Press
          onPress={onBack}
          scaleTo={0.92}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Icon name="chevron-left" size={20} color={theme.textDim} />
          <Text style={[t.bodyStrong, { color: theme.textDim }]}>Apps</Text>
        </Press>

        <View style={styles.hero}>
          <AppTile app={app} size="xl" />
          <View style={styles.heroText}>
            <Text style={[t.headline, { color: theme.text }]}>{app.name}</Text>
            <Text style={[t.body, { color: theme.textDim }]}>{app.tagline}</Text>
            <View style={[styles.tag, { backgroundColor: app.accentSoft }]}>
              <Text style={[t.micro, { color: app.accent }]}>{app.tags[0]}</Text>
            </View>
          </View>
        </View>

        <Press
          onPress={onLaunch}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={`Use ${app.name}`}
          style={[styles.cta, { backgroundColor: app.accent }, lift(theme, 2)]}
        >
          <Text style={[t.bodyStrong, styles.ctaLabel]}>Use it!</Text>
          <Icon name="arrow-right" size={17} color="#0B1020" />
        </Press>

        <Text style={[t.meta, styles.installNote, { color: theme.textFaint }]}>
          Nothing to install — it runs inside the hub.
        </Text>

        <View style={styles.stats}>
          <Stat label="Category" value={app.tags[0]} />
          <Stat label="Works" value={app.offline ? 'Offline' : 'Online'} />
          <Stat
            label="Permissions"
            value={app.needs.length === 0 ? 'None' : String(app.needs.length)}
          />
        </View>

        <View>
          <Section title="About" />
          <Text style={[t.body, { color: theme.textDim }]}>{app.about}</Text>
        </View>

        <View>
          <Section title="What it does" />
          <Card>
            {app.highlights.map((highlight, index) => (
              <View
                key={highlight}
                style={[
                  styles.highlight,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
                ]}
              >
                <Icon name="check" size={15} color={app.accent} style={styles.check} />
                <Text style={[t.body, styles.highlightText, { color: theme.text }]}>
                  {highlight}
                </Text>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <Section title="Uses from your hub" />

          {app.needs.length === 0 ? (
            <Card>
              <View style={styles.permission}>
                <View style={[styles.permIcon, { backgroundColor: theme.surfaceAlt }]}>
                  <Icon name="shield-check" size={17} color={theme.ok} />
                </View>
                <View style={styles.permText}>
                  <Text style={[t.bodyStrong, { color: theme.text }]}>Asks for nothing</Text>
                  <Text style={[t.meta, { color: theme.textDim }]}>
                    Runs entirely on this device with no permissions at all.
                  </Text>
                </View>
              </View>
            </Card>
          ) : (
            <Card>
              {required.map((permission, index) => (
                <View
                  key={permission.id}
                  style={[
                    styles.permission,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.divider,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.permIcon,
                      { backgroundColor: permission.granted ? theme.surfaceAlt : theme.accentSoft },
                    ]}
                  >
                    <Icon
                      name={PERMISSION_ICON[permission.id]}
                      size={17}
                      color={permission.granted ? theme.textDim : theme.accent}
                    />
                  </View>

                  <View style={styles.permText}>
                    <Text style={[t.bodyStrong, { color: theme.text }]}>{permission.label}</Text>
                    <Text style={[t.meta, { color: theme.textDim }]}>{permission.detail}</Text>
                  </View>

                  <Text
                    style={[t.micro, { color: permission.granted ? theme.ok : theme.warn }]}
                  >
                    {permission.granted ? 'On' : 'Off'}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {missing.length > 0 && (
            <Press
              onPress={() => request(missing[0].id)}
              scaleTo={0.98}
              accessibilityRole="button"
              accessibilityLabel={`Grant ${missing[0].label}`}
              style={[
                styles.warn,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Icon name="triangle-alert" size={16} color={theme.warn} />
              <Text style={[t.meta, styles.warnText, { color: theme.textDim }]}>
                {missing.length === 1
                  ? `${missing[0].label} is off — ${app.name} will ask for it.`
                  : `${missing.length} permissions are off — ${app.name} will ask for them.`}
              </Text>
              <Text style={[t.metaStrong, { color: theme.accent }]}>Grant</Text>
            </Press>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  const theme = useHubTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <Text style={[t.figure, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[t.micro, { color: theme.textFaint }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.lg, gap: space.lg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  heroText: { flex: 1, gap: space.xs, alignItems: 'flex-start' },
  tag: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.lg,
  },
  // Dark ink for the same reason the featured pill uses it: every registry accent is a
  // light hue, so this is the readable direction for all five.
  ctaLabel: { color: '#0B1020', fontSize: 15 },
  installNote: { textAlign: 'center', marginTop: -space.sm },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    gap: 2,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  highlight: { flexDirection: 'row', gap: space.sm, padding: space.md, alignItems: 'flex-start' },
  // Nudged to sit on the first line of text rather than the middle of the block.
  check: { marginTop: 3 },
  highlightText: { flex: 1 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  permIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  permText: { flex: 1, gap: 1 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
  warnText: { flex: 1 },
});
