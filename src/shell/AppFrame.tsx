/**
 * The frame every hosted app runs inside.
 *
 * Three apps, three complete UIs, none of which was written to share a screen
 * with anything. So the frame takes the one strip of space nobody was using — the
 * band under the status bar — and puts the way out there, rather than floating a
 * button over content it cannot see.
 *
 * The inset override underneath is the part that makes that safe. Every screen in
 * all three apps pads its own top by `useSafeAreaInsets().top`; with a strip
 * already sitting in that space they would each pad past it and leave a second
 * gap. Handing the subtree a top inset of zero says, truthfully, that the unsafe
 * area above is already dealt with.
 *
 * Android's hardware back is not wired here: the root stack already pops to the
 * hub once the app's own nested navigator has nothing left to go back to, which
 * is exactly the behaviour you want and costs nothing to get.
 */

import React, { Suspense, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Press } from '../hub/components/Press';
import type { HubApp } from '../hub/registry';
import { space, useHubTheme } from '../hub/theme';

interface AppFrameProps {
  app: HubApp;
  onExit(): void;
  children: React.ReactNode;
}

export function AppFrame({ app, onExit, children }: AppFrameProps): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();

  const childInsets = useMemo(() => ({ ...insets, top: 0 }), [insets]);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.strip,
          {
            paddingTop: insets.top,
            backgroundColor: theme.bg,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View style={styles.stripRow}>
          <Press
            onPress={onExit}
            scaleTo={0.92}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to App Hub"
            style={styles.back}
          >
            <Text style={[styles.chevron, { color: theme.textDim }]}>‹</Text>
            <Text style={[styles.backLabel, { color: theme.textDim }]}>App Hub</Text>
          </Press>

          <View style={styles.appTag}>
            <Text style={styles.appIcon}>{app.icon}</Text>
            <Text style={[styles.appName, { color: app.accent }]} numberOfLines={1}>
              {app.name}
            </Text>
          </View>
        </View>
      </View>

      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={styles.body}>
          <Suspense fallback={<Booting accent={app.accent} name={app.name} />}>{children}</Suspense>
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * Shown while the app's bundle is still being pulled in. Each of these apps is
 * code-split, so on a cold launch there is a real moment here — better a named
 * spinner than a blank rectangle.
 */
function Booting({ accent, name }: { accent: string; name: string }): React.ReactElement {
  const theme = useHubTheme();
  return (
    <View style={[styles.booting, { backgroundColor: theme.bg }]}>
      <ActivityIndicator size="large" color={accent} />
      <Text style={[styles.bootingLabel, { color: theme.textDim }]}>Starting {name}…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  strip: { borderBottomWidth: StyleSheet.hairlineWidth },
  stripRow: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingRight: space.sm },
  // Nudged up because the glyph's own bearing sits it low in the line box.
  chevron: { fontSize: 22, fontWeight: '600', marginTop: -3 },
  backLabel: { fontSize: 14, fontWeight: '600' },
  appTag: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '55%' },
  appIcon: { fontSize: 13 },
  appName: { fontSize: 13, fontWeight: '700' },
  body: { flex: 1 },
  booting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  bootingLabel: { fontSize: 14 },
});
