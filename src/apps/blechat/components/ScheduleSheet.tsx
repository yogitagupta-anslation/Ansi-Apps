import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {describeSchedule} from '../utils/time';

/**
 * When to send it.
 *
 * Two ways to answer, because there are two kinds of answer. Most of the time the wanted
 * time is one of a handful — this evening, tomorrow morning, tomorrow at nine — and those
 * are one tap. The rest of the time it is a specific minute, and that needs the wheels.
 * Offering only the wheels makes the common case work; offering only the presets makes
 * the uncommon one impossible.
 *
 * The wheels are built here rather than pulled in: there is no date picker in this
 * project, and adding a native one for four columns would be a new native dependency in
 * an app whose native surface is deliberately small. Three snapping lists under a
 * highlight band is what the platform picker is anyway.
 */

/** Row height for every wheel. The highlight band and the padding are derived from it. */
const ITEM_H = 38;
/** Rows visible above and below the selected one. Three rows total in the window. */
const VISIBLE_EDGE = 1;
const DAYS_AHEAD = 14;

interface Choice {
  label: string;
  value: number;
}

/** Today, Tomorrow, then weekday + date for a fortnight. */
function dayChoices(now: Date): Choice[] {
  const out: Choice[] = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const day = new Date(base.getTime());
    day.setDate(base.getDate() + i);
    const label =
      i === 0
        ? 'Today'
        : i === 1
        ? 'Tomorrow'
        : day.toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          });
    out.push({label, value: day.getTime()});
  }
  return out;
}

const HOURS: Choice[] = Array.from({length: 12}, (_, i) => ({
  label: String(i === 0 ? 12 : i),
  value: i === 0 ? 12 : i,
}));
const MINUTES: Choice[] = Array.from({length: 60}, (_, i) => ({
  label: String(i).padStart(2, '0'),
  value: i,
}));
const MERIDIEM: Choice[] = [
  {label: 'AM', value: 0},
  {label: 'PM', value: 1},
];

/** One snapping column. Reports the index under the highlight band once it settles. */
function Wheel({
  choices,
  index,
  onIndex,
  width,
  label,
}: {
  choices: Choice[];
  index: number;
  onIndex: (index: number) => void;
  width: number;
  label: string;
}) {
  const styles = useStyles();
  const ref = useRef<ScrollView>(null);
  const settled = useRef(index);

  // Follow the selection when it is changed from outside (a preset was tapped), but not
  // while the finger is the thing moving it — scrollTo mid-drag fights the gesture.
  useEffect(() => {
    if (settled.current !== index) {
      settled.current = index;
      ref.current?.scrollTo({y: index * ITEM_H, animated: true});
    }
  }, [index]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.max(
      0,
      Math.min(choices.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)),
    );
    settled.current = next;
    if (next !== index) {
      onIndex(next);
    }
  };

  return (
    <ScrollView
      ref={ref}
      style={{width}}
      contentContainerStyle={{paddingVertical: ITEM_H * VISIBLE_EDGE}}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      contentOffset={{x: 0, y: index * ITEM_H}}
      onMomentumScrollEnd={settle}
      // A slow drag that never gains momentum fires no momentum event, so the wheel would
      // sit between two rows with nothing selected.
      onScrollEndDrag={settle}
      accessibilityLabel={label}>
      {choices.map((choice, i) => (
        <View key={choice.label + i} style={styles.wheelItem}>
          <AppText
            style={[styles.wheelText, i === index ? styles.wheelTextOn : null]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}>
            {choice.label}
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}

/** The handful of times people actually mean, relative to right now. */
function presets(now: Date): Choice[] {
  const at = (addDays: number, hour: number, minute = 0) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const out: Choice[] = [];
  const inAnHour = new Date(now.getTime() + 3_600_000);
  inAnHour.setSeconds(0, 0);
  out.push({label: 'In an hour', value: inAnHour.getTime()});
  // Only worth offering while there is still an evening left to send in.
  if (now.getHours() < 20) {
    out.push({label: 'Tonight, 9:00', value: at(0, 21)});
  }
  out.push({label: 'Tomorrow, 8:00', value: at(1, 8)});
  out.push({label: 'Tomorrow, 18:00', value: at(1, 18)});
  return out;
}

export function ScheduleSheet({
  visible,
  /** Pre-fills the wheels when an existing scheduled message is being edited. */
  initial,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  initial?: number | null;
  onCancel: () => void;
  onConfirm: (at: number) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Captured once per opening, so a sheet left open overnight does not renumber its own
  // day column under the reader.
  const [now, setNow] = useState(() => new Date());
  const days = useMemo(() => dayChoices(now), [now]);

  const [dayIndex, setDayIndex] = useState(0);
  const [hourIndex, setHourIndex] = useState(0);
  const [minuteIndex, setMinuteIndex] = useState(0);
  const [pmIndex, setPmIndex] = useState(0);

  const applyTimestamp = React.useCallback(
    (at: number, reference: Date) => {
      const target = new Date(at);
      const midnight = new Date(
        target.getFullYear(),
        target.getMonth(),
        target.getDate(),
      ).getTime();
      const base = new Date(
        reference.getFullYear(),
        reference.getMonth(),
        reference.getDate(),
      ).getTime();
      const dayOffset = Math.round((midnight - base) / 86_400_000);
      setDayIndex(Math.max(0, Math.min(DAYS_AHEAD, dayOffset)));
      const hours24 = target.getHours();
      setPmIndex(hours24 >= 12 ? 1 : 0);
      const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
      setHourIndex(HOURS.findIndex(h => h.value === hour12));
      setMinuteIndex(target.getMinutes());
    },
    [],
  );

  // Reset on every open: a sheet that reopens on last week's choice is a trap.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const opened = new Date();
    setNow(opened);
    // An hour out, rounded to the next five minutes — a defensible default that is never
    // in the past, which is the only thing a default here must guarantee.
    const fallback = new Date(opened.getTime() + 3_600_000);
    fallback.setMinutes(Math.ceil(fallback.getMinutes() / 5) * 5, 0, 0);
    applyTimestamp(initial ?? fallback.getTime(), opened);
  }, [visible, initial, applyTimestamp]);

  const chosen = useMemo(() => {
    const day = days[dayIndex]?.value ?? days[0]?.value ?? now.getTime();
    const hour12 = HOURS[hourIndex]?.value ?? 12;
    const hour24 = (hour12 % 12) + (pmIndex === 1 ? 12 : 0);
    const at = new Date(day);
    at.setHours(hour24, MINUTES[minuteIndex]?.value ?? 0, 0, 0);
    return at.getTime();
  }, [days, dayIndex, hourIndex, minuteIndex, pmIndex, now]);

  const inPast = chosen <= Date.now();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable onPress={onCancel} style={StyleSheet.absoluteFill} accessibilityLabel="Cancel" />

        <View style={[styles.sheet, {paddingBottom: insets.bottom + spacing.lg}]}>
          <View style={styles.grip} />

          <View style={styles.head}>
            <Icon name="clock" size={17} color={theme.accent} strokeWidth={2} />
            <AppText style={styles.title}>Send Later</AppText>
          </View>

          <View style={styles.presets}>
            {presets(now).map(preset => (
              <Touchable
                key={preset.label}
                scale={false}
                onPress={() => applyTimestamp(preset.value, now)}
                style={styles.preset}
                accessibilityRole="button">
                <DenseText style={styles.presetText}>{preset.label}</DenseText>
              </Touchable>
            ))}
          </View>

          <View style={styles.wheels}>
            {/* The band, behind the columns, so the selected row reads as picked rather
                than as merely central. */}
            <View pointerEvents="none" style={styles.band} />
            <Wheel
              choices={days}
              index={dayIndex}
              onIndex={setDayIndex}
              width={140}
              label="Day"
            />
            <Wheel
              choices={HOURS}
              index={hourIndex}
              onIndex={setHourIndex}
              width={48}
              label="Hour"
            />
            <Wheel
              choices={MINUTES}
              index={minuteIndex}
              onIndex={setMinuteIndex}
              width={48}
              label="Minute"
            />
            <Wheel
              choices={MERIDIEM}
              index={pmIndex}
              onIndex={setPmIndex}
              width={52}
              label="AM or PM"
            />
          </View>

          {/*
            What "scheduled" can and cannot promise here.

            There is no server to hold this message and no push to wake the phone, so the
            app has to be running when the moment arrives — and even then the other phone
            has to be in range. Saying so is the difference between a feature and a
            promise this app cannot keep.
          */}
          <View style={styles.note}>
            <Icon name="info" size={13} color={theme.textFaint} strokeWidth={2} />
            <DenseText style={styles.noteText}>
              It goes out when BLE Chat is running and they are in range — never before{' '}
              {describeSchedule(chosen).toLowerCase()}.
            </DenseText>
          </View>

          <Touchable
            scale={false}
            onPress={() => onConfirm(chosen)}
            disabled={inPast}
            style={inPast ? [styles.confirm, styles.confirmOff] : styles.confirm}
            accessibilityRole="button"
            accessibilityState={{disabled: inPast}}>
            <DenseText style={[styles.confirmText, inPast ? styles.confirmTextOff : null]}>
              {inPast ? 'Pick a time in the future' : `Schedule for ${describeSchedule(chosen)}`}
            </DenseText>
          </Touchable>

          <Touchable
            scale={false}
            onPress={onCancel}
            style={styles.cancel}
            accessibilityRole="button">
            <DenseText style={styles.cancelText}>Cancel</DenseText>
          </Touchable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(t => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: t.isDark ? 'rgba(4,4,6,0.66)' : 'rgba(23,23,26,0.42)',
  },
  sheet: {
    backgroundColor: t.isDark ? t.surface : t.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  grip: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: t.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 8},
  title: {fontSize: 19, fontWeight: '500', letterSpacing: -0.3, color: t.text},

  presets: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14},
  preset: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  presetText: {fontSize: 12.5, fontWeight: '500', color: t.text},

  wheels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    height: ITEM_H * (VISIBLE_EDGE * 2 + 1),
    marginTop: 16,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_H * VISIBLE_EDGE,
    height: ITEM_H,
    borderRadius: radius.md,
    backgroundColor: t.surfaceAlt,
  },
  wheelItem: {height: ITEM_H, alignItems: 'center', justifyContent: 'center'},
  wheelText: {fontSize: 16, color: t.textFaint},
  wheelTextOn: {color: t.text, fontWeight: '500'},

  note: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16},
  noteText: {fontSize: 12, lineHeight: 18, color: t.textFaint, flex: 1},

  confirm: {
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  confirmOff: {backgroundColor: t.surfaceAlt},
  confirmText: {fontSize: 14.5, fontWeight: '500', color: t.onAccent},
  confirmTextOff: {color: t.textFaint},
  cancel: {height: 42, alignItems: 'center', justifyContent: 'center', marginTop: 4},
  cancelText: {fontSize: 14, fontWeight: '500', color: t.textDim},
}));
