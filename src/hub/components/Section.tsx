/**
 * A section eyebrow, with an optional action on the right.
 *
 * The eyebrow is the smallest type in the hub at 11px, which is exactly why it is also
 * the heaviest weight and the widest tracking: small and light is decoration, small and
 * deliberate is a label.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Press } from './Press';
import { radius, space, typeScale as t } from '../theme';
import { useHubTheme } from '../useHubTheme';

export function Section({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?(): void;
}): React.ReactElement {
  const theme = useHubTheme();
  return (
    <View style={styles.row}>
      <Text style={[t.eyebrow, { color: theme.textFaint }]}>{title}</Text>
      {action !== undefined && onAction !== undefined && (
        <Press onPress={onAction} scaleTo={0.94} hitSlop={8} accessibilityRole="button">
          <Text style={[t.metaStrong, { color: theme.accent }]}>{action}</Text>
        </Press>
      )}
    </View>
  );
}

/** A card surface. One border radius and one hairline, decided once. */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object | Array<object | false | undefined>;
}): React.ReactElement {
  const theme = useHubTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style as object,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
});
