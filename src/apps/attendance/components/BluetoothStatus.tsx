/**
 * BluetoothStatus.tsx
 * -----------------------------------------------------------------------------
 * Renders REAL adapter state and every blocker standing between the current
 * role and a working radio. Never assumes Bluetooth is on.
 *
 * Each blocker carries the action that fixes it, so the user is not left
 * reading an error with nothing to do about it.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  openLocationSettings,
  requestEnableBluetooth,
} from '../bluetooth/BleAdvertiser';
import { checkReadiness, type Readiness } from '../bluetooth/BleManager';
import { openAppSettings } from '../bluetooth/permissions';
import type { AppRole } from '../constants/appConfig';
import { useTheme } from '../theme/ThemeContext';
import { StatusBadge } from './StatusBadge';
import { Banner } from './ui';

/**
 * Poll readiness while a screen is mounted.
 *
 * Bluetooth and location can be toggled from the notification shade at any
 * moment, and there is no single reliable broadcast for all of it - so the
 * screen re-checks on an interval and whenever the app returns to foreground.
 */
export function useReadiness(role: AppRole, intervalMs = 3000) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  const refresh = useCallback(async () => {
    setReadiness(await checkReadiness(role));
  }, [role]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        refresh();
      }
    });
    const timer = setInterval(refresh, intervalMs);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { readiness, refresh };
}

/** Compact Bluetooth state pill. */
export function BluetoothStatusBadge({ readiness }: { readiness: Readiness | null }) {
  if (!readiness) {
    return <StatusBadge label="Checking" tone="neutral" />;
  }
  const bt = readiness.bluetooth;
  if (bt.ready) {
    return <StatusBadge label="Available" tone="success" icon="bluetooth" />;
  }
  if (bt.state === 'PoweredOff') {
    return <StatusBadge label="Off" tone="danger" icon="bluetooth-off" />;
  }
  return <StatusBadge label={bt.state} tone="warning" icon="bluetooth-off" />;
}

/** Full blocker list with a fix action for each. */
export function BlockerBanners({
  readiness,
  onChanged,
}: {
  readiness: Readiness | null;
  onChanged?: () => void;
}) {
  const t = useTheme();
  void t;

  if (!readiness || readiness.blockers.length === 0) {
    return null;
  }

  return (
    <>
      {readiness.blockers.map(blocker => {
        let actionLabel: string | undefined;
        let onAction: (() => void) | undefined;

        switch (blocker.code) {
          case 'BLUETOOTH_OFF':
            actionLabel = 'Turn Bluetooth on';
            onAction = () => {
              void requestEnableBluetooth().then(() => onChanged?.());
            };
            break;
          case 'LOCATION_SERVICES_OFF':
            actionLabel = 'Open location settings';
            onAction = () => {
              void openLocationSettings().then(() => onChanged?.());
            };
            break;
          case 'PERMISSIONS_MISSING':
            actionLabel = 'Open app settings';
            onAction = openAppSettings;
            break;
          default:
            break;
        }

        return (
          <Banner
            key={blocker.code}
            tone={blocker.fixable ? 'warning' : 'danger'}
            title={blocker.title}
            detail={blocker.detail}
            actionLabel={actionLabel}
            onAction={onAction}
          />
        );
      })}
    </>
  );
}
