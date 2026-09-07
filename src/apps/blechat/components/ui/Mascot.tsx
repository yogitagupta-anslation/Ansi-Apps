import React from 'react';
import {View} from 'react-native';
import Svg, {Circle, Ellipse, G, Path} from 'react-native-svg';
import {useTheme} from '../../theme/ThemeProvider';

/**
 * The identity avatar: an original illustrated character, not a reproduction of any
 * existing artwork.
 *
 * The reference mockup uses an illustrated mascot — a violet monster wearing headphones,
 * with sparkles floating around it. That specific image is a stock/template illustration
 * with no source file available here, and cloning someone else's raster art pixel-for-
 * pixel is both impossible without the asset and not something to copy wholesale. This is
 * a bespoke vector drawing built to the same brief instead: a friendly rounded creature in
 * the app's own violet, wearing headphones, with the same sparkle accents — recognisably
 * the same idea, honestly an original.
 *
 * `tint` exists because the face is an identity, not a logo: the profile step lets you
 * pick a colour, and two phones draw the same face from the same three numbers. Defaulting
 * it keeps every existing call site rendering exactly what it did before.
 */
export function Mascot({size = 88, tint = '#8B7CF6'}: {size?: number; tint?: string}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 88 88">
      {/* floating sparkles, outside the body */}
      <Sparkle x={10} y={14} scale={0.55} color="#C4B5FD" />
      <Sparkle x={74} y={20} scale={0.4} color="#A78BFA" />
      <Sparkle x={72} y={62} scale={0.32} color="#DDD6FE" />

      {/* headphone band, behind the body */}
      <Path
        d="M20 40a24 24 0 0148 0"
        stroke="#22D3D8"
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={18} cy={46} r={6.5} fill="#22D3D8" />
      <Circle cx={70} cy={46} r={6.5} fill="#22D3D8" />

      {/* body */}
      <Circle cx={44} cy={46} r={26} fill={tint} />
      {/* a darker underside gives the flat circle some volume without a real gradient */}
      <Path
        d="M18 50a26 26 0 0052 0 26 26 0 01-52 0z"
        fill="#7C6AEF"
        opacity={0.5}
      />
      {/* two small nubs, so the silhouette isn't a plain circle */}
      <Circle cx={32} cy={22} r={4.5} fill={tint} />
      <Circle cx={56} cy={22} r={4.5} fill={tint} />

      {/* face */}
      <G>
        <Ellipse cx={35} cy={45} rx={6.5} ry={7.5} fill="#ffffff" />
        <Ellipse cx={53} cy={45} rx={6.5} ry={7.5} fill="#ffffff" />
        <Circle cx={36.5} cy={46.5} r={3.1} fill="#1E1B3A" />
        <Circle cx={54.5} cy={46.5} r={3.1} fill="#1E1B3A" />
        <Circle cx={35} cy={44} r={1.1} fill="#ffffff" />
        <Circle cx={53} cy={44} r={1.1} fill="#ffffff" />
      </G>
      <Path
        d="M37 58q7 6 14 0"
        stroke="#1E1B3A"
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />

      {/* blush */}
      <Circle cx={26} cy={53} r={3.2} fill="#C4B5FD" opacity={0.6} />
      <Circle cx={62} cy={53} r={3.2} fill="#C4B5FD" opacity={0.6} />
    </Svg>
  );
}

function Sparkle({
  x,
  y,
  scale,
  color,
}: {
  x: number;
  y: number;
  scale: number;
  color: string;
}) {
  // A simple four-point star, drawn as two overlapping teardrops.
  return (
    <Path
      d="M0 -10C1 -3 3 -1 10 0C3 1 1 3 0 10C-1 3 -3 1 -10 0C-3 -1 -1 -3 0 -10Z"
      fill={color}
      transform={`translate(${x} ${y}) scale(${scale})`}
    />
  );
}

/**
 * The mascot at row size, with the status dot the design hangs off its corner.
 *
 * A separate drawing rather than `<Mascot size={38}>` because the full one does not
 * survive the reduction: sparkles, blush and the volume shading land inside two or three
 * pixels each at this size and turn into noise around the eyes. This keeps the parts that
 * still read — silhouette, nubs, eyes, mouth — which is also exactly what the design
 * shows in a row.
 *
 * `status` is a colour rather than a state name so the caller decides what it means; the
 * ring around it is painted in the page colour so the dot reads as punched out of the
 * avatar rather than stuck on top of it.
 */
export function MascotAvatar({
  size = 38,
  tint = '#8B7CF6',
  status = null,
  /** Dimmed for a peer that is gone or unreachable — the design's 0.4–0.55 rows. */
  faded = 0,
}: {
  size?: number;
  tint?: string;
  status?: string | null;
  faded?: number;
}) {
  const theme = useTheme();
  const dot = Math.max(9, Math.round(size * 0.29));

  return (
    <View style={{width: size, height: size}}>
      <View style={faded > 0 ? {opacity: 1 - faded} : undefined}>
        <Svg width={size} height={size} viewBox="0 0 88 88">
          <Circle cx={44} cy={46} r={26} fill={tint} />
          <Circle cx={32} cy={22} r={4.5} fill={tint} />
          <Circle cx={56} cy={22} r={4.5} fill={tint} />
          <Ellipse cx={35} cy={45} rx={6.5} ry={7.5} fill="#ffffff" />
          <Ellipse cx={53} cy={45} rx={6.5} ry={7.5} fill="#ffffff" />
          <Circle cx={36.5} cy={46.5} r={3.1} fill="#17171A" />
          <Circle cx={54.5} cy={46.5} r={3.1} fill="#17171A" />
          <Path
            d="M34 58q10 8 20 0"
            stroke="#17171A"
            strokeWidth={2.6}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </View>

      {status !== null ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: status,
            borderWidth: 2,
            borderColor: theme.bg,
          }}
        />
      ) : null}
    </View>
  );
}
