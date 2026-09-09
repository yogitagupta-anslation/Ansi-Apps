/**
 * scannerUiState.ts
 * -----------------------------------------------------------------------------
 * The ONE derivation of "what should the scanner UI say right now".
 *
 * Both the Host home card and the Scanner screen previously derived this
 * independently, which is how they once disagreed about whether the scanner
 * "needed resuming". A single pure function means a single answer.
 *
 * Priority order matters and is deliberate:
 *
 *   1. ACTIVE        — the radio is genuinely scanning. Nothing else may claim
 *                      attention while the truth is "it works".
 *   2. BLUETOOTH_OFF — nothing else is fixable while the adapter is down, so
 *                      it outranks permissions and errors.
 *   3. PERMISSION_REQUIRED
 *   4. ERROR         — preference is on, prerequisites fine, start failed.
 *   5. NEEDS_RESUME  — preference is on, prerequisites fine, radio idle.
 *   6. IDLE          — the user intentionally has scanning off.
 *
 * Note the input is the REAL scan state plus the persisted preference; the
 * function never invents a state the radio is not in.
 * -----------------------------------------------------------------------------
 */

import type { IconName } from '../components/Icon';
import type { Readiness } from './BleManager';

export type ScannerUiState =
  | 'ACTIVE'
  | 'IDLE'
  | 'NEEDS_RESUME'
  | 'BLUETOOTH_OFF'
  | 'PERMISSION_REQUIRED'
  | 'ERROR';

export type ScannerAction =
  | 'stop'
  | 'start'
  | 'resume'
  | 'enable-bluetooth'
  | 'grant-permissions'
  | 'retry';

export interface ScannerUiVisual {
  state: ScannerUiState;
  /** Big line, e.g. "System active". */
  title: string;
  /** Supporting line under it. */
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  icon: IconName;
  /** Label for the single primary action this state offers. */
  actionLabel: string;
  action: ScannerAction;
}

export function deriveScannerUiState(input: {
  /** REAL radio state from the BLE layer — never the stored preference. */
  scanning: boolean;
  /** The persisted preference: "the user wants scanning on". */
  scanningEnabled: boolean;
  readiness: Readiness | null;
  /** Why the last automatic resume could not run, if it could not. */
  resumeBlockedReason: string | null;
  /** Last start/scan failure, if one was reported. */
  scanError: string | null;
}): ScannerUiVisual {
  const { scanning, scanningEnabled, readiness, resumeBlockedReason, scanError } = input;

  if (scanning) {
    return {
      state: 'ACTIVE',
      title: 'System active',
      detail: 'Listening for employee advertisements',
      tone: 'success',
      icon: 'radio-tower',
      actionLabel: 'Stop scanning',
      action: 'stop',
    };
  }

  /**
   * Bluetooth is off if EITHER source says so.
   *
   * readiness is the observation; resumeBlockedReason is what the last resume
   * attempt ran into. readiness is null until the first checkReadiness
   * resolves, and that gap is precisely when the store has just recorded
   * BLUETOOTH_OFF — so consulting only readiness left a window where the app
   * held the observation and still offered to resume over a dead adapter.
   */
  const bluetoothOff =
    (readiness !== null && !readiness.bluetooth.ready) ||
    resumeBlockedReason === 'BLUETOOTH_OFF';

  if (bluetoothOff) {
    return {
      state: 'BLUETOOTH_OFF',
      title: 'Bluetooth is off',
      detail: scanningEnabled
        ? 'Turn on Bluetooth to resume attendance scanning.'
        : 'Turn on Bluetooth to scan for employees nearby.',
      tone: 'warning',
      icon: 'bluetooth-off',
      actionLabel: 'Turn on Bluetooth',
      action: 'enable-bluetooth',
    };
  }

  /**
   * Same asymmetry as above, on the other prerequisite: permissions were read
   * only from resumeBlockedReason, so a readiness report that had ALREADY
   * observed them missing still fell through to "Resume scanning" — a button
   * calling startScanning, which cannot succeed without them.
   */
  const permissionsMissing =
    (readiness !== null && !readiness.permissionsGranted) ||
    resumeBlockedReason === 'PERMISSIONS_MISSING';

  if (scanningEnabled && permissionsMissing) {
    return {
      state: 'PERMISSION_REQUIRED',
      title: 'Permissions required',
      detail: 'Allow Bluetooth permissions to detect employees.',
      tone: 'warning',
      icon: 'shield-alert',
      actionLabel: 'Allow permissions',
      action: 'grant-permissions',
    };
  }

  if (
    scanningEnabled &&
    (resumeBlockedReason === 'FAILED' ||
      resumeBlockedReason === 'NOT_SUPPORTED' ||
      scanError !== null)
  ) {
    return {
      state: 'ERROR',
      title: 'Scanner unavailable',
      detail: scanError ?? 'Something went wrong while starting Bluetooth scanning.',
      tone: 'danger',
      icon: 'circle-alert',
      actionLabel: 'Try again',
      action: 'retry',
    };
  }

  if (scanningEnabled) {
    return {
      state: 'NEEDS_RESUME',
      title: 'Scanner needs resuming',
      detail: 'Scanning is enabled but is not currently running.',
      tone: 'warning',
      icon: 'refresh-cw',
      actionLabel: 'Resume scanning',
      action: 'resume',
    };
  }

  return {
    state: 'IDLE',
    title: 'Scanner is stopped',
    detail: 'Start scanning to detect employees nearby.',
    tone: 'neutral',
    icon: 'radio',
    actionLabel: 'Start scanning',
    action: 'start',
  };
}
