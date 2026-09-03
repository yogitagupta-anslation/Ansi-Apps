import React from 'react';
import {Platform, View} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from './AppText';
import {Button, Card} from './ui/Surface';
import {Icon} from './ui/Icon';
import {IconTile, DotTrail} from './ui/IconTile';
import type {BluetoothState} from '../types/BLE';
import type {PermissionResult} from '../ble/BLEPermissions';
import type {PeripheralStatus} from '../services/BleChatService';

interface Props {
  state: BluetoothState;
  permission: PermissionResult;
  peripheral: PeripheralStatus;
  scanning: boolean;
  onRequestPermission: () => void;
  onEnableBluetooth: () => void;
  onOpenSettings: () => void;
}

/**
 * Shows the REAL adapter state. There is no code path that displays "Active" unless the
 * platform reported PoweredOn.
 */
export function BluetoothStatus({
  state,
  permission,
  peripheral,
  scanning,
  onRequestPermission,
  onEnableBluetooth,
  onOpenSettings,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const on = state === 'PoweredOn';

  let headline: string;
  let tone: string;
  switch (state) {
    case 'PoweredOn':
      headline = 'Active';
      tone = theme.ok;
      break;
    case 'PoweredOff':
      headline = 'Turn on Bluetooth';
      tone = theme.warn;
      break;
    case 'Unauthorized':
      headline = 'Bluetooth permission denied';
      tone = theme.error;
      break;
    case 'Unsupported':
      headline = 'Bluetooth LE not supported';
      tone = theme.error;
      break;
    case 'Resetting':
      headline = 'Bluetooth resetting';
      tone = theme.warn;
      break;
    default:
      headline = 'Checking Bluetooth...';
      tone = theme.textDim;
  }

  const permissionsMissing =
    Platform.OS === 'android' && permission.state !== 'granted';

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.headerRow}>
        {/*
          A single soft circle in the brand hue, not tinted by state: the badge's job is
          "this is the Bluetooth control", and that identity does not change when the
          radio is off. Only the headline text and the check badge follow the real state.
        */}
        <IconTile
          icon="bluetooth"
          bg={theme.glow}
          fg={theme.tilePurpleFg}
          size={56}
          iconSize={26}
        />
        <View style={styles.flex}>
          <DenseText style={styles.overline}>Bluetooth</DenseText>
          <View style={styles.headlineRow}>
            <AppText style={[styles.headline, {color: tone}]}>{headline}</AppText>
            {on ? (
              <View style={[styles.check, {backgroundColor: theme.ok}]}>
                <Icon name="check" color={theme.onAccent} size={11} strokeWidth={2.6} />
              </View>
            ) : null}
          </View>
          {on ? (
            <DenseText style={styles.sub}>Your device is discoverable</DenseText>
          ) : null}
        </View>
        {/* Decorative — the card has nowhere further to go, and a disclosure affordance
            with no destination should look like one rather than pretend otherwise. */}
        <View style={styles.chevronCircle}>
          <Icon name="chevronRight" color={theme.textDim} size={16} />
        </View>
      </View>

      {state === 'PoweredOff' && Platform.OS === 'android' && (
        <View style={styles.actionWrap}>
          <Button label="Turn on Bluetooth" onPress={onEnableBluetooth} />
        </View>
      )}

      {state === 'PoweredOff' && Platform.OS === 'ios' && (
        <DenseText style={styles.note}>
          iOS does not allow an app to turn Bluetooth on. Enable it in Settings or
          Control Centre.
        </DenseText>
      )}

      {permissionsMissing && (
        <>
          <DenseText style={styles.note}>
            {permission.state === 'blocked'
              ? `Permanently denied: ${permission.blocked.join(', ')}`
              : `Missing: ${
                  permission.denied.length
                    ? permission.denied.join(', ')
                    : 'nearby-devices permissions'
                }`}
          </DenseText>
          <View style={styles.actionWrap}>
            <Button
              label={
                permission.state === 'blocked'
                  ? 'Open app settings'
                  : 'Grant permissions'
              }
              onPress={
                permission.state === 'blocked'
                  ? onOpenSettings
                  : onRequestPermission
              }
            />
          </View>
        </>
      )}

      {on && (
        <View style={styles.rolesRow}>
          <Role
            icon="radar"
            tile={theme.tileBlue}
            fg={theme.tileBlueFg}
            label="Scanning"
            detail={scanning ? 'looking for peers' : 'idle'}
            dotColor={scanning ? theme.tileBlueFg : theme.border}
          />
          <Role
            icon="broadcast"
            tile={theme.tileGreen}
            fg={theme.tileGreenFg}
            label="Discoverable"
            detail={
              peripheral.advertising
                ? 'advertising'
                : peripheral.error ?? 'not advertising'
            }
            dotColor={peripheral.advertising ? theme.tileGreenFg : theme.border}
          />
        </View>
      )}

      {peripheral.error && !peripheral.advertising && (
        <DenseText style={styles.error}>
          Peripheral role: {peripheral.error}
        </DenseText>
      )}
    </Card>
  );
}

function Role({
  icon,
  tile,
  fg,
  label,
  detail,
  dotColor,
}: {
  icon: 'radar' | 'broadcast';
  tile: string;
  fg: string;
  label: string;
  detail: string;
  dotColor: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.role}>
      <IconTile icon={icon} bg={tile} fg={fg} size={34} iconSize={17} />
      <DenseText style={styles.roleLabel}>{label}</DenseText>
      <DenseText style={styles.roleDetail} numberOfLines={2}>
        {detail}
      </DenseText>
      <DotTrail color={dotColor} />
    </View>
  );
}

const useStyles = makeStyles(t => ({
  card: {borderRadius: radius.xl + 2},
  flex: {flex: 1},

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overline: {...typography.overline, color: t.textDim},
  headlineRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2},
  headline: {...typography.title},
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sub: {...typography.caption, color: t.textDim, marginTop: 2},

  note: {
    ...typography.callout,
    color: t.textDim,
    paddingHorizontal: spacing.lg,
    lineHeight: 18,
  },
  error: {
    ...typography.caption,
    color: t.error,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  actionWrap: {padding: spacing.lg, paddingTop: spacing.md},

  // Two flat panels rather than one card nested inside another: a bordered box inside a
  // bordered box was the main thing making this panel read heavier than the rest of the
  // list, so each subcard is its own light surface instead.
  rolesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    paddingTop: 0,
  },
  role: {
    flex: 1,
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  roleLabel: {...typography.headline, color: t.text, marginTop: spacing.sm},
  roleDetail: {...typography.caption, color: t.textDim, marginTop: 1},
}));
