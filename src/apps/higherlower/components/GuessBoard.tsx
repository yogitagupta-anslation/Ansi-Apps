import React, { useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Verdict } from '../types/game';
import { knownRange, parGuesses, rangeSize } from '../game/engine';
import { RaceState } from '../game/raceState';
import { formatDuration, plural } from '../util/format';
import { feedback } from '../util/feedback';
import BigNumber from './BigNumber';
import Button from './Button';
import FeedbackBanner from './FeedbackBanner';
import GuessHistory from './GuessHistory';
import GuessImpact from './GuessImpact';
import Keypad from './Keypad';
import RacerLane from './RacerLane';
import RangeTrack from './RangeTrack';
import DuelPanel from './DuelPanel';
import { MIN_TOUCH, Palette, glyph, radius, spacing, type, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface GuessBoardProps {
  race: RaceState;
  youId: string;
  entry: string;
  onEntryChange(next: string): void;
  onSubmit(wagered: boolean): void;
  /** Latest verdict for *your* lane, driving the banner. */
  lastVerdict: Verdict | null;
  verdictNonce: number;
  /** Stop waiting on the stragglers and go straight to the results. */
  onSkipWait?: () => void;
  /** What the bot is muttering, shown in its lane. */
  opponentNote?: string | null;
  /** Extra controls under the lanes -- reactions, in multiplayer. */
  slot?: React.ReactNode;

}

/**
 * The playfield, shared by Solo and Multiplayer. Everything above the keypad
 * answers one of four questions: who else is racing, what is still possible,
 * what did that last guess buy me, and how many tries do I have left.
 */
export default function GuessBoard({
  race,
  youId,
  entry,
  onEntryChange,
  onSubmit,
  lastVerdict,
  verdictNonce,
  onSkipWait,
  opponentNote,
  slot,
}: GuessBoardProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [wagered, setWagered] = useState(false);
  /**
   * How tall the readout area actually turned out to be.
   *
   * The board is a fixed stack -- lanes, range track, readout, trail, keypad --
   * and on a short screen the total wants more room than there is. The stage is
   * the one part that can give, so it is the one that has to be told how much
   * it got: sized by digit count alone the number simply overflowed and drew
   * over the trail beneath it.
   */
  const [stageHeight, setStageHeight] = useState(0);
  const onStageLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h !== stageHeight) setStageHeight(h);
  };

  const rules = race.rules;
  const you = race.racers.find((r) => r.id === youId);
  const others = race.racers.filter((r) => r.id !== youId);
  const guesses = you?.guesses ?? [];
  const finished = race.status === 'finished';
  const knockedOut = you?.eliminated === true;
  const youDone = you?.finishedAt != null || knockedOut;
  const stillGuessing = others.filter((r) => r.finishedAt === null && !r.eliminated);
  const dropped = others.filter((r) => r.offline);

  const known = useMemo(() => knownRange(race.range, guesses), [race.range, guesses]);
  const par = parGuesses(race.range);
  const maxDigits = String(race.range.max).length;

  const lastGuess = guesses[guesses.length - 1] ?? null;
  const before = useMemo(
    () => rangeSize(knownRange(race.range, guesses.slice(0, -1))),
    [race.range, guesses],
  );

  const left = rules.guessLimit === null ? null : rules.guessLimit - guesses.length;

  const entered = Number(entry);
  const inRange = entry.length > 0 && entered >= race.range.min && entered <= race.range.max;
  const alreadyTried = guesses.some((g) => g.value === entered);
  const canSubmit = inRange && !alreadyTried && !finished && !youDone;

  const hint = (() => {
    if (knockedOut) return 'Out of guesses';
    if (youDone || finished) return 'Round over';
    if (entry.length === 0) return `Pick a number from ${race.range.min} to ${race.range.max}`;
    if (!inRange) return `Out of range — ${race.range.min} to ${race.range.max}`;
    if (alreadyTried) return 'You already tried that one';
    if (left !== null && left <= 2) return `Guess #${guesses.length + 1} — ${left} left`;
    return `Guess #${guesses.length + 1}`;
  })();

  const submit = () => {
    onSubmit(wagered);
    setWagered(false);
  };

  // What the stage owes its other children before the number may have the rest:
  // the verdict banner, the hint line, the impact bar when a guess has landed,
  // and a gap between each. Measured once here rather than guessed per screen.
  const stageReserved = BANNER_HEIGHT + HINT_HEIGHT + (lastGuess ? IMPACT_HEIGHT : 0) + spacing.sm * 3;
  const numberCeiling =
    stageHeight > 0 ? Math.max(MIN_NUMBER_SIZE, stageHeight - stageReserved) : undefined;

  return (
    <View style={styles.wrap}>
      {/* One opponent is a duel, not a leaderboard. */}
      {others.length === 1 && you ? (
        <DuelPanel
          you={you}
          them={others[0]}
          par={par}
          winnerId={race.winnerId}
          startedAt={race.startedAt}
          running={race.status === 'running'}
          hideGuesses={rules.hideRange}
        />
      ) : others.length > 1 ? (
        <View style={styles.lanes}>
          {others.map((racer) => (
            <RacerLane
              key={racer.id}
              racer={racer}
              par={par}
              isWinner={race.winnerId === racer.id}
              active={race.status === 'running' && racer.finishedAt === null && !racer.eliminated}
              note={racer.kind === 'ai' ? opponentNote : null}
            />
          ))}
        </View>
      ) : null}

      {others.length === 1 && opponentNote && race.status === 'running' ? (
        <Text style={styles.quip}>“{opponentNote}”</Text>
      ) : null}

      {dropped.length > 0 ? (
        <View style={styles.dropped}>
          <Text style={styles.droppedText}>
            📡 {dropped.map((r) => r.name).join(', ')} {dropped.length === 1 ? 'lost' : 'lost'} the link — reconnecting.
            {' '}Their guesses are safe.
          </Text>
        </View>
      ) : null}

      {slot}

      {rules.hideRange ? (
        <View style={styles.blind}>
          <Text style={styles.blindText}>🙈 BLIND ROUND — NO RANGE, NO COUNTER</Text>
        </View>
      ) : (
        <RangeTrack range={race.range} known={known} guesses={guesses} />
      )}

      <View style={styles.stage} onLayout={onStageLayout}>
        <BigNumber
          value={entry}
          placeholder={'–'.repeat(Math.min(2, maxDigits))}
          tone={lastVerdict && entry.length === 0 ? verdictColor(lastVerdict, colors) : colors.textPrimary}
          maxSize={numberCeiling}
        />
        <FeedbackBanner verdict={lastVerdict} nonce={verdictNonce} />
        {lastGuess ? <GuessImpact guess={lastGuess} before={before} hideCounts={rules.hideRange} /> : null}
        <Text style={[styles.hint, !canSubmit && entry.length > 0 && !finished && styles.hintWarn]}>{hint}</Text>
      </View>

      <View style={styles.trail}>
        <View style={styles.trailHeader}>
          <Text style={styles.trailLabel}>YOUR GUESSES</Text>
          <Text style={[styles.trailMeta, left !== null && left <= 2 && styles.trailMetaWarn]}>
            {/* The range track above already carries how many numbers are
                left, so this line only reports the guess count. */}
            {left !== null ? `${guesses.length} of ${rules.guessLimit} used` : `${guesses.length} of ${par} par`}
          </Text>
        </View>
        <GuessHistory guesses={guesses} />
      </View>

      {rules.wager && !youDone ? (
        <Pressable
          onPress={() =>
            setWagered((w) => {
              feedback.wager(!w);
              return !w;
            })
          }
          accessibilityRole="switch"
          accessibilityState={{ checked: wagered }}
          accessibilityLabel={rules.wager === 'double' ? 'Double down on this guess' : 'Flag this guess as risky'}
          style={({ pressed }) => [styles.wager, wagered && styles.wagerOn, pressed && styles.wagerPressed]}
        >
          <Text style={styles.wagerIcon}>{rules.wager === 'double' ? '💰' : '🎲'}</Text>
          <Text style={[styles.wagerText, wagered && styles.wagerTextOn]}>
            {rules.wager === 'double'
              ? wagered
                ? 'Doubling down — this guess counts double'
                : 'Double down on the next guess'
              : wagered
                ? 'Risking it — +40 if it lands, −15 if not'
                : 'Call the next guess risky'}
          </Text>
        </Pressable>
      ) : null}

      {youDone ? (
        <View style={[styles.done, knockedOut && styles.doneOut]}>
          <Text style={[styles.doneTitle, knockedOut && styles.doneTitleOut]}>
            {knockedOut
              ? `Out of guesses after ${plural(guesses.length, 'try')}`
              : `You got it in ${plural(guesses.length, 'guess')} · ${formatDuration(you?.finishedAt ?? 0)}`}
          </Text>
          <Text style={styles.doneBody}>
            {stillGuessing.length === 0
              ? 'Everyone is done.'
              : `${stillGuessing.map((r) => r.name).join(' and ')} ${
                  stillGuessing.length === 1 ? 'is' : 'are'
                } still guessing — they get to finish too.`}
          </Text>
          {onSkipWait && stillGuessing.length > 0 ? (
            <Button label="See results now" variant="secondary" icon="podium-outline" compact onPress={onSkipWait} />
          ) : null}
        </View>
      ) : (
        <Keypad
          value={entry}
          onChange={onEntryChange}
          onSubmit={submit}
          maxDigits={maxDigits}
          canSubmit={canSubmit}
          disabled={finished}
        />
      )}
    </View>
  );
}

/** Measured heights of the stage's fixed furniture, so the number gets the rest. */
const BANNER_HEIGHT = 46;
const HINT_HEIGHT = 18;
const IMPACT_HEIGHT = 48;
/** Below this the readout stops being a readout. */
const MIN_NUMBER_SIZE = 44;

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    flex: 1,
    gap: spacing.md,
  },
  lanes: {
    gap: spacing.sm,
  },
  dropped: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.higherTint,
    borderWidth: 1,
    borderColor: colors.higher,
  },
  droppedText: {
    ...type.caption,
    color: colors.higher,
  },
  quip: {
    ...type.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'right',
    marginTop: -spacing.xs,
  },
  blind: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.divider,
  },
  blindText: {
    ...type.micro,
    color: colors.textMuted,
  },
  stage: {
    // Takes the leftover space and centres in it, rather than being squeezed
    // below its own content height -- a View does not clip, so a stage smaller
    // than its children overflows onto whatever is underneath.
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hint: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  hintWarn: {
    color: colors.higher,
  },
  trail: {
    gap: spacing.xs,
  },
  trailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trailLabel: {
    ...type.micro,
    color: colors.textMuted,
  },
  trailMeta: {
    ...type.micro,
    letterSpacing: 0,
    color: colors.textMuted,
  },
  trailMetaWarn: {
    color: colors.higher,
  },
  wager: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  wagerOn: {
    backgroundColor: colors.goldTint,
    borderColor: colors.gold,
  },
  wagerPressed: {
    opacity: 0.7,
  },
  wagerIcon: {
    fontSize: glyph.md,
  },
  wagerText: {
    ...type.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  wagerTextOn: {
    ...type.body,
    color: colors.gold,
  },
  done: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.correctTint,
    borderWidth: 1,
    borderColor: colors.correctBorder,
  },
  doneOut: {
    backgroundColor: colors.wash,
    borderColor: colors.divider,
  },
  doneTitle: {
    ...type.heading,
    color: colors.correct,
  },
  doneTitleOut: {
    color: colors.danger,
  },
  doneBody: {
    ...type.sub,
    color: colors.textSecondary,
  },
});
