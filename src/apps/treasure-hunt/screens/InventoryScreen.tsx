import React, {useCallback, useMemo, useState} from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  BackButton,
  FantasyPanel,
  GameButton,
  GameBackground,
  Screen,
  type PanelTone,
} from '../components';
import {POWERUP_SPECS} from '../config/gameConfig';
import {ItemKind, ITEM_GLYPH, ITEM_LABEL} from '../models/world';
import type {RootStackParamList} from '../navigation/types';
import {useGame} from '../state/GameContext';
import {alpha, colors, radius, spacing, typography} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Inventory'>;

type CategoryId = 'items' | 'tools' | 'potions' | 'special';

interface Category {
  id: CategoryId;
  label: string;
  glyph: string;
  tone: PanelTone;
  /** Which of the game's real item kinds belong in this satchel pocket. */
  kinds: readonly ItemKind[];
  empty: string;
}

/**
 * The four pockets of the satchel.
 *
 * These map onto the item kinds the game actually generates — nothing here is
 * decorative filler. Valuables score, tools read the world, potions change the
 * hunter, and the special pocket holds the rare burn.
 */
const CATEGORIES: readonly Category[] = [
  {
    id: 'items',
    label: 'Items',
    glyph: '💰',
    tone: 'gold',
    kinds: [ItemKind.Coin, ItemKind.Gem],
    empty: 'No treasure banked yet. Coins and gems you collect land here.',
  },
  {
    id: 'tools',
    label: 'Tools',
    glyph: '🧭',
    tone: 'crystal',
    kinds: [ItemKind.Radar, ItemKind.Hint],
    empty: 'No instruments held. Radars and compasses sharpen the hunt.',
  },
  {
    id: 'potions',
    label: 'Potions',
    glyph: '🧪',
    tone: 'arcane',
    kinds: [ItemKind.Energy, ItemKind.Shield],
    empty: 'No brews in the satchel. Speed and warding draughts go here.',
  },
  {
    id: 'special',
    label: 'Special',
    glyph: '🔥',
    tone: 'ember',
    kinds: [ItemKind.DoublePoints],
    empty: 'Nothing rare yet. The rarest finds are kept in this pocket.',
  },
];

/** Flavour used where the game config has no description of its own. */
const LORE: Partial<Record<ItemKind, string>> = {
  [ItemKind.Coin]: 'Struck long before the forest swallowed the road.',
  [ItemKind.Gem]: 'Cold to the touch, and worth far more than coin.',
};

/**
 * Where things sit on the painted panel, as fractions of its size.
 *
 * Measured off the native 569x405 art: the four tab tiles down the left rail
 * and the recessed grid well they open into.
 */
const PANEL_RATIO = 569 / 405;
const TAB_X = 46 / 569;
const TAB_W = 62 / 569;
const TAB_H = 62 / 405;
const TAB_CY = [120 / 405, 188 / 405, 260 / 405, 330 / 405] as const;
const WELL_X = 120 / 569;
const WELL_Y = 88 / 405;
const WELL_W = (519 - 120) / 569;
const WELL_H = (376 - 88) / 405;
/** The well's painted lattice. */
const GRID_COLS = 5;
const GRID_ROWS = 4;
/** Screen padding plus the safe-area strip the panel must not run into. */
const PANEL_MARGIN = 56;

interface Slot {
  kind: ItemKind;
  count: number;
  activeUntil?: number;
}

/** One item tile: glyph on a stone plinth, count badge, active ring. */
function SlotTile({
  slot,
  selected,
  size,
  onPress,
  style,
}: {
  slot: Slot;
  selected: boolean;
  size: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const active = slot.activeUntil !== undefined;
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.slot,
        {width: size, height: size, borderRadius: size * 0.2},
        selected && styles.slotSelected,
        active && styles.slotActive,
        pressed && styles.slotPressed,
        style,
      ]}>
      <Text style={{fontSize: size * 0.5}}>{ITEM_GLYPH[slot.kind]}</Text>
      {slot.count > 1 ? (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{slot.count}</Text>
        </View>
      ) : null}
      {active ? <View style={styles.activeDot} /> : null}
    </Pressable>
  );
}

export function InventoryScreen({navigation}: Props) {
  const {manager, state, players, pushToast} = useGame();
  const {height: windowHeight} = useWindowDimensions();
  const [category, setCategory] = useState<CategoryId>('items');
  const [inspecting, setInspecting] = useState<ItemKind | null>(null);

  const localPlayer = players.find(player => player.id === state.localPlayerId);

  /** Roll the flat inventory list into counted slots for this pocket. */
  const slots = useMemo<Slot[]>(() => {
    const active = CATEGORIES.find(entry => entry.id === category);
    if (!active || !localPlayer) {
      return [];
    }
    const counts = new Map<ItemKind, number>();
    for (const kind of localPlayer.inventory) {
      if (active.kinds.includes(kind)) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    // Coins and gems are banked into score the moment they are picked up, so
    // they never sit in `inventory`. Count them off the world instead, which
    // records who collected which item and of what kind.
    if (active.id === 'items') {
      for (const item of state.world?.items ?? []) {
        if (
          item.collectedBy === localPlayer.id &&
          active.kinds.includes(item.kind)
        ) {
          counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].map(([kind, count]) => {
      const running = localPlayer.activePowerUps.find(entry => entry.kind === kind);
      return {kind, count, activeUntil: running?.expiresAt};
    });
  }, [category, localPlayer, state.world]);

  const activeCategory: Category =
    CATEGORIES.find(entry => entry.id === category) ?? CATEGORIES[0]!;

  const use = useCallback(
    (kind: ItemKind) => {
      const spec = POWERUP_SPECS[kind];
      if (!spec) {
        pushToast('info', `${ITEM_LABEL[kind]} is treasure, not a tool.`);
        setInspecting(null);
        return;
      }
      manager.usePowerUp(kind);
      pushToast('info', `${spec.label} activated.`);
      setInspecting(null);
    },
    [manager, pushToast],
  );

  const inspectSpec = inspecting ? POWERUP_SPECS[inspecting] : undefined;

  // The panel is a fixed-aspect painting, so size it off the space available
  // and let the detail pane take whatever is left.
  const panelH = Math.max(160, windowHeight - PANEL_MARGIN);
  const panelW = panelH * PANEL_RATIO;
  const cellW = panelW * WELL_W / GRID_COLS;
  const cellH = panelH * WELL_H / GRID_ROWS;
  const slotSize = Math.min(cellW, cellH) * 0.82;

  return (
    <Screen>
      <GameBackground variant="inventory">
        <View style={styles.layout}>
          <BackButton onPress={() => navigation.goBack()} style={styles.back} />

          {/* The kit's satchel panel. Its four painted tabs are exactly the
              four pockets the game uses, so they drive the categories rather
              than being decoration. */}
          <View style={{width: panelW, height: panelH}}>
            <Image
              source={require('../assets/panel-inventory.png')}
              style={{width: panelW, height: panelH}}
              resizeMode="contain"
              fadeDuration={0}
            />

            {CATEGORIES.map((entry, index) => {
              const on = entry.id === category;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="tab"
                  accessibilityState={{selected: on}}
                  accessibilityLabel={entry.label}
                  onPress={() => setCategory(entry.id)}
                  style={[
                    styles.tabHit,
                    {
                      left: panelW * TAB_X,
                      top: panelH * TAB_CY[index]! - (panelH * TAB_H) / 2,
                      width: panelW * TAB_W,
                      height: panelH * TAB_H,
                    },
                    on && styles.tabHitOn,
                  ]}
                />
              );
            })}

            {slots.length === 0 ? (
              <View
                pointerEvents="none"
                style={[
                  styles.emptyState,
                  {
                    left: panelW * WELL_X,
                    top: panelH * WELL_Y,
                    width: panelW * WELL_W,
                    height: panelH * WELL_H,
                  },
                ]}>
                <Text style={styles.emptyGlyph}>{activeCategory.glyph}</Text>
                <Text style={styles.emptyText}>{activeCategory.empty}</Text>
              </View>
            ) : (
              slots.map((slot, index) => (
                <SlotTile
                  key={slot.kind}
                  slot={slot}
                  size={slotSize}
                  selected={inspecting === slot.kind}
                  onPress={() => setInspecting(slot.kind)}
                  style={{
                    position: 'absolute',
                    left:
                      panelW * WELL_X +
                      (index % GRID_COLS) * cellW +
                      (cellW - slotSize) / 2,
                    top:
                      panelH * WELL_Y +
                      Math.floor(index / GRID_COLS) * cellH +
                      (cellH - slotSize) / 2,
                  }}
                />
              ))
            )}
          </View>

          {/* Detail pane: what the popup used to say, kept on screen so the
              grid stays visible while reading it. */}
          <View style={styles.detail}>
            {inspecting ? (
              <FantasyPanel
                tone={activeCategory.tone}
                title={ITEM_LABEL[inspecting]}
                icon={ITEM_GLYPH[inspecting]}
                bodyStyle={styles.detailBody}>
                <Text style={styles.detailText}>
                  {inspectSpec?.description ?? LORE[inspecting] ?? 'A find worth carrying.'}
                </Text>
                {inspectSpec ? (
                  <GameButton
                    label="Use"
                    icon={inspectSpec.glyph}
                    tone="gold"
                    size="md"
                    onPress={() => use(inspecting)}
                    style={styles.detailAction}
                  />
                ) : (
                  <Text style={styles.detailNote}>
                    Treasure, not a tool — it is already banked into your score.
                  </Text>
                )}
              </FantasyPanel>
            ) : (
              <Text style={styles.detailPrompt}>
                Pick a pocket on the satchel, then tap something inside it.
              </Text>
            )}
          </View>
        </View>
      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** Transparent hit areas over the panel's four painted tabs. */
  tabHit: {
    position: 'absolute',
    borderRadius: radius.md,
  },
  tabHitOn: {
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: alpha(colors.gold, 0.16),
  },
  detail: {
    flex: 1,
    justifyContent: 'center',
  },
  detailBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailText: {
    ...typography.bodyMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  detailAction: {
    alignSelf: 'flex-start',
    minWidth: 130,
  },
  detailNote: {
    ...typography.bodyMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  detailPrompt: {
    ...typography.bodyMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingLeft: 48,
    paddingRight: spacing.md,
    gap: spacing.md,
  },
  back: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 2,
  },
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: alpha(colors.stoneLight, 0.32),
    backgroundColor: alpha(colors.abyss, 0.6),
  },
  slotSelected: {
    borderColor: colors.gold,
    backgroundColor: alpha(colors.gold, 0.14),
  },
  slotActive: {
    borderColor: colors.crystal,
  },
  slotPressed: {
    opacity: 0.7,
  },
  slotGlyph: {
    fontSize: 26,
  },
  countBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 20,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.goldDeep,
    borderWidth: 1,
    borderColor: colors.goldBright,
    alignItems: 'center',
  },
  countText: {
    ...typography.fieldLabel,
    fontSize: 10,
    color: colors.goldInk,
  },
  activeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.crystal,
  },
  emptyState: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyGlyph: {
    fontSize: 30,
    opacity: 0.35,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.bodyMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
});
