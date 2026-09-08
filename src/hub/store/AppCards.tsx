/**
 * The app listing family: one app drawn at four sizes.
 *
 * ON THE METADATA SLOT. The approved design puts a star and a rating in the meta
 * row of the rail card, the list row and the featured card. Nobody has rated these
 * apps, so a number there would be a decoration shaped like a measurement. The
 * slot, its position and its type treatment are kept exactly as designed and
 * filled with the figures that are real: how many times this device has opened the
 * app, and when it last did. An app that has never been opened simply shows fewer
 * items in the row rather than a zero.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Press } from '../components/Press';
import { formatLastOpened, formatOpenCount, type UsageRecord } from '../recents';
import { primaryCategory, type HubApp } from '../registry';
import { radius, space, type, type HubPalette } from '../theme';
import { IconTile, Mono, MetaDot } from './primitives';

export const CARD_WIDTH = { recents: 134, rail: 170, related: 150 };

interface CardProps {
  app: HubApp;
  theme: HubPalette;
  usage?: UsageRecord;
  onPress(): void;
}

/* ------------------------------------------------------- recents card -- */

/** The compact card in the Recently opened rail. Its meta line is the real age. */
export function RecentCard({ app, theme, usage, onPress }: CardProps): React.ReactElement {
  const ago = formatLastOpened(usage);
  return (
    <Press
      onPress={onPress}
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}${ago ? `, last opened ${ago}` : ''}`}
      style={[
        styles.recentCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <IconTile glyph={app.icon} tint={app.accentSoft} size={46} />
      <View>
        <Text style={[styles.recentName, { color: theme.text }]} numberOfLines={1}>
          {app.name}
        </Text>
        {ago ? (
          <View style={{ marginTop: 3 }}>
            <Mono theme={theme} size={10.5} weight="500" underline>
              {ago}
            </Mono>
          </View>
        ) : null}
      </View>
    </Press>
  );
}

/* ---------------------------------------------------------- rail card -- */

/** The wider card used by discovery rails. Carries a category and an Open button. */
export function RailCard({
  app,
  theme,
  usage,
  onPress,
  onOpen,
}: CardProps & { onOpen(): void }): React.ReactElement {
  const opened = formatOpenCount(usage);
  return (
    <Press
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}. ${app.tagline}`}
      style={[styles.railCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <IconTile glyph={app.icon} tint={app.accentSoft} size={58} />
      <View>
        <Text style={[styles.railName, { color: theme.text }]} numberOfLines={1}>
          {app.name}
        </Text>
        <Text style={[styles.railCategory, { color: theme.textDim }]}>{primaryCategory(app)}</Text>
        {opened ? (
          <View style={{ marginTop: space.x7, alignSelf: 'flex-start' }}>
            <Mono theme={theme} size={11.5} weight="500" underline>
              {`Opened ${opened}`}
            </Mono>
          </View>
        ) : null}
      </View>
      <Press
        onPress={onOpen}
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={`Open ${app.name}`}
        style={[styles.outlineButton, { borderColor: theme.borderStrong }]}
      >
        <Text style={[type.chip, { color: theme.text }]}>Open</Text>
      </Press>
    </Press>
  );
}

/* ---------------------------------------------------------- list row -- */

/** The full-width row used by All apps, category listings and search results. */
export function AppListRow({
  app,
  theme,
  usage,
  onPress,
  onOpen,
  note,
}: CardProps & { onOpen(): void; note?: string }): React.ReactElement {
  const opened = formatOpenCount(usage);
  const ago = formatLastOpened(usage);

  return (
    <Press
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}. ${app.tagline}`}
      style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <IconTile glyph={app.icon} tint={app.accentSoft} size={56} />

      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
          {app.name}
        </Text>
        <Text style={[styles.rowTagline, { color: theme.textDim }]} numberOfLines={1}>
          {note ?? app.tagline}
        </Text>

        <View style={styles.metaRow}>
          <Text style={[styles.metaCategory, { color: theme.textDim }]}>
            {primaryCategory(app).toUpperCase()}
          </Text>
          {opened ? (
            <>
              <MetaDot theme={theme} />
              <Mono theme={theme} size={10.5} weight="500" underline>
                {opened}
              </Mono>
            </>
          ) : null}
          {ago ? (
            <>
              <MetaDot theme={theme} />
              <Mono theme={theme} size={10.5} weight="500" underline>
                {ago}
              </Mono>
            </>
          ) : null}
        </View>
      </View>

      <Press
        onPress={onOpen}
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={`Open ${app.name}`}
        style={[styles.rowButton, { borderColor: theme.borderStrong }]}
      >
        <Text style={[type.chip, { color: theme.text }]}>Open</Text>
      </Press>
    </Press>
  );
}

/* ------------------------------------------------------- related card -- */

/** The small card in the detail page's cross-sell rail. */
export function RelatedCard({ app, theme, onPress }: CardProps): React.ReactElement {
  return (
    <Press
      onPress={onPress}
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}. ${app.tagline}`}
      style={[styles.relatedCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <IconTile glyph={app.icon} tint={app.accentSoft} size={50} />
      <View>
        <Text style={[styles.relatedName, { color: theme.text }]} numberOfLines={1}>
          {app.name}
        </Text>
        <Text style={[styles.relatedCategory, { color: theme.textDim }]} numberOfLines={1}>
          {primaryCategory(app)}
        </Text>
      </View>
    </Press>
  );
}

/* ------------------------------------------------------- library row -- */

/**
 * The Library's own row. Flatter than a store listing — these are the user's own
 * apps, so the row is a record rather than a pitch.
 */
export function LibraryRow({
  app,
  theme,
  usage,
  onPress,
  onOpen,
  last,
}: CardProps & { onOpen(): void; last: boolean }): React.ReactElement {
  const opened = formatOpenCount(usage);
  const ago = formatLastOpened(usage);

  return (
    <Press
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}${ago ? `, last opened ${ago}` : ', never opened'}`}
      style={[
        styles.libraryRow,
        !last ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border } : null,
      ]}
    >
      <IconTile glyph={app.icon} tint={app.accentSoft} size={48} />
      <View style={styles.rowText}>
        <Text style={[styles.libraryName, { color: theme.text }]} numberOfLines={1}>
          {app.name}
        </Text>
        <View style={styles.metaRow}>
          {ago ? (
            <Mono theme={theme} size={10.5} weight="500">
              {ago}
            </Mono>
          ) : (
            <Text style={[styles.neverOpened, { color: theme.textFaint }]}>Not opened yet</Text>
          )}
          {opened ? (
            <>
              <MetaDot theme={theme} />
              <Mono theme={theme} size={10.5} weight="500">
                {opened}
              </Mono>
            </>
          ) : null}
        </View>
      </View>
      <Press
        onPress={onOpen}
        scaleTo={0.96}
        accessibilityRole="button"
        accessibilityLabel={`Open ${app.name}`}
        style={[styles.rowButton, { borderColor: theme.borderStrong }]}
      >
        <Text style={[type.chip, { color: theme.text }]}>Open</Text>
      </Press>
    </Press>
  );
}

const styles = StyleSheet.create({
  recentCard: {
    width: CARD_WIDTH.recents,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.x14,
    gap: space.x10,
  },
  recentName: { fontSize: 13, fontWeight: '800' },

  railCard: {
    width: CARD_WIDTH.rail,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  railName: { fontSize: 14.5, fontWeight: '800' },
  railCategory: { fontSize: 11.5, fontWeight: '700', marginTop: 3 },
  outlineButton: {
    height: 44,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.x14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x14,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '800' },
  rowTagline: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.x7 },
  metaCategory: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  rowButton: {
    height: 44,
    paddingHorizontal: space.x18,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  relatedCard: {
    width: CARD_WIDTH.related,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.x14,
    gap: space.x10,
  },
  relatedName: { fontSize: 13.5, fontWeight: '800' },
  relatedCategory: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },

  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.x14,
  },
  libraryName: { fontSize: 14.5, fontWeight: '800' },
  neverOpened: { fontSize: 11, fontWeight: '600' },
});
