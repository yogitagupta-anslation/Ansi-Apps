import React, {useCallback, useState} from 'react';
import {TextInput, TouchableOpacity, View} from 'react-native';
import {radius, spacing} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from './AppText';
import {
  INTEREST_CATALOGUE,
  MAX_INTERESTS,
  MAX_INTEREST_LENGTH,
  sanitiseInterests,
} from '../config/interests';

interface Props {
  selected: string[];
  onChange: (interests: string[]) => void;
}

/**
 * Pick interests from the catalogue, or add your own.
 *
 * The catalogue is not decoration: two people only discover common ground if they wrote
 * the same word, and left to themselves they write "football", "Football" and "footy".
 * Tapping a chip guarantees an exact match with everyone else who tapped it. The custom
 * field covers the rest, at the cost of matching only people who typed it identically.
 */
export function InterestPicker({selected, onChange}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const [custom, setCustom] = useState('');

  const full = selected.length >= MAX_INTERESTS;

  const toggle = useCallback(
    (interest: string) => {
      const already = selected.some(
        i => i.toLowerCase() === interest.toLowerCase(),
      );
      if (already) {
        onChange(
          selected.filter(i => i.toLowerCase() !== interest.toLowerCase()),
        );
        return;
      }
      if (selected.length >= MAX_INTERESTS) {
        return;
      }
      onChange(sanitiseInterests([...selected, interest]));
    },
    [selected, onChange],
  );

  const addCustom = useCallback(() => {
    const next = sanitiseInterests([...selected, custom]);
    // sanitiseInterests drops blanks and duplicates, so an unchanged length means the
    // entry added nothing — clear the field either way rather than leaving it stuck.
    onChange(next);
    setCustom('');
  }, [custom, selected, onChange]);

  /** Anything the user typed that is not in the catalogue, so it can still be removed. */
  const catalogue = new Set(
    INTEREST_CATALOGUE.flatMap(c => c.interests).map(i => i.toLowerCase()),
  );
  const customPicks = selected.filter(i => !catalogue.has(i.toLowerCase()));

  return (
    <View>
      <View style={styles.counterRow}>
        <DenseText style={styles.counter}>
          {selected.length} of {MAX_INTERESTS} chosen
        </DenseText>
        {full && (
          <DenseText style={styles.counterFull}>
            Remove one to add another
          </DenseText>
        )}
      </View>

      {INTEREST_CATALOGUE.map(category => (
        <View key={category.title} style={styles.category}>
          <DenseText style={styles.categoryTitle}>{category.title}</DenseText>
          <View style={styles.chipWrap}>
            {category.interests.map(interest => {
              const on = selected.some(
                i => i.toLowerCase() === interest.toLowerCase(),
              );
              return (
                <TouchableOpacity
                  key={interest}
                  onPress={() => toggle(interest)}
                  // Greyed rather than hidden once full: the list must not reshuffle
                  // under the user's finger just because they picked their last one.
                  style={[
                    styles.chip,
                    on && styles.chipOn,
                    !on && full && styles.chipDisabled,
                  ]}
                  disabled={!on && full}>
                  {/* maxFontSizeMultiplier=1: a short badge label like this has no slack
                      between the text's un-scaled auto-measured width and the pill's
                      rounded edge — any accessibility scaling here is exactly what clips
                      a trailing character with no ellipsis. */}
                  <AppText
                    style={[styles.chipText, on && styles.chipTextOn]}
                    maxFontSizeMultiplier={1}>
                    {interest}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {customPicks.length > 0 && (
        <View style={styles.category}>
          <DenseText style={styles.categoryTitle}>Your own</DenseText>
          <View style={styles.chipWrap}>
            {customPicks.map(interest => (
              <TouchableOpacity
                key={interest}
                onPress={() => toggle(interest)}
                style={[styles.chip, styles.chipOn]}>
                <AppText
                  style={[styles.chipText, styles.chipTextOn]}
                  maxFontSizeMultiplier={1}>
                  {interest}  ×
                </AppText>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={styles.customRow}>
        <TextInput
          style={styles.customInput}
          value={custom}
          onChangeText={setCustom}
          placeholder="Something else"
          placeholderTextColor={theme.textDim}
          maxLength={MAX_INTEREST_LENGTH}
          returnKeyType="done"
          onSubmitEditing={addCustom}
          editable={!full}
          maxFontSizeMultiplier={1.3}
        />
        <TouchableOpacity
          onPress={addCustom}
          disabled={full || custom.trim().length === 0}
          style={[
            styles.addButton,
            (full || custom.trim().length === 0) && styles.addButtonOff,
          ]}>
          <AppText style={styles.addButtonText}>Add</AppText>
        </TouchableOpacity>
      </View>

      <DenseText style={styles.hint}>
        Interests are sent to every phone you connect to, so keep them to things you are
        happy for a stranger in the room to read.
      </DenseText>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  counter: {color: t.textDim, fontSize: 12},
  counterFull: {color: t.warn, fontSize: 11, flexShrink: 1, textAlign: 'right'},

  category: {marginBottom: spacing.md},
  categoryTitle: {
    color: t.textDim,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  chipWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  // flexShrink: 0 — this sits in a flexWrap row; without it, a flex layout is allowed to
  // squeeze a chip narrower than its text needs before it wraps to the next line, which
  // can clip the last character or two with no ellipsis to show for it.
  chip: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    flexShrink: 0,
  },
  chipOn: {backgroundColor: t.accent, borderColor: t.accent},
  chipDisabled: {opacity: 0.4},
  chipText: {color: t.text, fontSize: 13},
  chipTextOn: {color: t.onAccent, fontWeight: '600'},

  customRow: {flexDirection: 'row', gap: spacing.sm, alignItems: 'center'},
  customInput: {
    flex: 1,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: t.text,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: t.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  addButtonOff: {backgroundColor: t.surfaceAlt},
  addButtonText: {color: t.onAccent, fontSize: 14, fontWeight: '700'},

  hint: {color: t.textDim, fontSize: 11, marginTop: spacing.md, lineHeight: 15},
}));
