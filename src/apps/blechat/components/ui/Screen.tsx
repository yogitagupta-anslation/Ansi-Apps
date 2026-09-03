import React from 'react';
import {View, type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {makeStyles} from '../../theme/ThemeProvider';

type Edge = 'top' | 'bottom';

/**
 * The root of every screen: a page-coloured surface, padded off the unsafe edges.
 *
 * Not `SafeAreaView`. That component resolves its insets natively, inside its own host
 * view, which means it cannot see a JS-side `SafeAreaInsetsContext` override and will
 * pad by the real status bar no matter what the tree above it says. When BLE Chat runs
 * somewhere that has already consumed the top inset — under the hub's frame, say — that
 * produced a second gap the app had no way to suppress.
 *
 * Reading `useSafeAreaInsets()` and applying the padding ourselves keeps the standalone
 * behaviour identical while making the inset something an embedder can actually own.
 */
export function Screen({
  edges = ['top'],
  style,
  children,
}: {
  edges?: Edge[];
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const useStyles = makeStyles(t => ({
  screen: {flex: 1, backgroundColor: t.bg},
}));
