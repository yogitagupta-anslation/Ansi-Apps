/**
 * AvatarPicker — the missing half of the avatar system.
 *
 * Four kinds have been renderable since the beginning, but nothing could ever
 * *set* them: `photo` in particular was unreachable dead code. This is the UI
 * that closes that, and it matters more than it looks — an avatar is the only
 * thing about you that is legible at 40 px on a crowded map, long before your
 * name is.
 *
 * Photos are cropped square and downscaled to 512 px before they are stored.
 * A modern phone camera produces a 4 MB image; keeping that in a local
 * key-value store, and eventually shipping it to every attendee's directory,
 * would be indefensible for something rendered smaller than a thumbnail.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import type { Avatar as AvatarModel, AvatarKind } from '../types';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { AppText, Button } from './primitives';
import { haptics } from '../runtime/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

/** Kept small and human. A grid of 200 emoji is a worse experience than 24. */
const EMOJI_CHOICES = [
  '👋', '😀', '😎', '🤓', '🧑‍💻', '👩‍💻', '🧑‍🚀', '🦊',
  '🐙', '🐝', '🦉', '🐳', '🌱', '🌸', '🍀', '⚡️',
  '🔥', '✨', '🚀', '🛠️', '🎧', '📚', '☕️', '🎯',
];

/** Twelve stops around the wheel — enough variety, few enough to scan. */
const HUES = Array.from({ length: 12 }, (_, index) => index * 30);

const KIND_LABELS: { value: AvatarKind; label: string }[] = [
  { value: 'initials', label: 'Initials' },
  { value: 'generated', label: 'Pattern' },
  { value: 'emoji', label: 'Emoji' },
  { value: 'photo', label: 'Photo' },
];

export const MAX_AVATAR_PIXELS = 512;

export function AvatarPicker({
  visible,
  avatar,
  name,
  onClose,
  onChange,
}: {
  visible: boolean;
  avatar: AvatarModel;
  name: string;
  onClose: () => void;
  onChange: (avatar: AvatarModel) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<AvatarModel>(avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setDraft(avatar);
      setError(null);
    }
  }, [visible, avatar]);

  const patch = (next: Partial<AvatarModel>): void => {
    haptics.select();
    setDraft((current) => ({ ...current, ...next }));
  };

  const pickPhoto = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo access is needed to choose a picture. You can enable it in Settings.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;

      // Downscale before it ever touches storage — see the note at the top.
      // The contextual API: build the transform, render it, then save. The older
      // one-shot `manipulateAsync` still exists but is deprecated.
      const context = ImageManipulator.ImageManipulator.manipulate(result.assets[0].uri);
      context.resize({ width: MAX_AVATAR_PIXELS, height: MAX_AVATAR_PIXELS });
      const rendered = await context.renderAsync();
      const processed = await rendered.saveAsync({
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      haptics.success();
      setDraft((current) => ({ ...current, kind: 'photo', uri: processed.uri }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title="Your avatar"
      subtitle="How you appear on the map"
      onClose={onClose}
      footer={
        <>
          <Button label="Cancel" variant="secondary" onPress={onClose} full />
          <Button
            label="Use this"
            onPress={() => {
              haptics.success();
              onChange(draft);
              onClose();
            }}
            full
          />
        </>
      }
    >
      <View style={styles.preview}>
        {/* Shown at map size beside the large one: the small version is the one
            that actually has to work, and it is easy to pick something that
            only reads at 96 px. */}
        <Avatar avatar={draft} name={name} size="hero" availability="available" />
        <View style={styles.previewSmall}>
          <Avatar avatar={draft} name={name} size="map" availability="available" />
          <AppText variant="micro" tone="tertiary">
            ON THE MAP
          </AppText>
        </View>
      </View>

      <View style={styles.chips}>
        {KIND_LABELS.map((option) => {
          const selected = draft.kind === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                if (option.value === 'photo') {
                  void pickPhoto();
                  return;
                }
                // Switching to Emoji with nothing chosen would fall back to
                // initials and look like the tap did nothing, so seed one.
                patch(
                  option.value === 'emoji' && !draft.emoji
                    ? { kind: 'emoji', emoji: EMOJI_CHOICES[0] }
                    : { kind: option.value },
                );
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.kindChip,
                {
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accentSoft : 'transparent',
                },
              ]}
            >
              <AppText variant="caption" tone={selected ? 'accent' : 'secondary'}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {busy ? (
        <AppText variant="caption" tone="tertiary">
          Preparing your photo…
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}

      {draft.kind === 'emoji' ? (
        <View style={styles.emojiGrid}>
          {EMOJI_CHOICES.map((emoji) => {
            const selected = draft.emoji === emoji;
            return (
              <Pressable
                key={emoji}
                onPress={() => patch({ emoji })}
                accessibilityRole="button"
                accessibilityLabel={`Use ${emoji}`}
                style={[
                  styles.emojiCell,
                  {
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSoft : colors.surfaceSunken,
                  },
                ]}
              >
                <AppText variant="title">{emoji}</AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {draft.kind !== 'photo' ? (
        <>
          <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
            COLOUR
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hueRow}>
            {HUES.map((hue) => {
              const selected = Math.abs(draft.hue - hue) < 15;
              return (
                <Pressable
                  key={hue}
                  onPress={() => patch({ hue })}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${hue} degrees`}
                  style={[
                    styles.hueDot,
                    {
                      backgroundColor: `hsl(${hue}, 60%, 55%)`,
                      borderColor: selected ? colors.textPrimary : 'transparent',
                    },
                  ]}
                />
              );
            })}
          </ScrollView>
        </>
      ) : null}

      {draft.kind === 'generated' ? (
        <AppText variant="caption" tone="tertiary">
          The pattern is derived from your name, so it stays the same every time anyone sees you.
        </AppText>
      ) : null}

      {draft.kind === 'photo' && draft.uri ? (
        <Button label="Choose a different photo" variant="secondary" onPress={() => void pickPhoto()} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.xl, paddingVertical: space.md },
  previewSmall: { alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kindChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm },
  emojiCell: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { letterSpacing: 0.8, paddingTop: space.md },
  hueRow: { gap: space.sm, paddingVertical: space.xs },
  hueDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2 },
});
