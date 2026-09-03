import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors} from '../theme';

interface Props {
  children: React.ReactNode;
  /** Screen background; defaults to the dark navy used across the app. */
  background?: string;
  /** Skip the bottom inset, e.g. when a footer already hugs the edge. */
  edges?: {top?: boolean; bottom?: boolean};
  style?: StyleProp<ViewStyle>;
}

/**
 * The root container for every screen.
 *
 * Deliberately a plain View with manual insets rather than the library's
 * SafeAreaView component. Under the New Architecture, replacing one native
 * SafeAreaView-rooted screen with another during a navigation transition can
 * leave a child attached to the outgoing view, which the Fabric mounting layer
 * rejects ("View already has a parent"). Reading the insets and padding a
 * normal View sidesteps that entirely, and is what the library recommends when
 * screens are managed by a navigator.
 */
export function Screen({children, background, edges, style}: Props) {
  const insets = useSafeAreaInsets();
  const useTop = edges?.top ?? true;
  const useBottom = edges?.bottom ?? true;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: background ?? colors.screen,
          paddingTop: useTop ? insets.top : 0,
          paddingBottom: useBottom ? insets.bottom : 0,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
