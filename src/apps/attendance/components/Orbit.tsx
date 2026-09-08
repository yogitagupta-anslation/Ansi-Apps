/**
 * Orbit.tsx
 * -----------------------------------------------------------------------------
 * The v3 centrepiece: three fixed capability nodes — Bluetooth, Permissions and
 * Connection — arranged around a core that carries the live state word.
 *
 * WHAT MOVES AND WHAT DOES NOT. The nodes hold fixed positions so their labels
 * stay readable; what orbits is the radar sweep and two satellite pulses. That
 * separation is the whole idea: position means "which capability", motion means
 * "the radio is working".
 *
 * EVERY STATE IS EARNED. The seven states map to what the radio is actually
 * doing — ready, scanning, no device nearby, device found, connected, checked
 * in, permission required. Nothing here animates on hope: `sweep` and `pulse`
 * run only in the states where the radio genuinely is doing something, so a
 * spinning ring always means a live scan.
 *
 * Both roles share it. The host reads the same three capabilities, with its own
 * wording ("IN RANGE" rather than "CONNECTION") and at 252px rather than 300.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

/** The design's base box. Everything below is measured against it and scaled. */
const BASE = 300;
const R = 100;
const NODE = 56;
const CORE = 132;

/** Node centres, straight from the design. */
const BT = { x: 150, y: 50 };
const PM = { x: 63.4, y: 200 };
const CN = { x: 236.6, y: 200 };

const GLYPH = {
  bt: 'M12 2v20M12 8l5-3.5M12 16l5 3.5M12 8 7 4.5M12 16l-5 3.5',
  radar: 'M4.9 16.1a7 7 0 0 1 0-9.9M19.1 6.2a7 7 0 0 1 0 9.9M7.8 13.2a3 3 0 0 1 0-4.4M16.2 8.8a3 3 0 0 1 0 4.4',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.8M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19',
  check: 'm4 12.5 5.5 5.5L20 7',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  slash: 'M18.4 18.4A9 9 0 0 1 5.6 5.6m2.2-1.4a9 9 0 0 1 12 12M2 2l20 20',
} as const;

const SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';

export type OrbitState =
  | 'ready'
  | 'scanning'
  | 'looking'
  | 'found'
  | 'connected'
  | 'present'
  | 'permission';

type GlyphKey = keyof typeof GLYPH;
type ToneKey = 'idle' | 'pri' | 'acc' | 'ok' | 'warn';
/** 0 = off (recessed well), 1 = available, 2 = actively working (breathes). */
type NodeLevel = 0 | 1 | 2;

interface StateSpec {
  title: string;
  tone: ToneKey;
  bt: NodeLevel;
  pm: NodeLevel;
  cn: NodeLevel;
  glyph: GlyphKey;
  cnGlyph: GlyphKey;
  sweep: boolean;
  pulse: boolean;
}

const MAP: Record<OrbitState, StateSpec> = {
  ready: { title: 'Ready', tone: 'idle', bt: 1, pm: 1, cn: 0, glyph: 'bt', cnGlyph: 'link', sweep: false, pulse: false },
  scanning: { title: 'Scanning…', tone: 'pri', bt: 1, pm: 1, cn: 2, glyph: 'radar', cnGlyph: 'search', sweep: true, pulse: true },
  looking: { title: 'No device nearby', tone: 'pri', bt: 1, pm: 1, cn: 0, glyph: 'search', cnGlyph: 'slash', sweep: true, pulse: false },
  found: { title: 'Device found', tone: 'acc', bt: 1, pm: 1, cn: 1, glyph: 'link', cnGlyph: 'link', sweep: true, pulse: true },
  connected: { title: 'Connected', tone: 'pri', bt: 1, pm: 1, cn: 1, glyph: 'link', cnGlyph: 'link', sweep: true, pulse: true },
  present: { title: 'Checked in', tone: 'ok', bt: 1, pm: 1, cn: 1, glyph: 'check', cnGlyph: 'check', sweep: false, pulse: true },
  permission: { title: 'Permission required', tone: 'warn', bt: 1, pm: 2, cn: 0, glyph: 'alert', cnGlyph: 'slash', sweep: false, pulse: false },
};

const HOST_SUB: Record<OrbitState, string> = {
  ready: 'Tap to start scanning',
  scanning: 'Listening for broadcasts',
  looking: 'No employee in range',
  found: 'Employee detected',
  connected: 'Writing the attendance record',
  present: 'Attendance recorded',
  permission: 'Allow nearby devices',
};

/** The host renames three of the seven; the rest keep the shared wording. */
const HOST_TITLE: Partial<Record<OrbitState, string>> = {
  looking: 'Nobody in range',
  found: 'Employee found',
  present: 'Attendance recorded',
};

interface OrbitProps {
  state: OrbitState;
  role: 'employee' | 'host';
  /** Rendered size. The design uses 300 on employee Home, 252 on the host. */
  size?: number;
  /** The host device an employee is talking to, for the sub-label. */
  deviceName?: string;
  /** When checked in, the time it happened. */
  checkInTime?: string;
  /** Signal at match, shown on `found`. Omitted when it is not known. */
  rssi?: number | null;
  /**
   * Replaces the state's stock sub-line.
   *
   * The core doubles as a button, so its sub-line is a promise about what a tap
   * does. When the screen knows the tap will do something OTHER than the state
   * implies — "add an employee first" rather than "tap to start scanning" — it
   * has to say so, or the label lies about the control.
   */
  sub?: string;
  onPress?: () => void;
  disabled?: boolean;
}

export function Orbit({
  state,
  role,
  size = BASE,
  deviceName,
  checkInTime,
  rssi,
  sub: subOverride,
  onPress,
  disabled = false,
}: OrbitProps) {
  const t = useTheme();
  const spec = MAP[state] ?? MAP.ready;
  const isHost = role === 'host';
  const k = size / BASE;

  const TONE: Record<ToneKey, { fg: string; glow: string }> = {
    idle: { fg: t.colors.textMuted, glow: 'rgba(100,116,139,0.35)' },
    pri: { fg: t.colors.primaryTint, glow: 'rgba(133,146,255,0.55)' },
    acc: { fg: t.colors.accentTint, glow: 'rgba(167,139,250,0.55)' },
    ok: { fg: t.colors.success, glow: 'rgba(34,197,94,0.55)' },
    warn: { fg: t.colors.warning, glow: 'rgba(245,158,11,0.55)' },
  };
  const tone = TONE[spec.tone];

  const title = (isHost && HOST_TITLE[state]) || spec.title;
  const device = deviceName || 'the host';
  const stockSub = isHost
    ? state === 'found' && rssi !== null && rssi !== undefined
      ? 'Employee detected · ' + rssi + ' dBm'
      : HOST_SUB[state]
    : {
        ready: 'Tap to start check-in',
        scanning: 'Listening for a host device',
        looking: 'Move closer to the office',
        found: rssi !== null && rssi !== undefined ? device + ' · ' + rssi + ' dBm' : device,
        connected: 'Verifying with ' + device,
        present: checkInTime ? 'Since ' + checkInTime : 'Checked in',
        permission: 'Allow nearby devices',
      }[state];
  const sub = subOverride ?? stockSub;

  /**
   * A node's whole appearance follows from its level, so the three nodes never
   * disagree about what "available" or "working" looks like.
   */
  const node = (level: NodeLevel) => {
    if (level === 0) {
      return {
        bg: t.colors.surfaceMuted,
        bd: t.colors.border,
        fg: t.colors.textMuted,
        label: t.colors.textMuted,
        raised: false,
        breathe: false,
      };
    }
    if (level === 2) {
      return {
        bg: t.colors.surface,
        bd: tone.fg,
        fg: tone.fg,
        label: tone.fg,
        raised: true,
        breathe: true,
      };
    }
    return {
      bg: t.colors.surface,
      bd: t.colors.border,
      fg: tone.fg,
      label: t.colors.textSecondary,
      raised: true,
      breathe: false,
    };
  };

  const bt = node(spec.bt);
  const pm = node(spec.pm);
  const cn = node(spec.cn);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.stage, { transform: [{ scale: k }] }]}>
        {/* ------------------------------------------------ ring + sweep -- */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={BASE} height={BASE}>
            <Circle
              cx={150}
              cy={150}
              r={R}
              fill="none"
              stroke={t.colors.borderStrong}
              strokeWidth={1}
              opacity={0.6}
            />
          </Svg>
        </View>

        {spec.sweep ? (
          <Spin duration={5200} style={StyleSheet.absoluteFill}>
            <Svg width={BASE} height={BASE}>
              <Circle
                cx={150}
                cy={150}
                r={R}
                fill="none"
                stroke={tone.fg}
                strokeWidth={2.5}
                strokeLinecap="round"
                // An 86-unit arc on a 628-unit circumference: a sweep, not a ring.
                strokeDasharray="86 542"
              />
            </Svg>
          </Spin>
        ) : null}

        {/* ---------------------------------------------------- pulses -- */}
        {spec.pulse ? (
          <>
            <Pulse color={tone.fg} delay={0} />
            <Pulse color={tone.fg} delay={1600} />
          </>
        ) : null}

        {/* ------------------------------------------------ satellites -- */}
        {spec.sweep ? (
          <>
            <Spin duration={9000} style={StyleSheet.absoluteFill}>
              <View
                style={[
                  styles.sat,
                  {
                    backgroundColor: tone.fg,
                    shadowColor: tone.fg,
                    shadowOpacity: 0.9,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 6,
                  },
                ]}
              />
            </Spin>
            <Spin duration={14000} reverse style={StyleSheet.absoluteFill}>
              <View style={[styles.satSmall, { backgroundColor: tone.fg }]} />
            </Spin>
          </>
        ) : null}

        {/* ----------------------------------------------------- nodes -- */}
        <Node
          centre={BT}
          glyph={GLYPH.bt}
          label="BLUETOOTH"
          labelLeft={100}
          labelTop={6}
          visual={bt}
          neu={t.neu}
        />
        <Node
          centre={PM}
          glyph={SHIELD}
          extraGlyph={spec.pm === 2 ? 'M12 8v4M12 15h.01' : 'M9 12l2 2 4-4'}
          label="PERMISSIONS"
          labelLeft={13.4}
          labelTop={236}
          visual={pm}
          neu={t.neu}
        />
        <Node
          centre={CN}
          glyph={GLYPH[spec.cnGlyph]}
          label={isHost ? 'IN RANGE' : 'CONNECTION'}
          labelLeft={186.6}
          labelTop={236}
          visual={cn}
          neu={t.neu}
        />

        {/* ------------------------------------------------------ core -- */}
        <Pressable
          onPress={onPress}
          disabled={disabled || !onPress}
          accessibilityRole="button"
          accessibilityLabel={title + '. ' + sub}
          style={({ pressed }) => [
            styles.core,
            t.neu,
            {
              backgroundColor: t.colors.surface,
              borderColor: spec.tone === 'idle' ? t.colors.border : tone.fg,
              opacity: disabled ? 0.6 : 1,
              transform: [{ scale: pressed ? 0.955 : 1 }],
            },
          ]}>
          <Svg width={21} height={21} viewBox="0 0 24 24">
            <Path
              d={GLYPH[spec.glyph]}
              fill="none"
              stroke={tone.fg}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Txt style={[styles.coreTitle, { color: t.colors.textPrimary }]}>{title}</Txt>
          <Txt style={[styles.coreSub, { color: t.colors.textMuted }]}>{sub}</Txt>
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- Node -- */

interface NodeVisual {
  bg: string;
  bd: string;
  fg: string;
  label: string;
  raised: boolean;
  breathe: boolean;
}

function Node({
  centre,
  glyph,
  extraGlyph,
  label,
  labelLeft,
  labelTop,
  visual,
  neu,
}: {
  centre: { x: number; y: number };
  glyph: string;
  extraGlyph?: string;
  label: string;
  labelLeft: number;
  labelTop: number;
  visual: NodeVisual;
  neu: object;
}) {
  const breath = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visual.breathe) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 0.55, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visual.breathe, breath]);

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.node,
          visual.raised ? neu : null,
          {
            left: centre.x - NODE / 2,
            top: centre.y - NODE / 2,
            backgroundColor: visual.bg,
            borderColor: visual.bd,
            opacity: breath,
          },
        ]}>
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path
            d={glyph}
            fill="none"
            stroke={visual.fg}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {extraGlyph ? (
            <Path
              d={extraGlyph}
              fill="none"
              stroke={visual.fg}
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </Svg>
      </Animated.View>

      <Txt
        style={[styles.nodeLabel, { left: labelLeft, top: labelTop, color: visual.label }]}
        numberOfLines={1}>
        {label}
      </Txt>
    </>
  );
}

/* ------------------------------------------------------------------- Spin -- */

/** Rotates its children forever. Transform-only, so it stays on the UI thread. */
function Spin({
  duration,
  reverse = false,
  style,
  children,
}: {
  duration: number;
  reverse?: boolean;
  style?: object;
  children: React.ReactNode;
}) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    // Stop only — see the note above about resetting on unmount.
    return () => loop.stop();
  }, [spin, duration]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          transform: [
            {
              rotate: spin.interpolate({
                inputRange: [0, 1],
                outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ Pulse -- */

/** One expanding ring: 0.66 → 0.95 scale while fading out, on a 3.2s cycle. */
function Pulse({ color, delay }: { color: string; delay: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 3200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [progress, delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulse,
        {
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.66, 0.95] }) },
          ],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  stage: { height: BASE, position: 'relative', width: BASE },

  pulse: {
    borderRadius: 999,
    borderWidth: 1.5,
    height: 200,
    left: 50,
    position: 'absolute',
    top: 50,
    width: 200,
  },

  // Both satellites sit on the ring at twelve o'clock; their parent rotates.
  sat: { borderRadius: 999, height: 7, left: 146.5, position: 'absolute', top: 46.5, width: 7 },
  satSmall: {
    borderRadius: 999,
    height: 4,
    left: 148,
    opacity: 0.5,
    position: 'absolute',
    top: 48,
    width: 4,
  },

  node: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: NODE,
    justifyContent: 'center',
    position: 'absolute',
    width: NODE,
  },
  nodeLabel: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.9,
    position: 'absolute',
    textAlign: 'center',
    width: 100,
  },

  core: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    gap: 5,
    height: CORE,
    justifyContent: 'center',
    left: (BASE - CORE) / 2,
    paddingHorizontal: 10,
    position: 'absolute',
    top: (BASE - CORE) / 2,
    width: CORE,
  },
  coreTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 13.5,
    letterSpacing: -0.2,
    lineHeight: 16.2,
    textAlign: 'center',
  },
  coreSub: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 9.5,
    letterSpacing: 0.1,
    lineHeight: 12.35,
    textAlign: 'center',
  },
});
