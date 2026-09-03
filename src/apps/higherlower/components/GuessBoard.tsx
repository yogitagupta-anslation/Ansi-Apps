import React, { useMemo, useState } from 'react';
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
import { Palette, fonts, radius, spacing, verdictColor } from '../theme/tokens';
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

      <View style={styles.stage}>
        <BigNumber
          value={entry}
          placeholder={'–'.repeat(Math.min(2, maxDigits))}
          tone={lastVerdict && entry.length === 0 ? verdictColor(lastVerdict, colors) : colors.textPrimary}
        />
        <FeedbackBanner verdict={lastVerdict} nonce={verdictNonce} />
        {lastGuess ? <GuessImpact guess={lastGuess} before={before} hideCounts={rules.hideRange} /> : null}
        <Text style={[styles.hint, !canSubmit && entry.length > 0 && !finished && styles.hintWarn]}>{hint}</Text>
      </View>

      <View style={styles.trail}>
        <View style={styles.trailHeader}>
          <Text style={styles.trailLabel}>YOUR GUESSES</Text>
          <Text style={[styles.trailMeta, left !== null && left <= 2 && styles.trailMetaWarn]}>
            {left !== null
              ? `${guesses.length} of ${rules.guessLimit} used`
              : rules.hideRange
                ? `${guesses.length} of ${par} par`
                : `${guesses.length} of ${par} par · ${rangeSize(known).toLocaleString('en-US')} left`}
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

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    flex: 1,
    gap: spacing.sm + 4,
  },
  lanes: {
    gap: spacing.sm,
  },
  dropped: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.higherGlow,
    borderWidth: 1,
    borderColor: colors.higher,
  },
  droppedText: {
    color: colors.higher,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  quip: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'right',
    marginTop: -6,
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
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
  },
  stage: {
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
  },
  hintWarn: {
    color: colors.higher,
  },
  trail: {
    gap: 4,
  },
  trailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trailLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
  },
  trailMeta: {
    color: colors.textMuted,
    fontSize: 10,
  },
  trailMetaWarn: {
    color: colors.higher,
    fontWeight: '700',
  },
  wager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
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
    fontSize: 15,
  },
  wagerText: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  wagerTextOn: {
    color: colors.gold,
    fontWeight: '700',
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
    ...fonts.label,
    color: colors.correct,
    fontSize: 14,
  },
  doneTitleOut: {
    color: colors.danger,
  },
  doneBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});
