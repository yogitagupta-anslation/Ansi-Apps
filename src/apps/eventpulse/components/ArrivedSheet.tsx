/**
 * ArrivedSheet + SaveWithNoteSheet — screens 4.2 and 4.3 of the flow.
 *
 * These two cover the part the flow document singles out as the one every
 * networking app skips: *crossing the room, and the first sentence.* Getting
 * someone to within arm's reach of a stranger and then showing them a profile
 * is an anticlimax — they already know who the person is. What they need is a
 * line they can say, and afterwards, somewhere to put what was said.
 *
 * Two details that are easy to get wrong and matter a lot:
 *
 *  - **Nothing is sent.** Walking to someone tells them nothing; the sheet says
 *    so out loud, because a user who suspects the other phone buzzed will not
 *    use the feature twice.
 *  - **The note is written now.** Not later, from a list of names. That is the
 *    whole reason this appears at the end of a conversation rather than living
 *    only in the Network tab.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { ConversationStarter } from '../recommendations/ConversationStarter';
import { SAVED_TAGS, type SavedTag } from '../connections/SavedPeopleService';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { AppText, Button } from './primitives';
import { haptics } from '../runtime/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, typography } from '../theme/tokens';
import type { Avatar as AvatarModel } from '../types';

/* ------------------------------------------------------------------ *
 * 4.2 Arrived — the first line
 * ------------------------------------------------------------------ */

export function ArrivedSheet({
  visible,
  name,
  subtitle,
  avatar,
  starters,
  context,
  onSaveWithNote,
  onClose,
}: {
  visible: boolean;
  name: string;
  subtitle?: string;
  avatar?: AvatarModel | null;
  /** One or more openers; the user can cycle if the first does not suit them. */
  starters: ConversationStarter[];
  /** "She is looking to meet engineers · 6 years at Google" */
  context?: string | null;
  onSaveWithNote: () => void;
  onClose: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  const starter = starters.length ? starters[index % starters.length] : null;

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPercent={80}>
      <View style={styles.arrivedHead}>
        <Avatar avatar={avatar} name={name} size="hero" availability="available" />
        <AppText variant="eyebrow" tone="accent" style={styles.centered}>
          WITHIN ARM&apos;S REACH
        </AppText>
        <AppText variant="display" style={styles.centered}>
          {`You've found ${firstName(name)}`}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="secondary" style={styles.centered}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {starter ? (
        <View style={[styles.sayThis, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
          <AppText variant="eyebrow" tone="accent">
            SAY THIS
          </AppText>
          <AppText variant="heading" style={styles.line}>
            {starter.question}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {starter.basis}
          </AppText>

          {starters.length > 1 ? (
            <Pressable
              onPress={() => {
                haptics.select();
                setIndex((current) => current + 1);
              }}
              accessibilityRole="button"
              style={[styles.shuffle, { borderColor: colors.border }]}
            >
              <AppText variant="caption" tone="secondary">
                ⇄  Another opener
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {context ? (
        <View style={styles.contextRow}>
          <AppText variant="caption" tone="secondary">
            {`👤  ${context}`}
          </AppText>
        </View>
      ) : null}

      {/* The reassurance is the feature. Without it, "walk me there" reads as
          something that pinged the other person, and people stop using it. */}
      <View style={[styles.privacyNote, { borderColor: colors.border }]}>
        <AppText variant="caption" tone="tertiary">
          {`🔒  ${firstName(name)} was never told you walked over. Nothing was sent.`}
        </AppText>
      </View>

      <View style={styles.arrivedActions}>
        <Button label="Back to the map" variant="secondary" onPress={onClose} full />
        <Button
          label="Save with a note"
          onPress={() => {
            haptics.success();
            onSaveWithNote();
          }}
          full
        />
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * 4.3 Save with a note
 * ------------------------------------------------------------------ */

export function SaveWithNoteSheet({
  visible,
  name,
  avatar,
  eventName,
  zoneName,
  initialNote,
  initialTags,
  canConnect,
  onClose,
  onSave,
}: {
  visible: boolean;
  name: string;
  avatar?: AvatarModel | null;
  eventName: string;
  /** Where the user said they were standing; never inferred. */
  zoneName?: string | null;
  initialNote?: string;
  initialTags?: SavedTag[];
  canConnect: boolean;
  onClose: () => void;
  onSave: (input: { note: string; tags: SavedTag[]; connect: boolean }) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [note, setNote] = useState(initialNote ?? '');
  const [tags, setTags] = useState<SavedTag[]>(initialTags ?? []);
  const [connect, setConnect] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setNote(initialNote ?? '');
    setTags(initialTags ?? []);
    setConnect(false);
  }, [visible, initialNote, initialTags]);

  // Captured once when the sheet opens: the time you met, not the time you
  // finished typing.
  const metAt = useMemo(
    () => (visible ? new Date() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  const stamp = [eventName, zoneName, metAt ? formatTime(metAt) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      maxHeightPercent={88}
      footer={
        <>
          <Button label="Cancel" variant="secondary" onPress={onClose} full />
          <Button
            label="Save to my network"
            onPress={() => {
              haptics.success();
              onSave({ note: note.trim(), tags, connect });
              onClose();
            }}
            full
          />
        </>
      }
    >
      <View style={styles.saveHead}>
        <Avatar avatar={avatar} name={name} size="large" />
        <View style={styles.saveHeadText}>
          <AppText variant="title">{`Save ${name}`}</AppText>
          <AppText variant="eyebrow" tone="tertiary">
            {`MET AT ${stamp.toUpperCase()}`}
          </AppText>
        </View>
      </View>

      <AppText variant="eyebrow" tone="tertiary" style={styles.sectionLabel}>
        WHAT YOU TALKED ABOUT
      </AppText>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="LLM eval harnesses. She'll introduce me to the PM on their agents team."
        placeholderTextColor={colors.textTertiary}
        multiline
        style={[
          styles.noteInput,
          typography.body,
          {
            backgroundColor: colors.surfaceSunken,
            borderColor: colors.border,
            color: colors.textPrimary,
          },
        ]}
        accessibilityLabel="What you talked about"
      />
      <AppText variant="caption" tone="tertiary">
        Written now, while you remember it. Notes never leave your phone.
      </AppText>

      <View style={styles.tagRow}>
        {SAVED_TAGS.map((tag) => {
          const selected = tags.includes(tag.value);
          return (
            <Pressable
              key={tag.value}
              onPress={() => {
                haptics.select();
                setTags((current) =>
                  current.includes(tag.value)
                    ? current.filter((value) => value !== tag.value)
                    : [...current, tag.value],
                );
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              style={[
                styles.tag,
                {
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accentSoft : 'transparent',
                },
              ]}
            >
              <AppText variant="caption" tone={selected ? 'accent' : 'secondary'}>
                {tag.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* A connect request is the one thing here that reaches the other person,
          so it is opt-in and sits apart from the private half of the sheet. */}
      {canConnect ? (
        <Pressable
          onPress={() => {
            haptics.select();
            setConnect((value) => !value);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: connect }}
          style={[
            styles.connectRow,
            { borderColor: connect ? colors.accent : colors.border },
          ]}
        >
          <View
            style={[
              styles.check,
              {
                borderColor: connect ? colors.accent : colors.borderStrong,
                backgroundColor: connect ? colors.accent : 'transparent',
              },
            ]}
          >
            {connect ? (
              <AppText variant="micro" tone="inverse">
                ✓
              </AppText>
            ) : null}
          </View>
          <AppText variant="body" tone={connect ? 'accent' : 'primary'}>
            {`Also send ${firstName(name)} a connect request`}
          </AppText>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function formatTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  centered: { textAlign: 'center' },
  arrivedHead: { alignItems: 'center', gap: space.sm, paddingBottom: space.md },
  sayThis: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  line: { lineHeight: 26 },
  shuffle: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    marginTop: space.xs,
  },
  contextRow: { paddingTop: space.md },
  privacyNote: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
  },
  arrivedActions: { flexDirection: 'row', gap: space.sm, paddingTop: space.lg },

  saveHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.md },
  saveHeadText: { flex: 1, gap: 4 },
  sectionLabel: { paddingTop: space.sm },
  noteInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    textAlignVertical: 'top',
    marginTop: space.xs,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.md },
  tag: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  connectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.lg,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
