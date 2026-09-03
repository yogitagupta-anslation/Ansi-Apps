/**
 * Sheet — the one bottom-sheet shell.
 *
 * `ProfileCard` and `VenuePlanSheet` each grew their own copy of this modal
 * boilerplate before it was worth extracting; four more sheets made it worth it.
 * Scrim, grab handle, rounded top, safe-area padding and a consistent close
 * affordance in one place, so a sheet added later cannot drift.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space } from '../theme/tokens';
import { AppText } from './primitives';

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  /** Cap the sheet height as a fraction of the screen. */
  maxHeightPercent = 86,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxHeightPercent?: number;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            maxHeight: `${maxHeightPercent}%`,
          },
          elevation.high,
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

        {title ? (
          <View style={styles.header}>
            <View style={styles.headerText}>
              <AppText variant="title">{title}</AppText>
              {subtitle ? (
                <AppText variant="caption" tone="secondary">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <AppText variant="caption" tone="tertiary">
                ✕
              </AppText>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        {footer ? (
          <SafeAreaView edges={['bottom']}>
            <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View>
          </SafeAreaView>
        ) : (
          <SafeAreaView edges={['bottom']} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingTop: space.sm,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
    gap: space.md,
  },
  headerText: { flex: 1, gap: 2 },
  close: { padding: 6 },
  content: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.sm },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
