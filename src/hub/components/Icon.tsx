/**
 * The hub's icon wrapper.
 *
 * Same reasoning as the one inside Attendance, and deliberately a separate copy: the
 * hub does not import from the apps it hosts, in either direction. The `/static` subpath
 * is the entry point whose font is copied in by Gradle at build time, so icons render
 * without a runtime font load — and if they ever come out as empty boxes, the APK was not
 * rebuilt rather than the code being wrong.
 *
 * The wrapper exists for `includeFontPadding: false`. Font icons render as text, and
 * Android's extra line padding sits them visibly low inside a row or a circle; fixing it
 * in one place is the difference between chrome that looks deliberate and chrome that
 * looks slightly off everywhere.
 */

import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Lucide } from '@react-native-vector-icons/lucide/static';

export type IconName = React.ComponentProps<typeof Lucide>['name'];

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: string;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return <Lucide name={name} size={size} color={color} style={[styles.icon, style]} />;
}

const styles = StyleSheet.create({
  icon: { includeFontPadding: false, textAlignVertical: 'center' },
});
