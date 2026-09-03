import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  BackButton,
  FantasyDialog,
  GameBackground,
  GestureTutorial,
  TierBanner,
  HudBadge,
  HudBar,
  PickupFloater,
  ProximityBar,
  Screen,
  Toast,
  WorldViewport,
  type Floater,
} from '../components';
import {useGame} from '../state/GameContext';
import {GamePhase, ProximityLevel} from '../models/game';
import {ItemKind} from '../models/world';
import type {Position} from '../models/geometry';
import {PROXIMITY_ORDER, VISIBLE_WORLD_HEIGHT} from '../config/gameConfig';
import {formatDuration} from '../utils/time';
import {navigateAfterCommit} from '../utils/navigation';
import {uid} from '../utils/id';
import {HIT_SLOP, alpha, colors, radius, spacing} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

/** Height reserved for the top bar; everything else is world. */
const TOP_BAR = 58;
/** Sized so the painted bars sit inside the top strip without crowding it. */
const HUD_BAR_WIDTH = 232;
const PROXIMITY_BAR_WIDTH = 208;
/** Height of the slim status strip along the bottom. */
const STATUS_STRIP = 30;

/**
 * The landscape gameplay screen.
 *
 * The world IS the screen: a camera viewport fills everything between a compact
 * top bar and a thin status strip, which works out at roughly 80% of the
 * display. There is no movement pad and no permanent joystick -- dragging
 * anywhere on the world steers, so nothing sits between the player and the game.
 */
export function GameScreen({navigation}: Props) {
  const {
    manager,
    state,
    players,
    proximity,
    countdown,
    remainingMs,
    toasts,
    dismissToast,
    profile,
    updateProfile,
  } = useGame();

  const {width, height} = useWindowDimensions();
  const [floaters, setFloaters] = useState<Floater[]>([]);

  const world = state.world;
  const localPlayer = players.find(player => player.id === state.localPlayerId);
  const playing = state.phase === GamePhase.Playing;

  // The coach mark shows until the player has dragged once, ever.
  const [showTutorial, setShowTutorial] = useState(false);
  /** The tier to shout about, or null when nothing is pending. */
  const [announced, setAnnounced] = useState<ProximityLevel | null>(null);
  const lastTier = useRef(PROXIMITY_ORDER.indexOf(ProximityLevel.VeryFar));
  useEffect(() => {
    if (profile && !profile.hasMovedOnce && playing) {
      setShowTutorial(true);
    }
  }, [profile, playing]);

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    if (profile && !profile.hasMovedOnce) {
      void updateProfile({hasMovedOnce: true});
    }
  }, [profile, updateProfile]);

  const steer = useCallback(
    (direction: Position) => manager.setMoveDirection(direction),
    [manager],
  );

  const viewportHeight = Math.max(120, height - TOP_BAR - STATUS_STRIP);

  /**
   * Points per world unit. Derived from the viewport so roughly the same slice
   * of world is visible on every device, and clamped so a very small world
   * still fills the screen rather than floating in the void.
   */
  const zoom = useMemo(() => {
    const fromHeight = viewportHeight / VISIBLE_WORLD_HEIGHT;
    if (!world) {
      return fromHeight;
    }
    // Never zoom out so far that the world stops filling the viewport.
    const minToFill = Math.max(
      viewportHeight / world.size.height,
      width / world.size.width,
    );
    return Math.max(fromHeight, minToFill);
  }, [viewportHeight, width, world]);

  useEffect(() => {
    if (state.phase === GamePhase.Finished) {
      navigation.replace('Results');
      return;
    }
    /*
     * The host can reset the hunt out from under us with Play Again.
     *
     * Its LOBBY_STATE puts our engine back in LOBBY, but this screen only
     * ever left on FINISHED -- so the player stayed in a match that no longer
     * existed, still standing where they had wandered to, while the host was
     * already running the next one.
     */
    if (state.phase === GamePhase.Lobby) {
      navigateAfterCommit(() => navigation.replace('Lobby'));
    }
  }, [state.phase, navigation]);

  const removeFloater = useCallback((id: string) => {
    setFloaters(current => current.filter(f => f.id !== id));
  }, []);

  // Collecting something pops a "+N" above the player.
  useEffect(() => {
    const off = manager.events.on('itemCollected', ({item, points, isLocal}) => {
      if (!isLocal) {
        return;
      }
      const color =
        item.kind === ItemKind.Coin
          ? colors.gold
          : item.kind === ItemKind.Gem
            ? colors.cyan
            : colors.greenBright;
      setFloaters(current =>
        [...current, {id: uid('f'), label: `+${points}`, color}].slice(-4),
      );
    });
    return off;
  }, [manager]);

  const [confirmQuit, setConfirmQuit] = useState(false);

  /**
   * Fire the banner only when the reading improves. Wandering back and forth
   * across a boundary would otherwise keep a banner on screen permanently.
   */
  useEffect(() => {
    const rank = PROXIMITY_ORDER.indexOf(proximity.level);
    if (rank > lastTier.current) {
      setAnnounced(proximity.level);
    }
    lastTier.current = rank;
  }, [proximity.level]);

  const quit = useCallback(async () => {
    setConfirmQuit(false);
    if (manager.isHost) {
      manager.endMatchEarly();
      return;
    }
    await manager.leaveGame();
    navigation.popToTop();
  }, [manager, navigation]);

  const score = localPlayer ? state.players[localPlayer.id]?.score ?? 0 : 0;
  const inventory = localPlayer?.inventory ?? [];
  const activePowerUps = localPlayer?.activePowerUps ?? [];

  /**
   * The running power-up, if any, shown as a kit badge counting down.
   *
   * The painted HUD cell reports how many power-ups are *held*; without this
   * there would be nothing on screen saying one is currently burning.
   */
  const activeBadge = useMemo(() => {
    const running = activePowerUps[0];
    if (!running) {
      return null;
    }
    const seconds = Math.max(0, Math.ceil((running.expiresAt - Date.now()) / 1000));
    // Radar and Hint are both "see further" effects, so they share the lens.
    const lens = running.kind === ItemKind.Radar || running.kind === ItemKind.Hint;
    return {kind: lens ? ('lens' as const) : ('energy' as const), seconds};
  }, [activePowerUps]);

  const usePowerUp = useCallback(() => {
    const kind = inventory[0];
    if (kind) {
      manager.usePowerUp(kind);
    }
  }, [inventory, manager]);

  if (!world) {
    return (
      <Screen>
        <View style={styles.centre}>
          <Text style={styles.loading}>Generating the virtual world…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen background={colors.abyss} edges={{top: true, bottom: false}}>
      {/* ------------------------- top bar ------------------------- */}
      <View style={[styles.topBar, {height: TOP_BAR}]}>
        <BackButton
          onPress={() => setConfirmQuit(true)}
          label="Leave the hunt"
          size={34}
        />

        {/* The painted proximity bar carries the tier readout. */}
        <ProximityBar
          level={proximity.level}
          width={PROXIMITY_BAR_WIDTH}
          style={styles.proximityBar}
        />

        <View style={styles.stats}>
          {/* Coins, held power-ups and the clock, in the kit's HUD frame.
              Tapping the middle cell spends a power-up. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use a power-up"
            disabled={inventory.length === 0}
            onPress={usePowerUp}>
            <HudBar
              coins={String(score)}
              power={String(inventory.length)}
              time={state.config.durationSec > 0 ? formatDuration(remainingMs) : '∞'}
              width={HUD_BAR_WIDTH}
            />
          </Pressable>
          {activeBadge ? (
            <HudBadge
              kind={activeBadge.kind}
              count={activeBadge.seconds}
              size={34}
              style={styles.activeBadge}
            />
          ) : null}
          {/* The treasure radar was registered but nothing opened it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the treasure radar"
            hitSlop={HIT_SLOP}
            onPress={() =>
              navigateAfterCommit(() => navigation.navigate('TreasureRadar'))
            }
            style={({pressed}) => [pressed && styles.pressed]}>
            <Image
              source={require('../assets/compass-dial.png')}
              style={styles.compassButton}
              resizeMode="contain"
              fadeDuration={0}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the satchel"
            hitSlop={HIT_SLOP}
            onPress={() => navigateAfterCommit(() => navigation.navigate('Inventory'))}
            style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
            <Text style={styles.satchel}>🎒</Text>
          </Pressable>
        </View>
      </View>

      {/* ------------------------- the world ------------------------- */}
      {/* `collapsable={false}` is load-bearing, not decoration.
          This is a layout-only View, so Fabric flattens it away. The
          overlays below (tier banner, tutorial, toasts, floaters) mount and
          unmount while the hunt runs; each time, Fabric had to materialise a
          real view for this node and re-add its first child, which still
          belonged to the old parent. That killed the process with
          "addViewAt: failed to insert view ... The specified child already
          has a parent" -- on the host, so the match ended for nobody. */}
      <View style={styles.stage} collapsable={false}>
        <WorldViewport
          world={world}
          players={players}
          localPlayerId={state.localPlayerId}
          treasures={manager.getVisibleTreasures()}
          width={width}
          height={viewportHeight}
          zoom={zoom}
          showOtherPlayers={state.config.showOtherPlayers}
          onSteer={playing ? steer : undefined}
          onFirstDrag={dismissTutorial}
        />

        {/* The player is always centred, so floaters rise from the middle. */}
        <View style={styles.floaterAnchor} pointerEvents="none" collapsable={false}>
          {floaters.map(floater => (
            <PickupFloater key={floater.id} floater={floater} onDone={removeFloater} />
          ))}
        </View>

        <View style={styles.toastLayer} pointerEvents="box-none" collapsable={false}>
          {toasts.map(toast => (
            <Toast key={toast.id} toast={toast} onDone={dismissToast} />
          ))}
        </View>

        {/* Enchanted-forest atmosphere, drawn over the terrain. It never
            intercepts touches, so drag-to-move is unaffected. */}
        <GameBackground variant="gameplay" overlay />

        <GestureTutorial
          visible={showTutorial && playing}
          onDismiss={dismissTutorial}
        />

        {/* Announces a warmer reading, on the kit's flame banner. */}
        <TierBanner level={announced} onDone={() => setAnnounced(null)} />
      </View>

      {/* ------------------------- status strip ------------------------- */}
      <View style={[styles.statusStrip, {height: STATUS_STRIP}]}>
        <Text style={styles.statusHint} numberOfLines={1}>
          {proximity.bearingDeg !== undefined
            ? 'Hint active — bearing available'
            : `${players.length} hunter${players.length === 1 ? '' : 's'} in this world`}
        </Text>
      </View>

      {/* Leaving used to happen on a single tap. For a host that ends the
          match for everyone, so it asks first. */}
      <FantasyDialog
        visible={confirmQuit}
        crest="🚪"
        tone="ember"
        title={manager.isHost ? 'End the hunt?' : 'Leave the hunt?'}
        message={
          manager.isHost
            ? 'You are hosting. Ending now finishes the match for every hunter.'
            : 'Your score so far is kept, but you drop out of this match.'
        }
        onDismiss={() => setConfirmQuit(false)}
        actions={[
          {label: 'Stay', tone: 'dark', onPress: () => setConfirmQuit(false)},
          {
            label: manager.isHost ? 'End' : 'Leave',
            tone: 'danger',
            onPress: () => void quit(),
          },
        ]}
      />

      {countdown !== null && state.phase === GamePhase.Countdown ? (
        <View style={styles.countdownOverlay} pointerEvents="none">
          <Text style={styles.countdownNumber}>{countdown}</Text>
          <Text style={styles.countdownLabel}>GET READY</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    color: colors.textMuted,
    fontSize: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.header,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  satchel: {
    fontSize: 15,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: {
    opacity: 0.6,
  },
  activeBadge: {
    marginLeft: 2,
  },
  compassButton: {
    width: 42,
    height: 42 * (273 / 327),
  },
  proximityBar: {
    flex: 0,
    marginLeft: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 'auto',
  },
  stage: {
    flex: 1,
    position: 'relative',
  },
  floaterAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Just above the centred player, so it never covers the YOU label.
    top: '30%',
    alignItems: 'center',
  },
  toastLayer: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 40,
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.header,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  statusHint: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
  },
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.abyss, 0.9),
    zIndex: 100,
  },
  countdownNumber: {
    fontSize: 84,
    fontWeight: '900',
    color: colors.gold,
  },
  countdownLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 5,
    color: colors.textMuted,
  },
});
