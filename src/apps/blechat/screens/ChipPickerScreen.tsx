import React, {useMemo, useState} from 'react';
import {Alert, ScrollView, TextInput, View} from 'react-native';

import {AppText, DenseText} from '../components/AppText';
import {Touchable} from '../components/Motion';
import {Icon} from '../components/ui/Icon';
import {Screen} from '../components/ui/Screen';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {ALL_INTERESTS, MAX_INTERESTS} from '../config/interests';
import {LANGUAGE_CATALOGUE, MAX_LANGUAGES} from '../config/languages';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';
import type {RootStackScreenProps} from '../navigation/types';

/**
 * One picker, two lists.
 *
 * Interests and languages are the same interaction — search a catalogue, tap to choose,
 * add your own, save — and differ only in what they are for and how many you may pick.
 * Building them twice would have been two screens to keep in step.
 *
 * The "nearby" section at the top is the reason this is not just an alphabetical list:
 * what other people in range have chosen is the most useful ordering there is when the
 * point of the field is to have something in common with them.
 */
type Kind = 'interests' | 'languages';

export function ChipPickerScreen({
  route,
  navigation,
}: RootStackScreenProps<'InterestPicker'> | RootStackScreenProps<'LanguagePicker'>) {
  const kind: Kind = route.name === 'LanguagePicker' ? 'languages' : 'interests';
  const styles = useStyles();
  const theme = useTheme();

  const settings = useAppStore(s => s.settings);
  const peers = useAppStore(s => s.peers);

  const catalogue = kind === 'languages' ? LANGUAGE_CATALOGUE : ALL_INTERESTS;
  const max = kind === 'languages' ? MAX_LANGUAGES : MAX_INTERESTS;
  const title = kind === 'languages' ? 'Languages I speak' : 'My interests';

  const [chosen, setChosen] = useState<string[]>(
    kind === 'languages' ? settings.languages ?? [] : settings.interests ?? [],
  );
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);

  /**
   * How many people in range have each one.
   *
   * Counted from peers we have actually handshaken with, so it is a real tally rather
   * than a guess — and it is only shown for entries somebody nearby genuinely has.
   */
  const nearbyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const peer of peers) {
      const theirs = kind === 'languages' ? peer.languages : peer.interests;
      for (const entry of theirs ?? []) {
        const key = entry.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [peers, kind]);

  const matches = (entry: string) =>
    query.trim().length === 0 || entry.toLowerCase().includes(query.trim().toLowerCase());

  const nearby = catalogue
    .filter(e => nearbyCounts.has(e.toLowerCase()) && !chosen.includes(e) && matches(e))
    .sort((a, b) => (nearbyCounts.get(b.toLowerCase()) ?? 0) - (nearbyCounts.get(a.toLowerCase()) ?? 0));

  const rest = catalogue.filter(
    e => !chosen.includes(e) && !nearby.includes(e) && matches(e),
  );

  const toggle = (entry: string) => {
    setChosen(current => {
      if (current.includes(entry)) {
        return current.filter(e => e !== entry);
      }
      if (current.length >= max) {
        Alert.alert(
          `That is the limit`,
          `You can pick up to ${max}. Remove one first — the list travels with every handshake, so it is kept short on purpose.`,
        );
        return current;
      }
      return [...current, entry];
    });
  };

  const addCustom = () => {
    const trimmed = custom.trim();
    if (!trimmed) {
      return;
    }
    if (!chosen.some(e => e.toLowerCase() === trimmed.toLowerCase())) {
      toggle(trimmed);
    }
    setCustom('');
    setAddingCustom(false);
  };

  const save = () => {
    const patch = kind === 'languages' ? {languages: chosen} : {interests: chosen};
    bleChat
      .updateSettings(patch)
      .then(() => navigation.goBack())
      .catch(err => Alert.alert('Could not save', err instanceof Error ? err.message : String(err)));
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Touchable
          scale={false}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevronLeft" size={20} color={theme.text} />
        </Touchable>
        <AppText style={styles.title}>{title}</AppText>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={15} color={theme.textFaint} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={kind === 'languages' ? 'Search languages' : 'Search interests'}
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
          maxFontSizeMultiplier={1.4}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {chosen.length > 0 ? (
          <View style={styles.chipWrap}>
            {chosen.map(entry => (
              <Chip key={entry} label={entry} selected onPress={() => toggle(entry)} />
            ))}
          </View>
        ) : null}

        {nearby.length > 0 ? (
          <>
            <DenseText style={styles.sectionLabel}>
              {kind === 'languages' ? 'SPOKEN NEARBY' : 'POPULAR NEARBY'}
            </DenseText>
            <View style={styles.chipWrap}>
              {nearby.map(entry => (
                <Chip
                  key={entry}
                  label={entry}
                  count={nearbyCounts.get(entry.toLowerCase())}
                  onPress={() => toggle(entry)}
                />
              ))}
            </View>
          </>
        ) : null}

        <View style={[styles.chipWrap, styles.restWrap]}>
          {rest.map(entry => (
            <Chip key={entry} label={entry} onPress={() => toggle(entry)} />
          ))}

          {addingCustom ? (
            <View style={styles.customWrap}>
              <TextInput
                style={styles.customInput}
                value={custom}
                onChangeText={setCustom}
                placeholder="Type it"
                placeholderTextColor={theme.textFaint}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={addCustom}
                onBlur={addCustom}
                maxFontSizeMultiplier={1.2}
              />
            </View>
          ) : (
            <Touchable
              scale={false}
              onPress={() => setAddingCustom(true)}
              style={styles.addOwn}
              accessibilityRole="button"
              accessibilityLabel="Add your own">
              <Icon name="plus" size={12} color={theme.textDim} strokeWidth={2} />
              <DenseText style={styles.addOwnText}>Add your own</DenseText>
            </Touchable>
          )}
        </View>

        <View style={styles.note}>
          <Icon name="info" size={13} color={theme.textDim} strokeWidth={2} />
          <DenseText style={styles.noteText}>
            {chosen.length} of {max} ·{' '}
            {kind === 'languages'
              ? 'sent during the handshake, not in the advertisement — so pick as many as you like'
              : 'sent to phones you connect to'}
          </DenseText>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Touchable
          scale={false}
          onPress={save}
          style={styles.save}
          accessibilityRole="button"
          accessibilityLabel="Save">
          <DenseText style={styles.saveText}>Save</DenseText>
        </Touchable>
      </View>
    </Screen>
  );
}

function Chip({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count?: number;
  selected?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <Touchable
      scale={false}
      onPress={onPress}
      style={selected ? [styles.chip, styles.chipOn] : styles.chip}
      accessibilityRole="button"
      accessibilityState={{selected: !!selected}}
      accessibilityLabel={count ? `${label}, ${count} nearby` : label}>
      {selected ? <Icon name="check" size={11} color={theme.onAccent} strokeWidth={2.6} /> : null}
      <DenseText style={selected ? styles.chipTextOn : styles.chipText} maxFontSizeMultiplier={1}>
        {label}
      </DenseText>
      {count ? <DenseText style={styles.chipCount}>{count}</DenseText> : null}
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  head: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10},
  back: {padding: 4},
  title: {fontSize: 28, fontWeight: '600', letterSpacing: -1, color: t.text, flex: 1},

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 16,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: t.surfaceAlt,
  },
  search: {flex: 1, fontSize: 13.5, color: t.text, padding: 0, includeFontPadding: false},

  content: {paddingHorizontal: 18, paddingTop: 16, paddingBottom: spacing.xl},
  sectionLabel: {...typography.overline, color: t.textDim, marginTop: 18, marginBottom: 9},
  chipWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  restWrap: {marginTop: 16},

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
    flexShrink: 0,
  },
  chipOn: {backgroundColor: t.accent, borderColor: t.accent},
  chipText: {fontSize: 12.5, color: t.text},
  chipTextOn: {fontSize: 12.5, color: t.onAccent, fontWeight: '500'},
  chipCount: {fontSize: 11, color: t.textFaint},

  addOwn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  addOwnText: {fontSize: 12.5, color: t.textDim},
  customWrap: {
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 13,
    minWidth: 120,
  },
  customInput: {fontSize: 12.5, color: t.text, padding: 0, includeFontPadding: false},

  note: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 22},
  noteText: {...typography.caption, color: t.textDim, flex: 1},

  footer: {paddingHorizontal: 18, paddingBottom: spacing.lg, paddingTop: spacing.sm},
  save: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {fontSize: 15, fontWeight: '500', color: t.onAccent},
}));
