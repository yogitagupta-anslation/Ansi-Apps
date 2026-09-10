import React from 'react';
import {Image, Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {CHAT_WALLPAPERS, type ChatWallpaper} from '../config/wallpapers';

/**
 * Choosing a background for one conversation.
 *
 * Each swatch is the wallpaper with two real bubbles drawn on it, in the colours that
 * wallpaper will actually use — not a crop of the photo. What somebody is choosing is not
 * a picture, it is what the conversation will look like, and those are different things:
 * a photo that looks best in a grid is frequently the one that reads worst under text.
 *
 * The palettes are derived from the images themselves and checked against WCAG AA at the
 * worst patch of each — see config/wallpapers.ts. So the preview cannot flatter a
 * wallpaper that would be unreadable, because there is no unreadable wallpaper to flatter.
 */
export function WallpaperSheet({
  visible,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** Wallpaper id in use for this conversation, or null for the plain background. */
  current: string | null;
  onClose: () => void;
  onPick: (id: string | null) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} accessibilityLabel="Close" />

        <View style={[styles.sheet, {paddingBottom: insets.bottom + spacing.lg}]}>
          <View style={styles.grip} />
          <AppText style={styles.title}>Wallpaper</AppText>
          <DenseText style={styles.subtitle}>
            Just this chat. Message colours follow whatever you pick.
          </DenseText>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}>
            {/* "None" first and always available: the plain theme background is a real
                choice, and it is the one somebody comes back to. */}
            <Touchable
              scale={false}
              onPress={() => onPick(null)}
              style={styles.item}
              accessibilityRole="button"
              accessibilityState={{selected: current === null}}
              accessibilityLabel="No wallpaper">
              <View style={[styles.swatch, styles.swatchPlain]}>
                <View style={[styles.previewIn, {backgroundColor: theme.bubbleIn}]} />
                <View style={[styles.previewOut, {backgroundColor: theme.accent}]} />
                {current === null ? <Tick /> : null}
              </View>
              <DenseText style={styles.name}>None</DenseText>
            </Touchable>

            {CHAT_WALLPAPERS.map(paper => (
              <Swatch
                key={paper.id}
                paper={paper}
                selected={current === paper.id}
                onPress={() => onPick(paper.id)}
              />
            ))}
          </ScrollView>

          <DenseText style={styles.credit}>
            Placeholder images from Lorem Picsum, pending the branding set.
          </DenseText>
        </View>
      </View>
    </Modal>
  );
}

function Swatch({
  paper,
  selected,
  onPress,
}: {
  paper: ChatWallpaper;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Touchable
      scale={false}
      onPress={onPress}
      style={styles.item}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={paper.name}>
      <View style={styles.swatch}>
        <Image source={paper.source} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {/* The same scrim the conversation gets, so the preview is the thing itself. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {backgroundColor: paper.scrim, opacity: paper.scrimOpacity},
          ]}
        />
        <View style={[styles.previewIn, {backgroundColor: paper.bubbleIn}]} />
        <View style={[styles.previewOut, {backgroundColor: paper.bubbleOut}]} />
        {selected ? <Tick /> : null}
      </View>
      <DenseText style={styles.name}>{paper.name}</DenseText>
    </Touchable>
  );
}

function Tick() {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.tick}>
      <Icon name="check" color={theme.onAccent} size={13} strokeWidth={3} />
    </View>
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
    paddingTop: 10,
  },
  grip: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: t.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: '500',
    letterSpacing: -0.3,
    color: t.text,
    paddingHorizontal: 20,
  },
  subtitle: {
    ...typography.caption,
    color: t.textDim,
    paddingHorizontal: 20,
    marginTop: 3,
  },
  row: {flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16},
  item: {alignItems: 'center', gap: 6},
  // Portrait, because a chat is portrait — a square crop of a wallpaper tells you very
  // little about how it will sit behind a column of bubbles.
  swatch: {
    width: 84,
    height: 148,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: t.surfaceAlt,
    justifyContent: 'flex-end',
    padding: 8,
    gap: 6,
  },
  swatchPlain: {borderWidth: 1, borderColor: t.border, backgroundColor: t.bg},
  previewIn: {height: 16, width: '72%', borderRadius: 8, alignSelf: 'flex-start'},
  previewOut: {height: 16, width: '62%', borderRadius: 8, alignSelf: 'flex-end'},
  tick: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {...typography.caption, fontSize: 11.5, color: t.textDim},
  credit: {
    ...typography.caption,
    fontSize: 11,
    color: t.textFaint,
    paddingHorizontal: 20,
  },
}));
