import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** Rendered opposite the title -- usually the BLE status badge. */
  headerRight?: React.ReactNode;
  /** Pinned below the content, outside the scroll area. */
  footer?: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  children: React.ReactNode;
}

/**
 * Every screen's frame: gradient backdrop, safe-area padding, optional back
 * button + title row, and a pinned footer slot for primary actions.
 */
export default function Screen({
  title,
  subtitle,
  onBack,
  headerRight,
  footer,
  scroll = false,
  contentStyle,
  children,
}: ScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const showHeader = Boolean(title || onBack || headerRight);

  return (
    <LinearGradient colors={colors.screenGradient} style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        {showHeader ? (
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {onBack ? (
                <Pressable
                  onPress={onBack}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                >
                  <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
                </Pressable>
              ) : null}
              {title ? (
                <View style={styles.titleBlock}>
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                  {subtitle ? (
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
            {headerRight}
          </View>
        ) : null}

        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.content, styles.scrollContent, contentStyle]}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, styles.content, contentStyle]}>{children}</View>
        )}

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.buttonSecondary,
    borderWidth: 1,
    borderColor: colors.buttonSecondaryBorder,
  },
  pressed: {
    opacity: 0.6,
  },
  titleBlock: {
    flexShrink: 1,
  },
  title: {
    ...fonts.title,
    color: colors.textPrimary,
    fontSize: 17,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
});
