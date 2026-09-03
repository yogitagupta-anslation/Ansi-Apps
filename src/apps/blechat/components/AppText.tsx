import React from 'react';
import {Text, type TextProps} from 'react-native';

/**
 * Text with font scaling bounded.
 *
 * On a phone with an enlarged Display size / Font size setting, unbounded scaling makes
 * text measure wider and taller than these dense layouts allocate, and the overflow is
 * clipped rather than reflowed — trailing glyphs vanish ("Protocol" renders as "Protoco",
 * "17:41" as "17:4") and wrapped second lines disappear entirely.
 *
 * Capping the multiplier keeps the app legible for users who need larger text while
 * preventing the layout from silently truncating content. It is a cap, not a disable:
 * accessibility scaling still works up to the limit.
 *
 * React 19 removed support for `Text.defaultProps`, so a shared wrapper is the way to
 * apply this consistently rather than a global mutation.
 */
export const MAX_FONT_SCALE = 1.3;

/** Slightly tighter cap for dense diagnostic tables where every column matters. */
export const MAX_FONT_SCALE_DENSE = 1.15;

export function AppText({
  maxFontSizeMultiplier = MAX_FONT_SCALE,
  ...rest
}: TextProps) {
  return <Text maxFontSizeMultiplier={maxFontSizeMultiplier} {...rest} />;
}

export function DenseText({
  maxFontSizeMultiplier = MAX_FONT_SCALE_DENSE,
  ...rest
}: TextProps) {
  return <Text maxFontSizeMultiplier={maxFontSizeMultiplier} {...rest} />;
}
