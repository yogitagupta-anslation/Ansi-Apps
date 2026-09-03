import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  GameBackground,
  GameButton,
  Panel,
  ScanRadar,
  Screen,
  ScreenHeader,
} from '../components';
import {useGame} from '../state/GameContext';
import {navigateAfterCommit} from '../utils/navigation';
import {BleAdapterState} from '../ble/BleTypes';
import type {DiscoveredHost} from '../ble/BleTypes';
import {colors, radius, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Join'>;

export function JoinScreen({navigation}: Props) {
  const {manager, profile, hosts, adapterState, pushToast} = useGame();
  /*
   * Landscape puts the radar and the results side by side.
   *
   * Stacked, the caption plus a 230dp radar filled the whole ~295dp viewport
   * of a landscape phone, so "Available Games" and every discovered host sat
   * below the fold. The caption renders either way, so a found hunt looked
   * exactly like no hunts at all -- the list was there, just off-screen.
   */
  const {width: winWidth, height: winHeight} = useWindowDimensions();
  const sideBySide = winWidth > winHeight;
  const radarSize = sideBySide ? Math.min(230, Math.round(winHeight * 0.46)) : 230;
  const [scanning, setScanning] = useState(false);
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const startScan = useCallback(async () => {
    if (!profile) {
      return;
    }
    setFatal(null);
    setScanning(true);
    try {
      await manager.startDiscovery({name: profile.name, avatar: profile.avatar});
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'Could not start scanning.');
      setScanning(false);
    }
  }, [manager, profile]);

  useEffect(() => {
    void startScan();
    return () => {
      void manager.stopDiscovery();
    };
  }, [manager, startScan]);

  const join = useCallback(
    async (host: DiscoveredHost) => {
      if (!profile) {
        return;
      }
      setConnectingTo(host.deviceId);
      try {
        await manager.joinGame(host, {name: profile.name, avatar: profile.avatar});
        navigateAfterCommit(() => navigation.replace('Lobby'));
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'Could not join.');
        setConnectingTo(null);
      }
    },
    [manager, navigation, profile, pushToast],
  );

  const bluetoothDown =
    adapterState === BleAdapterState.PoweredOff ||
    adapterState === BleAdapterState.Unauthorized ||
    adapterState === BleAdapterState.Unsupported;

  return (
    <Screen>
      <GameBackground variant="lobby">
        <ScreenHeader title="Join Game" onBack={() => navigation.goBack()} />

        <ScrollView
          removeClippedSubviews={false}
          style={styles.scrollFlex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={sideBySide ? styles.columns : undefined}>
            <View style={sideBySide ? styles.radarColumn : undefined}>
              <Text style={styles.scanCaption}>
                {bluetoothDown ? 'Bluetooth unavailable' : 'Scanning for games nearby...'}
              </Text>

              <View style={styles.radarWrap}>
                <ScanRadar
                  size={radarSize}
                  contacts={hosts.length}
                  active={scanning && !bluetoothDown}
                />
              </View>
            </View>

            <View style={sideBySide ? styles.listColumn : undefined}>

          {fatal ? (
            <Panel accent={colors.danger}>
              <Text style={styles.errorTitle}>Bluetooth unavailable</Text>
              <Text style={styles.errorBody}>{fatal}</Text>
            </Panel>
          ) : null}

          {bluetoothDown && !fatal ? (
            <Panel accent={colors.warning}>
              <Text style={styles.errorTitle}>
                {adapterState === BleAdapterState.PoweredOff
                  ? 'Bluetooth is off'
                  : adapterState === BleAdapterState.Unsupported
                    ? 'This device has no BLE radio'
                    : 'Bluetooth permission is blocked'}
              </Text>
              <Text style={styles.errorBody}>
                {adapterState === BleAdapterState.Unsupported
                  ? 'Emulators usually have no Bluetooth radio. Try Solo Practice, or run on a real phone.'
                  : 'Turn Bluetooth on and allow the permission to find nearby hunts.'}
              </Text>
            </Panel>
          ) : null}

          <Text style={[typography.sectionLabel, styles.listLabel]}>Available Games</Text>

          {hosts.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {scanning
                  ? 'No hunts yet — ask the host to create one and keep both phones close.'
                  : 'No hunts found.'}
              </Text>
            </View>
          ) : (
            hosts.map(host => {
              const connecting = connectingTo === host.deviceId;
              return (
                <View key={host.deviceId} style={styles.hostRow}>
                  <View style={styles.hostInfo}>
                    <Text style={styles.hostName}>Treasure Hunt</Text>
                    <Text style={styles.hostMeta}>
                      <Text style={styles.hostCode}>{host.gameCode}</Text>
                      <Text>   {host.rssi !== null ? `${host.rssi} dBm` : 'nearby'}</Text>
                    </Text>
                  </View>
                  {/* Keep one stable node here; swapping element types in a
                      slot that can unmount mid-navigation upsets the renderer. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Join hunt ${host.gameCode}`}
                    disabled={connectingTo !== null}
                    onPress={() => join(host)}
                    style={({pressed}) => [styles.joinButton, pressed && {opacity: 0.7}]}>
                    <Text style={styles.joinText}>{connecting ? '...' : 'JOIN'}</Text>
                  </Pressable>
                </View>
              );
            })
          )}

            </View>
          </View>

          <View style={styles.actions}>
            <GameButton
              label="Refresh"
              icon="🔄"
              tone="dark"
              size="md"
              disabled={connectingTo !== null}
              onPress={startScan}
              style={styles.action}
            />
          </View>
        </ScrollView>

      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /**
   * Actions live at the end of the scroll content, not in a pinned bar.
   * A short landscape screen has no room for a permanent footer, and a pinned
   * one clipped the last button against the gesture bar.
   */
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  action: {
    flex: 1,
    maxWidth: 260,
  },
  scrollFlex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  scanCaption: {
    ...typography.bodyMuted,
    textAlign: 'center',
    fontSize: 13,
  },
  radarWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  /** Landscape: radar on the left, discovered hunts on the right. */
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xl,
  },
  radarColumn: {
    flexShrink: 0,
  },
  listColumn: {
    flex: 1,
    minWidth: 0,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  errorBody: {
    ...typography.bodyMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  listLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  empty: {
    padding: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
  },
  emptyText: {
    ...typography.bodyMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    marginBottom: spacing.sm,
  },
  hostInfo: {
    flex: 1,
    gap: 3,
  },
  hostName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  hostMeta: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  hostCode: {
    color: colors.gold,
    fontWeight: '900',
  },
  joinButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.green,
    borderWidth: 1.5,
    borderColor: colors.greenDeep,
  },
  joinText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#062A08',
  },
});
