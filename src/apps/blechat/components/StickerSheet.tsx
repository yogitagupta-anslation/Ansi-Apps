import React from 'react';
import {Image, Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {makeStyles} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {STICKERS, STICKER_CREDIT, type Sticker} from '../config/stickers';

/**
 * The sticker tray.
 *
 * A flat grid of ten and nothing else — no tabs, no search, no recents. Ten is small
 * enough to recognise at a glance, and every piece of chrome added around a picker this
 * size costs more taps than it saves. When the branding team's set arrives and it is
 * fifty, this grows a scroll and keeps the same shape.
 *
 * One tap sends. There is no "select, then confirm": a sticker is a low-stakes message
 * and making it a two-step action is the surest way to have nobody use it.
 */
export function StickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (sticker: Sticker) => void;
}) {
  const styles = useStyles();
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
          <AppText style={styles.title}>Stickers</AppText>

          <View style={styles.grid}>
            {STICKERS.map(sticker => (
              <Touchable
                key={sticker.id}
                scale
                onPress={() => onPick(sticker)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityLabel={`Send ${sticker.label}`}>
                <Image source={sticker.source} style={styles.art} resizeMode="contain" />
              </Touchable>
            ))}
          </View>

          {/* The licence requires attribution, and it is also the note that tells anyone
              reading this screen that the art is a placeholder. */}
          <DenseText style={styles.credit}>{STICKER_CREDIT}</DenseText>
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
    paddingHorizontal: 18,
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
  title: {fontSize: 17, fontWeight: '500', letterSpacing: -0.3, color: t.text},
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 8,
    marginTop: 14,
  },
  // Five across on any phone this app supports, sized by the sheet rather than by a
  // fixed width so the grid does not tear at 320pt.
  cell: {
    width: '18.4%',
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {width: '72%', height: '72%'},
  credit: {...typography.caption, fontSize: 11, color: t.textFaint, marginTop: 16},
}));
