/**
 * Dark fantasy palette.
 *
 * Sampled from the reference art: near-black navy grounds, stone-and-gold
 * framing, warm lantern light, cold blue moonlight, and purple arcane accents.
 * Nothing here is a neutral "dark mode" grey -- every surface carries a hue so
 * the UI reads as one lit world rather than a dashboard.
 */
export const colors = {
  // Grounds, darkest first.
  abyss: '#05080F',
  night: '#0A0E1A',
  screen: '#0B1120',
  header: '#111A2E',
  surface: '#16203A',
  surfaceRaised: '#1D2A47',
  surfaceHigh: '#26365A',
  hairline: '#33456B',
  hairlineSoft: '#22304E',

  // Stone and metal framing.
  stone: '#5A6472',
  stoneDark: '#3A4352',
  stoneLight: '#7C8797',
  frameGold: '#C9A227',
  frameGoldLight: '#F0CF6B',

  // Text.
  text: '#F4F7FF',
  textDim: '#C6D3EA',
  textMuted: '#8DA0C0',
  textFaint: '#5E718F',

  // Gold / treasure.
  gold: '#F5C445',
  goldBright: '#FFDE8A',
  goldDeep: '#E0A02A',
  goldShadow: '#8A6410',
  goldInk: '#2B1E05',

  // Lantern fire.
  amber: '#FFA22C',
  orange: '#FF8A2B',
  ember: '#FF6B1A',
  fire: '#FF4E1A',

  // Blue arcane / moonlight.
  blue: '#2E9BE6',
  blueBright: '#5EC0FF',
  blueDeep: '#1D6FB0',
  blueShadow: '#0F4674',
  cyan: '#4FC3F7',
  moon: '#BFD7F5',

  // Purple arcane.
  violet: '#8B5CF6',
  violetBright: '#B18BFF',
  violetDeep: '#5B2E9E',
  ribbon: '#7B3FA0',

  // Crystal.
  crystal: '#5EEAD4',
  crystalDeep: '#0E7490',

  // Go / status.
  green: '#4CAF50',
  greenBright: '#7BE07F',
  greenDeep: '#34803A',
  greenShadow: '#1E5423',
  success: '#4CAF50',
  warning: '#FFB020',
  danger: '#E5484D',
  dangerDeep: '#A31D22',
  frost: '#9FD4FF',
  aqua: '#39E6C3',

  // Rank medals.
  medalGold: '#F5C445',
  medalSilver: '#C7D2E0',
  medalBronze: '#CD7F32',

  // World terrain -- moonlit clearing, not daylight.
  grassLight: '#2A4A2C',
  grass: '#16261A',
  grassDark: '#101D14',
  grassDeep: '#132312',
  water: '#1F5F8B',
  waterLight: '#2E86B8',
  path: '#6B7A5C',
  outOfBounds: '#070C14',

  // Radar.
  radarInk: '#08210F',
  radarFill: '#0C3018',
  radarRing: '#2F7C4A',
  radarSweep: '#63C8FF',
  radarGrid: '#1E5E39',

  overlay: 'rgba(4, 7, 14, 0.88)',
  transparent: 'transparent',
} as const;

export type ColorName = keyof typeof colors;

/** Player marker colours, assigned by join order. */
export const PLAYER_COLORS = [
  '#F5C445',
  '#4FC3F7',
  '#7BE07F',
  '#FF8A2B',
  '#B18BFF',
  '#FF6B8A',
  '#5EEAD4',
  '#F06292',
] as const;

export function playerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length] as string;
}

/** Translucent version of a hex colour. */
export function alpha(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
