import {Dimensions, Platform} from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
  xxxl: 44,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/** Depth of the 3D "lip" under a chunky button. */
export const BUTTON_LIP = 5;

export const HIT_SLOP = {top: 10, bottom: 10, left: 10, right: 10};
export const MIN_TOUCH = 48;

export function screen() {
  return Dimensions.get('window');
}

export const isAndroid = Platform.OS === 'android';
export const isIOS = Platform.OS === 'ios';

/** Elevation that reads correctly on both platforms. */
export function elevate(level: number, shadowColor = '#000') {
  if (Platform.OS === 'android') {
    return {elevation: level};
  }
  return {
    shadowColor,
    shadowOpacity: 0.4,
    shadowRadius: level * 1.2,
    shadowOffset: {width: 0, height: level * 0.5},
  };
}

/**
 * Coloured glow. Android cannot tint an elevation shadow, so callers draw the
 * glow with a border or a translucent halo view instead.
 */
export function glow(color: string, level = 12) {
  if (Platform.OS === 'android') {
    return {elevation: Math.round(level / 2)};
  }
  return {
    shadowColor: color,
    shadowOpacity: 0.9,
    shadowRadius: level,
    shadowOffset: {width: 0, height: 0},
  };
}
