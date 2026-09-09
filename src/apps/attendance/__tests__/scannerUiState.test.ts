/**
 * scannerUiState — the ONE derivation of what the scanner UI is allowed to claim.
 *
 * The whole point of this module is that the screen reports the REAL radio rather
 * than the saved preference, so the assertions that matter most are the ones about
 * what it must NOT say: it must not claim Bluetooth is off before readiness has
 * actually been observed, it must not invent a cause for a failure the radio never
 * described, and it must never pair a state with an action label that promises
 * something the action does not do. A "Resume scanning" button that cannot resume
 * is precisely the disagreement this single source was written to end.
 */

import type { Readiness } from '../bluetooth/BleManager';
import {
  deriveScannerUiState,
  type ScannerUiState,
  type ScannerUiVisual,
} from '../bluetooth/scannerUiState';

type ScannerInput = Parameters<typeof deriveScannerUiState>[0];

const CAPABILITIES: Readiness['capabilities'] = {
  bleSupported: true,
  advertisingSupported: false,
  multipleAdvertisementSupported: false,
  extendedAdvertisingSupported: false,
  maxAdvertisingDataLength: 0,
  bluetoothEnabled: true,
  locationServicesEnabled: true,
  adapterName: 'test-adapter',
};

/** A readiness report shaped exactly as the BLE layer hands one over. */
function readiness(opts: { bluetoothOn: boolean; permissionsGranted?: boolean }): Readiness {
  const { bluetoothOn, permissionsGranted = true } = opts;
  return {
    ready: bluetoothOn && permissionsGranted,
    blockers: [
      ...(bluetoothOn
        ? []
        : [
            {
              code: 'BLUETOOTH_OFF' as const,
              title: 'Bluetooth is off',
              detail: 'Turn Bluetooth on to continue.',
              fixable: true,
            },
          ]),
      ...(permissionsGranted
        ? []
        : [
            {
              code: 'PERMISSIONS_MISSING' as const,
              title: 'Bluetooth permissions not granted',
              detail: 'Nearby devices permission is required to scan.',
              fixable: true,
            },
          ]),
    ],
    bluetooth: bluetoothOn
      ? {
          state: 'PoweredOn',
          available: true,
          ready: true,
          message: 'Bluetooth is on and ready.',
        }
      : {
          state: 'PoweredOff',
          available: true,
          ready: false,
          message: 'Bluetooth is switched off. Turn it on to continue.',
        },
    capabilities: { ...CAPABILITIES, bluetoothEnabled: bluetoothOn },
    permissionsGranted,
    locationServicesOn: true,
    platformLabel: 'Android 14',
  };
}

/** The quiet baseline: nothing running, nothing wanted, nothing observed. */
function input(over: Partial<ScannerInput> = {}): ScannerInput {
  return {
    scanning: false,
    scanningEnabled: false,
    readiness: null,
    resumeBlockedReason: null,
    scanError: null,
    ...over,
  };
}

/**
 * The contract table. Each state offers exactly one action, and the label must
 * describe that action and nothing else — a label promising more than the action
 * delivers is the bug this module exists to prevent.
 */
const CONTRACT: Record<
  ScannerUiState,
  Pick<ScannerUiVisual, 'action' | 'actionLabel' | 'tone' | 'icon'>
> = {
  ACTIVE: {
    action: 'stop',
    actionLabel: 'Stop scanning',
    tone: 'success',
    icon: 'radio-tower',
  },
  IDLE: { action: 'start', actionLabel: 'Start scanning', tone: 'neutral', icon: 'radio' },
  NEEDS_RESUME: {
    action: 'resume',
    actionLabel: 'Resume scanning',
    tone: 'warning',
    icon: 'refresh-cw',
  },
  BLUETOOTH_OFF: {
    action: 'enable-bluetooth',
    actionLabel: 'Turn on Bluetooth',
    tone: 'warning',
    icon: 'bluetooth-off',
  },
  PERMISSION_REQUIRED: {
    action: 'grant-permissions',
    actionLabel: 'Allow permissions',
    tone: 'warning',
    icon: 'shield-alert',
  },
  ERROR: { action: 'retry', actionLabel: 'Try again', tone: 'danger', icon: 'circle-alert' },
};

describe('ACTIVE — the real radio outranks everything else', () => {
  it('reports ACTIVE and offers Stop when the radio is genuinely scanning', () => {
    const visual = deriveScannerUiState(
      input({
        scanning: true,
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true }),
      }),
    );

    expect(visual.state).toBe('ACTIVE');
    expect(visual.action).toBe('stop');
    expect(visual.actionLabel).toBe('Stop scanning');
    expect(visual.tone).toBe('success');
  });

  it('still reports ACTIVE when the stored preference says scanning is off', () => {
    // The preference is what the user asked for; `scanning` is what the radio is
    // doing. The screen reports the radio, or it is lying about the present.
    const visual = deriveScannerUiState(input({ scanning: true, scanningEnabled: false }));

    expect(visual.state).toBe('ACTIVE');
    expect(visual.action).toBe('stop');
  });

  it('still reports ACTIVE when a stale blocker and a stale error are on record', () => {
    // Everything else in the input claims something is broken, but the radio is
    // running: nothing may claim attention while the truth is "it works".
    const visual = deriveScannerUiState(
      input({
        scanning: true,
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: false, permissionsGranted: false }),
        resumeBlockedReason: 'PERMISSIONS_MISSING',
        scanError: 'Scan failed to start (code 2)',
      }),
    );

    expect(visual.state).toBe('ACTIVE');
    expect(visual.actionLabel).toBe('Stop scanning');
  });
});

describe('BLUETOOTH_OFF — outranks permissions and errors', () => {
  it('reports Bluetooth off ahead of a permission block', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: false, permissionsGranted: false }),
        resumeBlockedReason: 'PERMISSIONS_MISSING',
      }),
    );

    expect(visual.state).toBe('BLUETOOTH_OFF');
    expect(visual.action).toBe('enable-bluetooth');
    expect(visual.actionLabel).toBe('Turn on Bluetooth');
  });

  it('reports Bluetooth off ahead of a reported scan error', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: false }),
        scanError: 'BluetoothLE is powered off',
      }),
    );

    expect(visual.state).toBe('BLUETOOTH_OFF');
    expect(visual.action).toBe('enable-bluetooth');
  });

  it('reports Bluetooth off even when the user never asked for scanning', () => {
    const visual = deriveScannerUiState(
      input({ scanningEnabled: false, readiness: readiness({ bluetoothOn: false }) }),
    );

    expect(visual.state).toBe('BLUETOOTH_OFF');
    expect(visual.action).toBe('enable-bluetooth');
  });

  it('offers the same action either way, and only the wording follows the preference', () => {
    const wanted = deriveScannerUiState(
      input({ scanningEnabled: true, readiness: readiness({ bluetoothOn: false }) }),
    );
    const notWanted = deriveScannerUiState(
      input({ scanningEnabled: false, readiness: readiness({ bluetoothOn: false }) }),
    );

    expect(wanted.action).toBe(notWanted.action);
    expect(wanted.actionLabel).toBe(notWanted.actionLabel);
    expect(wanted.detail).not.toBe(notWanted.detail);
    expect(wanted.detail).toContain('resume');
  });

  it('does not claim Bluetooth is off before any readiness has been observed', () => {
    // readiness === null means "not checked yet", which is not evidence of anything.
    // Reporting BLUETOOTH_OFF here would be inventing an observation.
    const visual = deriveScannerUiState(input({ scanningEnabled: true, readiness: null }));

    expect(visual.state).not.toBe('BLUETOOTH_OFF');
    expect(visual.state).toBe('NEEDS_RESUME');
  });

  it('does not claim Bluetooth is off before readiness is observed, with scanning disabled', () => {
    const visual = deriveScannerUiState(input({ scanningEnabled: false, readiness: null }));

    expect(visual.state).toBe('IDLE');
  });

  it('treats an unauthorised adapter as Bluetooth off rather than as a scan error', () => {
    // Any not-ready adapter is the same story to the user: nothing else is fixable
    // until the radio is usable.
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: {
          ...readiness({ bluetoothOn: false }),
          bluetooth: {
            state: 'Unauthorized',
            available: false,
            ready: false,
            message: 'The app is not authorised to use Bluetooth.',
          },
        },
      }),
    );

    expect(visual.state).toBe('BLUETOOTH_OFF');
  });
});

describe('PERMISSION_REQUIRED', () => {
  it('asks for permissions when the resume was blocked on them', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true, permissionsGranted: false }),
        resumeBlockedReason: 'PERMISSIONS_MISSING',
      }),
    );

    expect(visual.state).toBe('PERMISSION_REQUIRED');
    expect(visual.action).toBe('grant-permissions');
    expect(visual.actionLabel).toBe('Allow permissions');
    expect(visual.tone).toBe('warning');
  });

  it('ranks the permission block above a reported scan error', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true, permissionsGranted: false }),
        resumeBlockedReason: 'PERMISSIONS_MISSING',
        scanError: 'Scan failed to start (code 2)',
      }),
    );

    expect(visual.state).toBe('PERMISSION_REQUIRED');
    expect(visual.action).toBe('grant-permissions');
  });

  it('does not nag for permissions when the user has scanning switched off', () => {
    // Nothing is broken from the user's point of view: they turned it off.
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: false,
        readiness: readiness({ bluetoothOn: true, permissionsGranted: false }),
        resumeBlockedReason: 'PERMISSIONS_MISSING',
      }),
    );

    expect(visual.state).toBe('IDLE');
    expect(visual.action).toBe('start');
  });
});

describe('ERROR', () => {
  it('shows the failure the radio actually reported, verbatim', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true }),
        scanError: 'Scan failed to start (code 2: APPLICATION_REGISTRATION_FAILED)',
      }),
    );

    expect(visual.state).toBe('ERROR');
    expect(visual.detail).toBe('Scan failed to start (code 2: APPLICATION_REGISTRATION_FAILED)');
    expect(visual.action).toBe('retry');
    expect(visual.actionLabel).toBe('Try again');
    expect(visual.tone).toBe('danger');
  });

  it('does not invent a cause when the failure arrived without a message', () => {
    // resumeBlockedReason FAILED but no error text: the honest answer is a generic
    // sentence, never a guessed-at cause the app did not observe.
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true }),
        resumeBlockedReason: 'FAILED',
        scanError: null,
      }),
    );

    expect(visual.state).toBe('ERROR');
    expect(visual.detail).toBe('Something went wrong while starting Bluetooth scanning.');
    expect(visual.detail).not.toMatch(/bluetooth is off|permission/i);
  });

  it('reports a phone that cannot scan as an error rather than as needing a resume', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true }),
        resumeBlockedReason: 'NOT_SUPPORTED',
      }),
    );

    expect(visual.state).toBe('ERROR');
    expect(visual.action).toBe('retry');
  });

  it('reports a scan error even before readiness has been observed', () => {
    const visual = deriveScannerUiState(
      input({ scanningEnabled: true, readiness: null, scanError: 'startScan threw' }),
    );

    expect(visual.state).toBe('ERROR');
    expect(visual.detail).toBe('startScan threw');
  });

  it('does not surface a stale error once the user has switched scanning off', () => {
    const visual = deriveScannerUiState(
      input({
        scanningEnabled: false,
        readiness: readiness({ bluetoothOn: true }),
        resumeBlockedReason: 'FAILED',
        scanError: 'Scan failed to start (code 2)',
      }),
    );

    expect(visual.state).toBe('IDLE');
    expect(visual.action).toBe('start');
  });
});

describe('NEEDS_RESUME — the preference wants scanning but the radio is idle', () => {
  it('reports NEEDS_RESUME when everything is fine but the radio is not scanning', () => {
    const visual = deriveScannerUiState(
      input({
        scanning: false,
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true, permissionsGranted: true }),
        resumeBlockedReason: null,
        scanError: null,
      }),
    );

    expect(visual.state).toBe('NEEDS_RESUME');
    expect(visual.action).toBe('resume');
    expect(visual.actionLabel).toBe('Resume scanning');
    expect(visual.detail).toBe('Scanning is enabled but is not currently running.');
  });

  it('never asks for a resume while the radio is already scanning', () => {
    // The same prerequisites, but the radio IS scanning: a resume prompt here is the
    // exact false claim the two screens used to disagree about.
    const visual = deriveScannerUiState(
      input({
        scanning: true,
        scanningEnabled: true,
        readiness: readiness({ bluetoothOn: true }),
      }),
    );

    expect(visual.state).toBe('ACTIVE');
  });

  it(
    'does not offer Resume when readiness has already observed that permissions are missing',
    () => {
      // REGRESSION GUARD. The adapter is on, permissions are NOT granted, and no
      // resume has been attempted yet (resumeBlockedReason === null). Permissions
      // used to be read only from resumeBlockedReason, so this offered "Resume
      // scanning" — a button that cannot resume — against an observation the app was
      // already holding. Permissions are now derived from readiness too, exactly as
      // Bluetooth always was.
      const visual = deriveScannerUiState(
        input({
          scanningEnabled: true,
          readiness: readiness({ bluetoothOn: true, permissionsGranted: false }),
          resumeBlockedReason: null,
        }),
      );

      expect(visual.state).toBe('PERMISSION_REQUIRED');
      expect(visual.action).toBe('grant-permissions');
    },
  );

  it(
    'does not offer Resume when the last resume was blocked because Bluetooth was off',
    () => {
      // REGRESSION GUARD. resumeBlockedReason has four values; BLUETOOTH_OFF used to
      // be handled nowhere. readiness is null until the first checkReadiness
      // resolves — the exact window in which the store records BLUETOOTH_OFF — so
      // this fell through to NEEDS_RESUME and offered to resume over a dead adapter.
      const visual = deriveScannerUiState(
        input({
          scanningEnabled: true,
          readiness: null,
          resumeBlockedReason: 'BLUETOOTH_OFF',
        }),
      );

      expect(visual.state).toBe('BLUETOOTH_OFF');
      expect(visual.action).toBe('enable-bluetooth');
    },
  );
});

describe('IDLE — the user intentionally has scanning off', () => {
  it('offers Start, not Resume, when the preference is off and the adapter is healthy', () => {
    const visual = deriveScannerUiState(
      input({ scanningEnabled: false, readiness: readiness({ bluetoothOn: true }) }),
    );

    expect(visual.state).toBe('IDLE');
    expect(visual.action).toBe('start');
    expect(visual.actionLabel).toBe('Start scanning');
    expect(visual.tone).toBe('neutral');
  });

  it('offers Start when nothing at all has been observed yet', () => {
    expect(deriveScannerUiState(input()).state).toBe('IDLE');
  });
});

describe('priority order', () => {
  it('reveals the next blocker only as each one above it is cleared', () => {
    const base = {
      scanning: false,
      scanningEnabled: true,
      resumeBlockedReason: 'PERMISSIONS_MISSING',
      scanError: 'Scan failed to start (code 2)',
    };

    // 1. Bluetooth down outranks everything.
    expect(
      deriveScannerUiState({
        ...base,
        readiness: readiness({ bluetoothOn: false, permissionsGranted: false }),
      }).state,
    ).toBe('BLUETOOTH_OFF');

    // 2. Bluetooth back on: permissions are next.
    const bluetoothFixed = {
      ...base,
      readiness: readiness({ bluetoothOn: true, permissionsGranted: false }),
    };
    expect(deriveScannerUiState(bluetoothFixed).state).toBe('PERMISSION_REQUIRED');

    // 3. Permissions granted: the reported failure surfaces.
    const permissionsFixed = {
      ...bluetoothFixed,
      readiness: readiness({ bluetoothOn: true, permissionsGranted: true }),
      resumeBlockedReason: null,
    };
    expect(deriveScannerUiState(permissionsFixed).state).toBe('ERROR');

    // 4. Failure cleared: the preference still wants scanning.
    const errorCleared = { ...permissionsFixed, scanError: null };
    expect(deriveScannerUiState(errorCleared).state).toBe('NEEDS_RESUME');

    // 5. Preference off: nothing is wrong at all.
    expect(deriveScannerUiState({ ...errorCleared, scanningEnabled: false }).state).toBe('IDLE');

    // 6. And the radio actually running outranks the lot.
    expect(deriveScannerUiState({ ...base, readiness: null, scanning: true }).state).toBe('ACTIVE');
  });
});

describe('state / action / actionLabel coherence across the whole input space', () => {
  /** Every input this function can be handed, enumerated rather than sampled. */
  const ALL_INPUTS: ScannerInput[] = [];
  for (const scanning of [false, true]) {
    for (const scanningEnabled of [false, true]) {
      for (const readinessValue of [
        null,
        readiness({ bluetoothOn: true, permissionsGranted: true }),
        readiness({ bluetoothOn: true, permissionsGranted: false }),
        readiness({ bluetoothOn: false, permissionsGranted: true }),
      ]) {
        for (const resumeBlockedReason of [
          null,
          'BLUETOOTH_OFF',
          'PERMISSIONS_MISSING',
          'NOT_SUPPORTED',
          'FAILED',
        ]) {
          for (const scanError of [null, 'Scan failed to start (code 2)']) {
            ALL_INPUTS.push({
              scanning,
              scanningEnabled,
              readiness: readinessValue,
              resumeBlockedReason,
              scanError,
            });
          }
        }
      }
    }
  }

  it('never returns an action or a label that disagrees with the state it reports', () => {
    for (const one of ALL_INPUTS) {
      const visual = deriveScannerUiState(one);

      expect({
        state: visual.state,
        action: visual.action,
        actionLabel: visual.actionLabel,
        tone: visual.tone,
        icon: visual.icon,
      }).toEqual({ state: visual.state, ...CONTRACT[visual.state] });
    }
  });

  it('never claims ACTIVE, and never offers Stop, unless the radio is scanning', () => {
    for (const one of ALL_INPUTS) {
      const visual = deriveScannerUiState(one);

      if (one.scanning) {
        expect(visual.state).toBe('ACTIVE');
      } else {
        expect(visual.state).not.toBe('ACTIVE');
        expect(visual.action).not.toBe('stop');
      }
    }
  });

  it('always answers with a non-empty title, detail and action label', () => {
    for (const one of ALL_INPUTS) {
      const visual = deriveScannerUiState(one);

      expect(visual.title.length).toBeGreaterThan(0);
      expect(visual.detail.length).toBeGreaterThan(0);
      expect(visual.actionLabel.length).toBeGreaterThan(0);
    }
  });

  it('can reach every state it declares, and declares every state it reaches', () => {
    const reached = new Set(ALL_INPUTS.map(one => deriveScannerUiState(one).state));

    expect([...reached].sort()).toEqual((Object.keys(CONTRACT) as ScannerUiState[]).sort());
  });
});

describe('purity', () => {
  it('gives the same answer twice for the same input', () => {
    const one = input({
      scanningEnabled: true,
      readiness: readiness({ bluetoothOn: true }),
      resumeBlockedReason: 'FAILED',
    });

    expect(deriveScannerUiState(one)).toEqual(deriveScannerUiState(one));
  });

  it('does not modify the input or the readiness report it was handed', () => {
    const one = input({
      scanning: true,
      scanningEnabled: true,
      readiness: readiness({ bluetoothOn: false, permissionsGranted: false }),
      resumeBlockedReason: 'PERMISSIONS_MISSING',
      scanError: 'Scan failed to start (code 2)',
    });
    const before = JSON.stringify(one);

    deriveScannerUiState(one);

    expect(JSON.stringify(one)).toBe(before);
  });
});
