import React from 'react';
import Svg, {Circle, Path, Rect} from 'react-native-svg';

/**
 * The glyph set for the vivid design system.
 *
 * Simple two-stroke line icons drawn as raw SVG paths, matched by eye against the
 * reference mockup rather than pulled from an icon font — the mockup's Bluetooth, radar,
 * broadcast and clock glyphs do not correspond to any single open icon set closely enough
 * to reuse one wholesale. `strokeWidth` and `round` joins are shared across every icon so
 * the set reads as one family rather than several pasted together.
 */

export type IconName =
  | 'bluetooth'
  | 'radar'
  | 'broadcast'
  | 'people'
  | 'link'
  | 'clock'
  | 'chevronRight'
  | 'arrowUp'
  | 'info'
  | 'plus'
  | 'pencil'
  | 'shield'
  | 'house'
  | 'gear'
  | 'controller'
  | 'target'
  | 'stop'
  | 'check'
  | 'block'
  | 'alert'
  | 'sort'
  | 'code'
  | 'search'
  | 'copy'
  | 'share'
  | 'chevronDown'
  | 'chart'
  | 'device'
  | 'inbox'
  | 'mail'
  | 'chevronLeft'
  | 'more'
  | 'close'
  | 'chatBubble'
  | 'key'
  | 'trash'
  | 'arrowDown'
  | 'star'
  | 'starFilled'
  | 'unlock';

interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({name, size = 20, color, strokeWidth = 1.8}: IconProps) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {ICONS[name](common, color)}
    </Svg>
  );
}

type StrokeProps = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: 'none';
};

const ICONS: Record<IconName, (p: StrokeProps, color: string) => React.ReactNode> = {
  bluetooth: p => <Path {...p} d="M6.5 6.5L17.5 17.5L12 23L12 1L17.5 6.5L6.5 17.5" />,
  radar: (p, color) => (
    <>
      <Circle cx={12} cy={12} r={8} {...p} />
      <Circle cx={12} cy={12} r={4} {...p} />
      <Circle cx={12} cy={12} r={1.4} fill={color} stroke="none" />
    </>
  ),
  broadcast: (p, color) => (
    <>
      <Circle cx={12} cy={12} r={1.6} fill={color} stroke="none" />
      <Path {...p} d="M8.5 8.5a5 5 0 000 7" />
      <Path {...p} d="M15.5 8.5a5 5 0 010 7" />
      <Path {...p} d="M5.5 5.5a9.5 9.5 0 000 13" />
      <Path {...p} d="M18.5 5.5a9.5 9.5 0 010 13" />
    </>
  ),
  people: p => (
    <>
      <Circle cx={9} cy={8.5} r={2.6} {...p} />
      <Path {...p} d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <Circle cx={17} cy={9.5} r={2} {...p} />
      <Path {...p} d="M15.5 14.2c2.3.3 4 2 4 4.8" />
    </>
  ),
  link: p => (
    <>
      <Path {...p} d="M9.5 14.5l5-5" />
      <Path {...p} d="M11 6.5l1-1a3.5 3.5 0 015 5l-1 1" />
      <Path {...p} d="M13 17.5l-1 1a3.5 3.5 0 01-5-5l1-1" />
    </>
  ),
  clock: p => (
    <>
      <Circle cx={12} cy={12} r={8} {...p} />
      <Path {...p} d="M12 8v4.5l3 2" />
    </>
  ),
  chevronRight: p => <Path {...p} d="M9 5l7 7-7 7" />,
  info: p => (
    <>
      <Circle cx={12} cy={12} r={9} {...p} />
      <Path {...p} d="M12 11v5" />
      <Path {...p} d="M12 8h.01" />
    </>
  ),
  // A stem and a chevron, not a filled triangle: it sits inside a 34px accent circle at
  // 16px, and a solid glyph that small turns into a blob.
  arrowUp: p => (
    <>
      <Path {...p} d="M12 19V6" />
      <Path {...p} d="M6 12l6-6 6 6" />
    </>
  ),
  plus: p => (
    <>
      <Path {...p} d="M12 5v14" />
      <Path {...p} d="M5 12h14" />
    </>
  ),
  pencil: p => (
    <>
      <Path {...p} d="M15 4.5l4.5 4.5-10 10L5 20l1-4.5z" />
      <Path {...p} d="M13.2 6.3l4.5 4.5" />
    </>
  ),
  shield: p => (
    <>
      <Path {...p} d="M12 3.5l7 3v5.5c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6.5z" />
      <Path {...p} d="M9 12l2 2 4-4.5" />
    </>
  ),
  house: p => (
    <>
      <Path {...p} d="M4.5 11.5L12 5l7.5 6.5" />
      <Path {...p} d="M6.5 10v9h11v-9" />
    </>
  ),
  gear: p => (
    <>
      <Circle cx={12} cy={12} r={3} {...p} />
      <Path
        {...p}
        d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5M17.8 17.8l-1.5-1.5M7.7 7.7L6.2 6.2"
      />
    </>
  ),
  controller: (p, color) => (
    <>
      <Path {...p} d="M7 9.5h10a4 4 0 013.8 5.3l-.5 1.4a2.3 2.3 0 01-4-.7L15.8 14H8.2l-.5 1.5a2.3 2.3 0 01-4 .7l-.5-1.4A4 4 0 017 9.5z" />
      <Path {...p} d="M9.2 12h1.8M10.1 11.1v1.8" />
      <Circle cx={15.2} cy={11.3} r={0.5} fill={color} stroke="none" />
      <Circle cx={16.8} cy={12.7} r={0.5} fill={color} stroke="none" />
    </>
  ),
  target: (p, color) => (
    <>
      <Circle cx={12} cy={12} r={7.5} {...p} />
      <Circle cx={12} cy={12} r={2.2} fill={color} stroke="none" />
    </>
  ),
  stop: (p, color) => <Rect x={7} y={7} width={10} height={10} rx={2.5} fill={color} stroke="none" />,
  check: p => <Path {...p} d="M5 12.5l4.5 4.5L19 7.5" />,
  block: p => (
    <>
      <Circle cx={12} cy={12} r={8} {...p} />
      <Path {...p} d="M6.8 6.8l10.4 10.4" />
    </>
  ),
  alert: (p, color) => (
    <>
      <Circle cx={12} cy={12} r={8} {...p} />
      <Path {...p} d="M12 8.3v5" />
      <Circle cx={12} cy={16} r={1.1} fill={color} stroke="none" />
    </>
  ),
  sort: p => (
    <>
      <Path {...p} d="M7 6v12M7 6l-3 3M7 6l3 3" />
      <Path {...p} d="M17 18V6M17 18l-3-3M17 18l3-3" />
    </>
  ),
  code: p => (
    <>
      <Path {...p} d="M9 7L4 12l5 5" />
      <Path {...p} d="M15 7l5 5-5 5" />
    </>
  ),
  search: p => (
    <>
      <Circle cx={10.5} cy={10.5} r={6.5} {...p} />
      <Path {...p} d="M19.5 19.5l-4.3-4.3" />
    </>
  ),
  copy: p => (
    <>
      <Rect x={8.5} y={8.5} width={11} height={11} rx={2} {...p} />
      <Path {...p} d="M6.5 15.5H5.5A2 2 0 013.5 13.5V5.5a2 2 0 012-2h8a2 2 0 012 2v1" />
    </>
  ),
  share: p => (
    <>
      <Path {...p} d="M12 15.5V4M12 4L8 8M12 4l4 4" />
      <Path {...p} d="M5.5 12v6.5a2 2 0 002 2h9a2 2 0 002-2V12" />
    </>
  ),
  chevronDown: p => <Path {...p} d="M5 9l7 7 7-7" />,
  chart: p => (
    <>
      <Path {...p} d="M5 19V10" />
      <Path {...p} d="M12 19V5" />
      <Path {...p} d="M19 19v-6" />
    </>
  ),
  device: p => (
    <>
      <Rect x={6} y={3} width={12} height={18} rx={2.2} {...p} />
      <Path {...p} d="M10.5 18h3" />
    </>
  ),
  inbox: p => (
    <>
      <Path {...p} d="M12 4v10.5M12 14.5l-3.5-3.5M12 14.5l3.5-3.5" />
      <Path {...p} d="M4.5 14v4a2 2 0 002 2h11a2 2 0 002-2v-4" />
    </>
  ),
  mail: p => (
    <>
      <Rect x={3.5} y={5.5} width={17} height={13} rx={2} {...p} />
      <Path {...p} d="M4.5 7l7.5 6 7.5-6" />
    </>
  ),
  chevronLeft: p => <Path {...p} d="M15 5l-7 7 7 7" />,
  more: (p, color) => (
    <>
      <Circle cx={5.5} cy={12} r={1.4} fill={color} stroke="none" />
      <Circle cx={12} cy={12} r={1.4} fill={color} stroke="none" />
      <Circle cx={18.5} cy={12} r={1.4} fill={color} stroke="none" />
    </>
  ),
  close: p => (
    <>
      <Path {...p} d="M6 6l12 12" />
      <Path {...p} d="M18 6L6 18" />
    </>
  ),
  chatBubble: p => (
    <>
      <Path {...p} d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v8a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 014 14.5v-8z" />
    </>
  ),
  key: p => (
    <>
      <Circle cx={8} cy={15.5} r={4} {...p} />
      <Path {...p} d="M11 12.5L19.5 4M17 6.5l2 2M14.5 9l1.7 1.7" />
    </>
  ),
  trash: p => (
    <>
      <Path {...p} d="M5 7h14" />
      <Path {...p} d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <Path {...p} d="M7 7l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13" />
      <Path {...p} d="M10 11v6M14 11v6" />
    </>
  ),
  arrowDown: p => (
    <>
      <Path {...p} d="M12 5v13" />
      <Path {...p} d="M6 13l6 6 6-6" />
    </>
  ),
  star: p => (
    <Path
      {...p}
      d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.8z"
    />
  ),
  starFilled: (p, color) => (
    <Path
      d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.8z"
      fill={color}
      stroke={color}
      strokeWidth={p.strokeWidth}
      strokeLinejoin="round"
    />
  ),
  unlock: p => (
    <>
      <Rect x={5} y={11} width={14} height={10} rx={2.2} {...p} />
      <Path {...p} d="M8 11V7.5a4 4 0 017.5-1.9" />
    </>
  ),
};
