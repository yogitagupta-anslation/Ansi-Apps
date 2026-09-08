/**
 * The store's line icons.
 *
 * All one family: 24×24 viewBox, round caps and joins, 1.9–2.1 stroke. They take
 * an explicit `color` because react-native-svg has no `currentColor` inheritance —
 * the web design leaned on that, and the closest native equivalent is passing the
 * colour down from whichever surface owns it.
 *
 * `fill` is separate from `color` on purpose: the two nav icons that light up when
 * active do it by filling their outline with the accent at low alpha, which is the
 * only place a fill appears at all.
 */

import React from 'react';
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color: string;
  /** Interior fill. Defaults to none — these are outline icons. */
  fill?: string;
  strokeWidth?: number;
}

function frame(size: number): { width: number; height: number; viewBox: string } {
  return { width: size, height: size, viewBox: '0 0 24 24' };
}

export function SearchIcon({ size = 18, color, strokeWidth = 2.1 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Circle cx={11} cy={11} r={8} stroke={color} strokeWidth={strokeWidth} />
      <Path d="m21 21-4.3-4.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function UserIcon({ size = 19, color, strokeWidth = 1.9 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="M20 21a8 8 0 0 0-16 0"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={7} r={4} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

export function HomeIcon({ size = 23, color, fill = 'none', strokeWidth = 1.9 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CompassIcon({
  size = 23,
  color,
  fill = 'none',
  strokeWidth = 1.9,
}: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={strokeWidth} />
      <Polygon
        points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function LibraryIcon({ size = 23, color, strokeWidth = 1.9 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path d="m16 6 4 14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 6v14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M8 8v12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M4 4v16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function WifiOffIcon({ size = 15, color, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2.007-1.51M22 8.82a15 15 0 0 0-6.032-3.107M2 2l20 20"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ShieldCheckIcon({ size = 15, color, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m9 12 2 2 4-4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SmartphoneIcon({ size = 15, color, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Rect x={5} y={2} width={14} height={20} rx={2} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M12 18h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 19, color, strokeWidth = 2.1 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="m15 18-6-6 6-6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 16, color, strokeWidth = 2.1 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="m9 18 6-6-6-6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function InfoIcon({ size = 12, color, strokeWidth = 2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M12 16v-4M12 8h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function BluetoothIcon({ size = 12, color, strokeWidth = 2.2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="m7 7 10 10-5 5V2l5 5L7 17"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ClockIcon({ size = 13, color, strokeWidth = 2.1 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M12 6v6l4 2"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TrendingIcon({ size = 17, color, strokeWidth = 2.2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path
        d="M22 7l-8.5 8.5-5-5L2 17"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 7h6v6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The magnifier with a cross through it, for the no-results plate. */
export function NoResultsIcon({ size = 38, color, strokeWidth = 1.8 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Circle cx={11} cy={11} r={8} stroke={color} strokeWidth={strokeWidth} />
      <Path d="m21 21-4.3-4.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path
        d="m8.5 8.5 5 5M13.5 8.5l-5 5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function CloseIcon({ size = 16, color, strokeWidth = 2.2 }: IconProps): React.ReactElement {
  return (
    <Svg {...frame(size)} fill="none">
      <Path d="M18 6 6 18M6 6l12 12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
