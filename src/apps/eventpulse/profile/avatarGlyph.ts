/**
 * How the letters inside an avatar are sized, and what those letters are.
 *
 * Pure arithmetic and string handling, kept out of `Avatar.tsx` so the domain
 * test suite can reach it — the component itself is JSX and never compiled by
 * the Node build.
 */

/**
 * Type metrics for the glyph inside an avatar of a given diameter.
 *
 * This exists because of a real bug. The initials used to spread
 * `typography.bodyStrong` and override only `fontSize`, which left
 * `lineHeight: 21` in place while the glyph grew with the circle. At hero size
 * a 33 px letter was drawn inside a 21 px line box and had its top and bottom
 * sliced off, on every profile sheet in the app. It scaled with the avatar,
 * which is exactly why nobody caught it at map size.
 *
 * The rule it encodes: never inherit a line height from a text style whose font
 * size you are about to replace. Both numbers are derived here, together, from
 * one input.
 */
export function avatarGlyphMetrics(dimension: number): {
  fontSize: number;
  lineHeight: number;
} {
  const fontSize = Math.round(dimension * 0.34);
  // 1.2x leaves room for ascenders and descenders at every size. Initials are
  // capitals and rarely need the descender, but "?" and stray lower-case input
  // do, and the cost of the headroom is nothing.
  return { fontSize, lineHeight: Math.round(fontSize * 1.2) };
}

/**
 * First and last initial, which is what people recognise. Falls back to two
 * letters of a single name, and never returns an empty string — a blank circle
 * reads as a failed image load rather than a person without a photo.
 */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
