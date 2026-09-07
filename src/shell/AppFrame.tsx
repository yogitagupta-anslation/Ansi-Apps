/**
 * The frame every hosted app runs inside — the session.
 *
 * Five apps, five complete UIs, none of which was written to share a screen with anything
 * else. So the frame takes the one strip of space nobody was using — the band under the
 * status bar — and puts the way out there, rather than floating a button over content it
 * cannot see.
 *
 * The inset override underneath is the part that makes that safe. Every screen in all five
 * apps pads its own top by `useSafeAreaInsets().top`; with a strip already sitting in that
 * space they would each pad past it and leave a second gap. Handing the subtree a top
 * inset of zero says, truthfully, that the unsafe area above is already dealt with.
 *
 * This is also the third and last place an app's accent is allowed to appear. The strip
 * wears it so the session reads as belonging to the app you launched rather than to the
 * launcher you left.
 *
 * Android's hardware back is not wired here: the root stack already pops to the hub once
 * the app's own nested navigator has nothing left to go back to, which is exactly the
 * behaviour you want and costs nothing to get.
 */

import React, { Suspense, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../hub/components/Icon';
import { Press } from '../hub/components/Press';
import type { HubApp } from '../hub/registry';
import { radius, space, typeScale as t } from '../hub/theme';
import { useHubTheme } from '../hub/useHubTheme';

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
            <Icon name="chevron-left" size={18} color={theme.textDim} />
            <Text style={[t.metaStrong, { color: theme.textDim }]}>App Hub</Text>
          </Press>

          <View style={[styles.tag, { backgroundColor: app.accentSoft }]}>
            <View style={[styles.dot, { backgroundColor: app.accent }]} />
            <Text style={[t.micro, { color: app.accent }]} numberOfLines={1}>
              {app.name}
            </Text>
          </View>
        </View>
      </View>

      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={styles.body}>
          <Suspense fallback={<Booting app={app} />}>{children}</Suspense>
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
function Booting({ app }: { app: HubApp }): React.ReactElement {
  const theme = useHubTheme();
  return (
    <View style={[styles.booting, { backgroundColor: theme.bg }]}>
      <ActivityIndicator size="large" color={app.accent} />
      <Text style={[t.body, { color: theme.textDim }]}>Starting {app.name}…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  strip: { borderBottomWidth: StyleSheet.hairlineWidth },
  stripRow: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: space.sm },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '55%',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  body: { flex: 1 },
  booting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
});
