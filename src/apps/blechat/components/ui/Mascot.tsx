import React from 'react';
import Svg, {Circle, Ellipse, G, Path} from 'react-native-svg';

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
 */
export function Mascot({size = 88}: {size?: number}) {
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
      <Circle cx={44} cy={46} r={26} fill="#8B7CF6" />
      {/* a darker underside gives the flat circle some volume without a real gradient */}
      <Path
        d="M18 50a26 26 0 0052 0 26 26 0 01-52 0z"
        fill="#7C6AEF"
        opacity={0.5}
      />
      {/* two small nubs, so the silhouette isn't a plain circle */}
      <Circle cx={32} cy={22} r={4.5} fill="#8B7CF6" />
      <Circle cx={56} cy={22} r={4.5} fill="#8B7CF6" />

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
