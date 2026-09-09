/**
 * Unit tests for the GATT advertising policy.
 *
 * `computeAdvertisingPlan` decides whether a phone is discoverable at all, and
 * whether anyone can open a connection to it. Its failure mode is invisible:
 * you cannot tell from your own handset that you have stopped appearing on
 * other people's radar, or that you look reachable while hosting no service.
 * These tests are the only thing standing between a regression and a silent
 * one, so the input domain is enumerated rather than sampled.
 *
 * The domain is small and total: 3 platforms x 2 inEvent x 3 visibilities x
 * 2 acceptsConnectionRequests x 2 hasOutgoingRequest x 2 hasActiveInboundLink
 * x 3 iosSlice values (including `undefined`) = 432 inputs. Several invariants
 * below are asserted across all 432.
 *
 * Reason strings in the implementation contain U+2014 (em dash). They are
 * spelled with the escape here so the expectations survive any encoding
 * round-trip.
 *
 * ON SCANNING, because it is the one rule most likely to be "fixed" back:
 * `gattScanning` is on for every input that is IN AN EVENT, the `invisible`
 * branch included - scanning is receive-only, it emits nothing, so an
 * invisible user can still see the room and still reach out. It is off in
 * exactly two branches: not in an event, and the unsupported platform when
 * that branch is reached. `hasOutgoingRequest` does NOT gate it. It used to,
 * and that was a deadlock: a connection request cannot be created until the
 * target has been discovered, discovery only happens while scanning, and the
 * scan only ran once a request already existed, so Connect could never
 * succeed on any hardware.
 */

import type {
  AdvertisingPlan,
  AdvertisingPolicyInput,
  GattPlatform,
} from '../bluetooth/gatt/GattAdvertisingPolicy';
import {
  IOS_GATT_SLICE_MS,
  IOS_PRESENCE_SLICE_MS,
  advertisingPlansEqual,
  computeAdvertisingPlan,
  nextIosSlice,
} from '../bluetooth/gatt/GattAdvertisingPolicy';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

type Visibility = AdvertisingPolicyInput['visibility'];
type IosSlice = 'presence' | 'gatt';

const PLATFORMS: GattPlatform[] = ['android', 'ios', 'other'];
const VISIBILITIES: Visibility[] = ['visible', 'connections_only', 'invisible'];
/** The two non-invisible settings. Both are expected to broadcast. */
const BROADCASTING_VISIBILITIES: Visibility[] = ['visible', 'connections_only'];
const SLICES: IosSlice[] = ['presence', 'gatt'];
/** Every value the optional field can actually hold, `undefined` included. */
const SLICE_INPUTS: Array<IosSlice | undefined> = ['presence', 'gatt', undefined];
const BOOLS: boolean[] = [false, true];

/* Reason strings, spelled once so a typo cannot pass by agreeing with itself. */
const REASON_NOT_IN_EVENT = 'not in an event';
const REASON_INVISIBLE = 'invisible — broadcasting nothing';
const REASON_INBOUND_LINK = 'a connection request is in progress';
const REASON_BOTH_LIVE = 'presence and connections both live';
const REASON_PRESENCE_ONLY = 'presence only — not accepting requests';
const REASON_IOS_GATT_SLICE = 'reachable for connections (iOS takes turns with presence)';
const REASON_IOS_PRESENCE_SLICE = 'on the radar (iOS takes turns with connections)';
const REASON_UNSUPPORTED = 'Bluetooth is not supported on other';

const BASE: AdvertisingPolicyInput = {
  platform: 'android',
  inEvent: true,
  visibility: 'visible',
  acceptsConnectionRequests: true,
  hasOutgoingRequest: false,
  hasActiveInboundLink: false,
  iosSlice: 'presence',
};

function input(overrides: Partial<AdvertisingPolicyInput> = {}): AdvertisingPolicyInput {
  return { ...BASE, ...overrides };
}

/**
 * Every input the type admits, deduplicated. `overrides` pins one or more
 * fields, which collapses the cross product to the distinct inputs that agree
 * with those values.
 */
function everyInput(overrides: Partial<AdvertisingPolicyInput> = {}): AdvertisingPolicyInput[] {
  const byKey = new Map<string, AdvertisingPolicyInput>();
  for (const platform of PLATFORMS) {
    for (const inEvent of BOOLS) {
      for (const visibility of VISIBILITIES) {
        for (const acceptsConnectionRequests of BOOLS) {
          for (const hasOutgoingRequest of BOOLS) {
            for (const hasActiveInboundLink of BOOLS) {
              for (const iosSlice of SLICE_INPUTS) {
                const candidate: AdvertisingPolicyInput = {
                  platform,
                  inEvent,
                  visibility,
                  acceptsConnectionRequests,
                  hasOutgoingRequest,
                  hasActiveInboundLink,
                  iosSlice,
                  ...overrides,
                };
                byKey.set(label(candidate), candidate);
              }
            }
          }
        }
      }
    }
  }
  return [...byKey.values()];
}

/** A stable one-line label so a sweep failure names the exact input. */
function label(i: AdvertisingPolicyInput): string {
  return [
    i.platform,
    i.inEvent ? 'inEvent' : 'notInEvent',
    i.visibility,
    i.acceptsConnectionRequests ? 'accepts' : 'refuses',
    i.hasOutgoingRequest ? 'outgoing' : 'noOutgoing',
    i.hasActiveInboundLink ? 'inbound' : 'noInbound',
    `slice=${String(i.iosSlice)}`,
  ].join('/');
}

/** The three radio booleans, rendered for readable bulk comparison. */
function radio(i: AdvertisingPolicyInput): string {
  const p = computeAdvertisingPlan(i);
  return `presence=${p.presenceAdvertising} peripheral=${p.gattPeripheral} scanning=${p.gattScanning}`;
}

function plan(overrides: Partial<AdvertisingPolicyInput> = {}): AdvertisingPlan {
  return computeAdvertisingPlan(input(overrides));
}

const ALL_INPUTS = everyInput();

describe('the harness enumerates the whole input domain', () => {
  it('produces exactly 432 distinct inputs, so the sweeps below are exhaustive', () => {
    expect(ALL_INPUTS).toHaveLength(432);
    expect(new Set(ALL_INPUTS.map(label)).size).toBe(432);
  });
});

/* ------------------------------------------------------------------ */
/* Outside an event                                                    */
/* ------------------------------------------------------------------ */

describe('outside an event nothing touches the radio', () => {
  const OFF: AdvertisingPlan = {
    presenceAdvertising: false,
    gattPeripheral: false,
    gattScanning: false,
    reason: REASON_NOT_IN_EVENT,
  };

  it.each(PLATFORMS)('returns the everything-off plan on %s', (platform) => {
    expect(computeAdvertisingPlan(input({ platform, inEvent: false }))).toEqual(OFF);
  });

  it('returns the everything-off plan for all 216 not-in-an-event inputs', () => {
    const candidates = everyInput({ inEvent: false });
    expect(candidates).toHaveLength(216);
    const offenders = candidates
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return (
          p.presenceAdvertising ||
          p.gattPeripheral ||
          p.gattScanning ||
          p.reason !== REASON_NOT_IN_EVENT
        );
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('does not scan for a not-in-an-event user who has an outgoing request', () => {
    expect(plan({ inEvent: false, hasOutgoingRequest: true }).gattScanning).toBe(false);
  });

  it('does not host a peripheral for a not-in-an-event user with an inbound link', () => {
    expect(plan({ inEvent: false, hasActiveInboundLink: true }).gattPeripheral).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Invisible                                                           */
/* ------------------------------------------------------------------ */

describe('invisible silences every transmitter', () => {
  it.each(PLATFORMS)('turns presence and the GATT peripheral off on %s', (platform) => {
    const p = plan({ platform, visibility: 'invisible' });
    expect(p.presenceAdvertising).toBe(false);
    expect(p.gattPeripheral).toBe(false);
    expect(p.reason).toBe(REASON_INVISIBLE);
  });

  it('leaves an invisible phone unreachable over a connectable GATT service, even when it accepts requests', () => {
    // The whole point of the setting: a phone that stopped beaconing but still
    // hosted a connectable service would remain discoverable, which is exactly
    // what the user asked it not to be.
    const observed: string[] = [];
    const expected: string[] = [];
    for (const platform of PLATFORMS) {
      for (const iosSlice of SLICE_INPUTS) {
        const p = computeAdvertisingPlan(
          input({
            platform,
            visibility: 'invisible',
            acceptsConnectionRequests: true,
            hasActiveInboundLink: true,
            iosSlice,
          }),
        );
        const key = `${platform}/${String(iosSlice)}`;
        observed.push(`${key}: peripheral=${p.gattPeripheral}`);
        expected.push(`${key}: peripheral=false`);
      }
    }
    expect(observed).toEqual(expected);
  });

  it('turns both transmitters off for all 72 invisible in-event inputs', () => {
    const candidates = everyInput({ inEvent: true, visibility: 'invisible' });
    expect(candidates).toHaveLength(72);
    const offenders = candidates
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return p.presenceAdvertising || p.gattPeripheral || p.reason !== REASON_INVISIBLE;
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('scans while invisible when a request is outstanding, because receiving emits nothing', () => {
    // Pinned with the flag true only to show the flag does not SUPPRESS the
    // scan; the sibling test below pins the identical plan with it false.
    expect(plan({ visibility: 'invisible', hasOutgoingRequest: true })).toEqual({
      presenceAdvertising: false,
      gattPeripheral: false,
      gattScanning: true,
      reason: REASON_INVISIBLE,
    });
  });

  it('scans while invisible even with no outgoing request', () => {
    // hasOutgoingRequest deliberately no longer gates scanning. Coupling them
    // was a deadlock: a request cannot exist until its target has been
    // discovered, discovery only happens while scanning, and scanning only ran
    // once a request existed - Connect could never succeed. Do not restore it.
    expect(plan({ visibility: 'invisible', hasOutgoingRequest: false })).toEqual({
      presenceAdvertising: false,
      gattPeripheral: false,
      gattScanning: true,
      reason: REASON_INVISIBLE,
    });
  });

  it.each(PLATFORMS)(
    'scans while invisible on %s regardless of whether a request is outstanding',
    (platform) => {
      // Both settings must scan. `other` is included on purpose: the invisible
      // branch returns before the platform check, so it scans here too.
      expect(
        plan({ platform, visibility: 'invisible', hasOutgoingRequest: true }).gattScanning,
      ).toBe(true);
      expect(
        plan({ platform, visibility: 'invisible', hasOutgoingRequest: false }).gattScanning,
      ).toBe(true);
    },
  );

  it('outranks an active inbound link: going invisible mid-handshake still stops the peripheral', () => {
    // The invisible branch is checked before the inbound-link branch, so the
    // user's own choice wins over a handshake someone else started. Both
    // TRANSMITTERS stop; the receive-only scan does not, because it emits
    // nothing that could give the user away.
    expect(
      plan({ platform: 'android', visibility: 'invisible', hasActiveInboundLink: true }),
    ).toEqual({
      presenceAdvertising: false,
      gattPeripheral: false,
      gattScanning: true,
      reason: REASON_INVISIBLE,
    });
  });
});

/* ------------------------------------------------------------------ */
/* connections_only is not invisible                                   */
/* ------------------------------------------------------------------ */

describe('connections_only broadcasts exactly like visible', () => {
  // OBSERVED BEHAVIOUR, and it matches the rest of the app: `connections_only`
  // does not silence the radio. AttendeeDirectory filters who is shown
  // (AttendeeDirectory.ts:231) and PrivacyService keeps advertising for this
  // setting too. Only `invisible` stops the transmitter.
  it('produces an identical plan to visible for every other input combination', () => {
    const differences: string[] = [];
    for (const i of everyInput({ visibility: 'visible' })) {
      const asVisible = computeAdvertisingPlan(i);
      const asConnectionsOnly = computeAdvertisingPlan({ ...i, visibility: 'connections_only' });
      if (JSON.stringify(asVisible) !== JSON.stringify(asConnectionsOnly)) {
        differences.push(label(i));
      }
    }
    expect(differences).toEqual([]);
  });

  it('keeps a connections_only phone on the radar', () => {
    expect(plan({ visibility: 'connections_only' }).presenceAdvertising).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Android                                                             */
/* ------------------------------------------------------------------ */

describe('Android runs presence and the GATT peripheral together', () => {
  it('advertises both when the user accepts connection requests', () => {
    expect(plan({ platform: 'android', acceptsConnectionRequests: true })).toEqual({
      presenceAdvertising: true,
      gattPeripheral: true,
      gattScanning: true,
      reason: REASON_BOTH_LIVE,
    });
  });

  it('drops the peripheral but keeps presence when the user is not accepting requests', () => {
    expect(plan({ platform: 'android', acceptsConnectionRequests: false })).toEqual({
      presenceAdvertising: true,
      gattPeripheral: false,
      // Refusing INBOUND requests says nothing about looking for other people,
      // so the scan stays up.
      gattScanning: true,
      reason: REASON_PRESENCE_ONLY,
    });
  });

  it('keeps presence on for every non-invisible in-event Android input', () => {
    const offenders = ALL_INPUTS.filter(
      (i) => i.platform === 'android' && i.inEvent && i.visibility !== 'invisible',
    )
      .filter((i) => !computeAdvertisingPlan(i).presenceAdvertising)
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('ties the peripheral to acceptsConnectionRequests when no handshake is running', () => {
    const observed: string[] = [];
    const expected: string[] = [];
    for (const visibility of BROADCASTING_VISIBILITIES) {
      for (const accepts of BOOLS) {
        const p = plan({
          platform: 'android',
          visibility,
          acceptsConnectionRequests: accepts,
          hasActiveInboundLink: false,
        });
        observed.push(`${visibility}/accepts=${accepts}: peripheral=${p.gattPeripheral}`);
        expected.push(`${visibility}/accepts=${accepts}: peripheral=${accepts}`);
      }
    }
    expect(observed).toEqual(expected);
  });

  it('scans throughout an event regardless of whether a request is outstanding, across every non-invisible in-event Android input', () => {
    // This once asserted `gattScanning === i.hasOutgoingRequest`. That was the
    // deadlock: a request cannot be created until the target has been
    // discovered, discovery only happens while scanning, and scanning only ran
    // once a request existed, so Connect never succeeded on real hardware. The
    // scan is what MAKES a request possible, so it cannot wait for one.
    const candidates = ALL_INPUTS.filter(
      (i) => i.platform === 'android' && i.inEvent && i.visibility !== 'invisible',
    );
    expect(candidates).toHaveLength(48);
    const offenders = candidates.filter((i) => !computeAdvertisingPlan(i).gattScanning).map(label);
    expect(offenders).toEqual([]);
  });

  it('ignores iosSlice entirely', () => {
    const forPresence = plan({ platform: 'android', iosSlice: 'presence' });
    expect(plan({ platform: 'android', iosSlice: 'gatt' })).toEqual(forPresence);
    expect(plan({ platform: 'android', iosSlice: undefined })).toEqual(forPresence);
  });

  it('ignores iosSlice for every Android input, handshakes included', () => {
    const offenders: string[] = [];
    for (const i of everyInput({ platform: 'android', iosSlice: 'presence' })) {
      const baseline = JSON.stringify(computeAdvertisingPlan(i));
      for (const iosSlice of SLICE_INPUTS) {
        if (JSON.stringify(computeAdvertisingPlan({ ...i, iosSlice })) !== baseline) {
          offenders.push(`${label(i)} -> slice=${String(iosSlice)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* iOS                                                                 */
/* ------------------------------------------------------------------ */

describe('iOS is a genuine either/or', () => {
  it('keeps presence up and the peripheral down when the user is not accepting requests', () => {
    for (const iosSlice of SLICE_INPUTS) {
      expect(
        computeAdvertisingPlan(
          input({ platform: 'ios', acceptsConnectionRequests: false, iosSlice }),
        ),
      ).toEqual({
        presenceAdvertising: true,
        gattPeripheral: false,
        gattScanning: true,
        reason: REASON_PRESENCE_ONLY,
      });
    }
  });

  it('spends the presence slice on the beacon only', () => {
    expect(
      plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: 'presence' }),
    ).toEqual({
      presenceAdvertising: true,
      gattPeripheral: false,
      // The slice schedule governs the single iOS ADVERTISEMENT only. Scanning
      // is a separate radio role and runs across both slices.
      gattScanning: true,
      reason: REASON_IOS_PRESENCE_SLICE,
    });
  });

  it('spends the gatt slice on the connectable service only — the exact inverse', () => {
    expect(plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: 'gatt' })).toEqual({
      presenceAdvertising: false,
      gattPeripheral: true,
      gattScanning: true,
      reason: REASON_IOS_GATT_SLICE,
    });
  });

  it('makes the two slices exact mirror images of each other', () => {
    const onPresence = plan({
      platform: 'ios',
      acceptsConnectionRequests: true,
      iosSlice: 'presence',
    });
    const onGatt = plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: 'gatt' });
    expect(onPresence.presenceAdvertising).toBe(!onGatt.presenceAdvertising);
    expect(onPresence.gattPeripheral).toBe(!onGatt.gattPeripheral);
    expect(onPresence.presenceAdvertising).toBe(!onPresence.gattPeripheral);
    expect(onGatt.presenceAdvertising).toBe(!onGatt.gattPeripheral);
  });

  it('favours presence when no slice has been set, because being invisible is the worse failure', () => {
    expect(plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: undefined })).toEqual({
      presenceAdvertising: true,
      gattPeripheral: false,
      gattScanning: true,
      reason: REASON_IOS_PRESENCE_SLICE,
    });
  });

  it('treats an unset slice exactly like the presence slice', () => {
    expect(plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: undefined })).toEqual(
      plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: 'presence' }),
    );
  });

  it('never advertises presence and the GATT peripheral at the same time, for any input', () => {
    // The hard iOS constraint: CBPeripheralManager.startAdvertising replaces
    // whatever was being advertised, so a plan asking for both would silently
    // drop one of them.
    const candidates = ALL_INPUTS.filter((i) => i.platform === 'ios');
    expect(candidates).toHaveLength(144);
    const offenders = candidates
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return p.presenceAdvertising && p.gattPeripheral;
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('scans throughout an event regardless of whether a request is outstanding, across every non-invisible in-event iOS input', () => {
    // Same deadlock as the Android sweep above: scanning is what makes a
    // request possible in the first place, so it cannot be gated on one.
    // hasOutgoingRequest is deliberately not consulted here.
    const candidates = ALL_INPUTS.filter(
      (i) => i.platform === 'ios' && i.inEvent && i.visibility !== 'invisible',
    );
    expect(candidates).toHaveLength(48);
    const offenders = candidates.filter((i) => !computeAdvertisingPlan(i).gattScanning).map(label);
    expect(offenders).toEqual([]);
  });

  it('scans on the gatt slice too, so the turn-taking schedule never blinds the scanner', () => {
    const onGattSlice: AdvertisingPlan = {
      presenceAdvertising: false,
      gattPeripheral: true,
      gattScanning: true,
      reason: REASON_IOS_GATT_SLICE,
    };
    expect(
      plan({
        platform: 'ios',
        acceptsConnectionRequests: true,
        iosSlice: 'gatt',
        hasOutgoingRequest: true,
      }),
    ).toEqual(onGattSlice);
    // ...and identically with no request outstanding: the flag deliberately no
    // longer gates scanning, because the scan is the only way a request can
    // ever come to exist.
    expect(
      plan({
        platform: 'ios',
        acceptsConnectionRequests: true,
        iosSlice: 'gatt',
        hasOutgoingRequest: false,
      }),
    ).toEqual(onGattSlice);
  });
});

/* ------------------------------------------------------------------ */
/* An active inbound link                                              */
/* ------------------------------------------------------------------ */

describe('an active inbound link keeps the peripheral up', () => {
  it.each(SLICE_INPUTS)('holds the iOS peripheral up regardless of the slice (%s)', (iosSlice) => {
    expect(
      computeAdvertisingPlan(input({ platform: 'ios', hasActiveInboundLink: true, iosSlice })),
    ).toEqual({
      presenceAdvertising: false,
      gattPeripheral: true,
      gattScanning: true,
      reason: REASON_INBOUND_LINK,
    });
  });

  it('keeps Android presence up alongside the peripheral during a handshake', () => {
    expect(plan({ platform: 'android', hasActiveInboundLink: true })).toEqual({
      presenceAdvertising: true,
      gattPeripheral: true,
      gattScanning: true,
      reason: REASON_INBOUND_LINK,
    });
  });

  it('holds the peripheral up even when the user has stopped accepting new requests', () => {
    // The request is already in flight; dropping the peripheral now would
    // strand it.
    const observed: string[] = [];
    const expected: string[] = [];
    for (const platform of ['android', 'ios'] as const) {
      const p = plan({ platform, acceptsConnectionRequests: false, hasActiveInboundLink: true });
      observed.push(`${platform}: peripheral=${p.gattPeripheral} reason=${p.reason}`);
      expected.push(`${platform}: peripheral=true reason=${REASON_INBOUND_LINK}`);
    }
    expect(observed).toEqual(expected);
  });

  it('holds the peripheral up for every non-invisible in-event handshake on a supported platform', () => {
    const offenders = ALL_INPUTS.filter(
      (i) =>
        i.hasActiveInboundLink &&
        i.inEvent &&
        i.visibility !== 'invisible' &&
        (i.platform === 'android' || i.platform === 'ios'),
    )
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return !p.gattPeripheral || p.reason !== REASON_INBOUND_LINK;
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('makes presence during a handshake a function of the platform alone, never the slice', () => {
    const offenders: string[] = [];
    for (const i of ALL_INPUTS) {
      if (!i.hasActiveInboundLink || !i.inEvent || i.visibility === 'invisible') continue;
      const p = computeAdvertisingPlan(i);
      if (p.presenceAdvertising !== (i.platform === 'android')) offenders.push(label(i));
    }
    expect(offenders).toEqual([]);
  });

  it('scans during a handshake whether or not there is also an outgoing request', () => {
    // Answering someone else's request does not stop us looking for people of
    // our own, and hasOutgoingRequest deliberately no longer gates the scan:
    // gating it deadlocked discovery, since a request can only be created for
    // a device a scan has already found.
    expect(
      plan({ platform: 'ios', hasActiveInboundLink: true, hasOutgoingRequest: true }).gattScanning,
    ).toBe(true);
    expect(
      plan({ platform: 'android', hasActiveInboundLink: true, hasOutgoingRequest: false })
        .gattScanning,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Unsupported platform                                                */
/* ------------------------------------------------------------------ */

describe('an unsupported platform gets nothing', () => {
  it('turns everything off and names the platform in the reason', () => {
    const p = plan({ platform: 'other', acceptsConnectionRequests: true, hasOutgoingRequest: true });
    expect(p).toEqual({
      presenceAdvertising: false,
      gattPeripheral: false,
      gattScanning: false,
      reason: REASON_UNSUPPORTED,
    });
    expect(p.reason).toContain('other');
  });

  it('turns everything off for every in-event input that reaches the platform check', () => {
    // i.e. every `other` input not short-circuited earlier by `invisible` or by
    // an active inbound link.
    const offenders = ALL_INPUTS.filter(
      (i) =>
        i.platform === 'other' &&
        i.inEvent &&
        i.visibility !== 'invisible' &&
        !i.hasActiveInboundLink,
    )
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return (
          p.presenceAdvertising ||
          p.gattPeripheral ||
          p.gattScanning ||
          p.reason !== REASON_UNSUPPORTED
        );
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('never advertises presence on an unsupported platform, whatever else is true', () => {
    const offenders = ALL_INPUTS.filter((i) => i.platform === 'other')
      .filter((i) => computeAdvertisingPlan(i).presenceAdvertising)
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('asks for a peripheral on an unsupported platform only while a handshake is already running', () => {
    // OBSERVED BEHAVIOUR, recorded rather than asserted as desirable: the
    // active-inbound-link branch (GattAdvertisingPolicy.ts:102) returns before
    // the platform check at GattAdvertisingPolicy.ts:144, so an `other` device
    // carrying an inbound link is handed `gattPeripheral: true`. Not reachable
    // in the app - the only caller, applyAdvertisingPlan in
    // runtime/services.ts:793, returns early unless a transport probed
    // available, and no inbound link can exist without one - so this is a
    // branch-ordering artefact, not a live defect. Pinned so that any change to
    // the ordering surfaces here.
    expect(plan({ platform: 'other', hasActiveInboundLink: true })).toEqual({
      presenceAdvertising: false,
      gattPeripheral: true,
      // The same branch-ordering artefact reaches the scan: the inbound-link
      // branch returns before the platform check, so this unreachable input
      // scans as well.
      gattScanning: true,
      reason: REASON_INBOUND_LINK,
    });
    expect(plan({ platform: 'other', hasActiveInboundLink: false }).gattPeripheral).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Every plan explains itself                                          */
/* ------------------------------------------------------------------ */

describe('every plan explains itself', () => {
  it('returns a non-empty reason for all 432 inputs', () => {
    const offenders = ALL_INPUTS.filter((i) => {
      const { reason } = computeAdvertisingPlan(i);
      return typeof reason !== 'string' || reason.trim().length === 0;
    }).map(label);
    expect(offenders).toEqual([]);
  });

  it('draws every reason from the eight documented strings, and uses all eight', () => {
    const seen = [...new Set(ALL_INPUTS.map((i) => computeAdvertisingPlan(i).reason))].sort();
    expect(seen).toEqual(
      [
        REASON_NOT_IN_EVENT,
        REASON_INVISIBLE,
        REASON_INBOUND_LINK,
        REASON_BOTH_LIVE,
        REASON_PRESENCE_ONLY,
        REASON_IOS_GATT_SLICE,
        REASON_IOS_PRESENCE_SLICE,
        REASON_UNSUPPORTED,
      ].sort(),
    );
  });

  it('returns a fresh plan object on every call, so a caller may keep the previous one', () => {
    const i = input();
    const first = computeAdvertisingPlan(i);
    const second = computeAdvertisingPlan(i);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('does not mutate the input it was given', () => {
    const i = input({ platform: 'ios', iosSlice: 'gatt' });
    const before = JSON.stringify(i);
    computeAdvertisingPlan(i);
    expect(JSON.stringify(i)).toBe(before);
  });

  it('is deterministic across the whole domain', () => {
    const offenders = ALL_INPUTS.filter(
      (i) => JSON.stringify(computeAdvertisingPlan(i)) !== JSON.stringify(computeAdvertisingPlan(i)),
    ).map(label);
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The iOS slice schedule                                              */
/* ------------------------------------------------------------------ */

describe('nextIosSlice alternates on the documented schedule', () => {
  it('exports 8000 ms for presence and 4000 ms for gatt', () => {
    expect(IOS_PRESENCE_SLICE_MS).toBe(8000);
    expect(IOS_GATT_SLICE_MS).toBe(4000);
  });

  it('gives presence the longer slice, because presence is the default the design favours', () => {
    expect(IOS_PRESENCE_SLICE_MS).toBeGreaterThan(IOS_GATT_SLICE_MS);
    expect(nextIosSlice('gatt').durationMs).toBeGreaterThan(nextIosSlice('presence').durationMs);
  });

  it('moves from presence to gatt for the gatt duration', () => {
    expect(nextIosSlice('presence')).toEqual({ slice: 'gatt', durationMs: IOS_GATT_SLICE_MS });
    expect(nextIosSlice('presence').durationMs).toBe(4000);
  });

  it('moves from gatt to presence for the presence duration', () => {
    expect(nextIosSlice('gatt')).toEqual({ slice: 'presence', durationMs: IOS_PRESENCE_SLICE_MS });
    expect(nextIosSlice('gatt').durationMs).toBe(8000);
  });

  it('returns the duration of the slice it is entering, not the one it is leaving', () => {
    expect(nextIosSlice('presence').slice).toBe('gatt');
    expect(nextIosSlice('presence').durationMs).toBe(IOS_GATT_SLICE_MS);
    expect(nextIosSlice('gatt').slice).toBe('presence');
    expect(nextIosSlice('gatt').durationMs).toBe(IOS_PRESENCE_SLICE_MS);
  });

  it('strictly alternates over six advances and returns to where it started', () => {
    let current: IosSlice = 'presence';
    const visited: IosSlice[] = [];
    const durations: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      const next = nextIosSlice(current);
      visited.push(next.slice);
      durations.push(next.durationMs);
      current = next.slice;
    }
    expect(visited).toEqual(['gatt', 'presence', 'gatt', 'presence', 'gatt', 'presence']);
    expect(durations).toEqual([4000, 8000, 4000, 8000, 4000, 8000]);
    expect(current).toBe('presence');
  });

  it('never returns the slice it was handed', () => {
    for (const slice of SLICES) {
      expect(nextIosSlice(slice).slice).not.toBe(slice);
    }
  });

  it('completes one full cycle in 12000 ms', () => {
    expect(nextIosSlice('presence').durationMs + nextIosSlice('gatt').durationMs).toBe(12000);
  });

  it('returns a fresh object each call and holds no hidden state', () => {
    const first = nextIosSlice('presence');
    const second = nextIosSlice('presence');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('feeds computeAdvertisingPlan: advancing the slice flips which transmitter is live', () => {
    let current: IosSlice = 'presence';
    const onPresenceSlice = plan({
      platform: 'ios',
      acceptsConnectionRequests: true,
      iosSlice: current,
    });
    current = nextIosSlice(current).slice;
    const onGattSlice = plan({
      platform: 'ios',
      acceptsConnectionRequests: true,
      iosSlice: current,
    });
    expect([onPresenceSlice.presenceAdvertising, onPresenceSlice.gattPeripheral]).toEqual([
      true,
      false,
    ]);
    expect([onGattSlice.presenceAdvertising, onGattSlice.gattPeripheral]).toEqual([false, true]);
  });
});

/* ------------------------------------------------------------------ */
/* Plan comparison                                                     */
/* ------------------------------------------------------------------ */

describe('advertisingPlansEqual compares the requested radio state', () => {
  const REFERENCE: AdvertisingPlan = {
    presenceAdvertising: true,
    gattPeripheral: false,
    gattScanning: true,
    reason: 'a reason',
  };

  it('is true for two identical plans', () => {
    expect(advertisingPlansEqual(REFERENCE, { ...REFERENCE })).toBe(true);
  });

  it('is true for a plan compared with itself', () => {
    expect(advertisingPlansEqual(REFERENCE, REFERENCE)).toBe(true);
  });

  it('is false when presenceAdvertising differs', () => {
    expect(advertisingPlansEqual(REFERENCE, { ...REFERENCE, presenceAdvertising: false })).toBe(
      false,
    );
  });

  it('is false when gattPeripheral differs', () => {
    expect(advertisingPlansEqual(REFERENCE, { ...REFERENCE, gattPeripheral: true })).toBe(false);
  });

  it('is false when gattScanning differs', () => {
    expect(advertisingPlansEqual(REFERENCE, { ...REFERENCE, gattScanning: false })).toBe(false);
  });

  it('is false when more than one boolean differs', () => {
    expect(
      advertisingPlansEqual(REFERENCE, {
        ...REFERENCE,
        presenceAdvertising: false,
        gattScanning: false,
      }),
    ).toBe(false);
  });

  it('IGNORES reason: same booleans and different words compare equal', () => {
    // OBSERVED BEHAVIOUR, and deliberate per the doc comment - the function
    // answers "does the radio need reconfiguring", and the reason string is
    // display text, not radio state. A caller that wants to refresh a status
    // strip when only the wording changes cannot use this function.
    expect(
      advertisingPlansEqual(REFERENCE, { ...REFERENCE, reason: 'completely different words' }),
    ).toBe(true);
    expect(advertisingPlansEqual(REFERENCE, { ...REFERENCE, reason: '' })).toBe(true);
  });

  it('matches a boolean-triple comparison exactly, for all 64 ordered pairs of plans', () => {
    const triples: AdvertisingPlan[] = [];
    for (const presenceAdvertising of BOOLS) {
      for (const gattPeripheral of BOOLS) {
        for (const gattScanning of BOOLS) {
          triples.push({
            presenceAdvertising,
            gattPeripheral,
            gattScanning,
            // Distinct reasons throughout, so any reason-sensitivity shows up.
            reason: `${presenceAdvertising}/${gattPeripheral}/${gattScanning}`,
          });
        }
      }
    }
    expect(triples).toHaveLength(8);
    const offenders: string[] = [];
    let pairs = 0;
    for (const a of triples) {
      for (const b of triples) {
        pairs += 1;
        const sameRadio =
          a.presenceAdvertising === b.presenceAdvertising &&
          a.gattPeripheral === b.gattPeripheral &&
          a.gattScanning === b.gattScanning;
        if (advertisingPlansEqual(a, b) !== sameRadio) offenders.push(`${a.reason} vs ${b.reason}`);
        if (advertisingPlansEqual(a, b) !== advertisingPlansEqual(b, a)) {
          offenders.push(`asymmetric: ${a.reason} vs ${b.reason}`);
        }
      }
    }
    expect(pairs).toBe(64);
    expect(offenders).toEqual([]);
  });

  it('agrees with a booleans-only comparison across every pair of real plans', () => {
    const plans = ALL_INPUTS.map((i) => computeAdvertisingPlan(i));
    const offenders: string[] = [];
    for (let x = 0; x < plans.length; x += 1) {
      for (let y = 0; y < plans.length; y += 1) {
        const a = plans[x];
        const b = plans[y];
        const sameRadio =
          a.presenceAdvertising === b.presenceAdvertising &&
          a.gattPeripheral === b.gattPeripheral &&
          a.gattScanning === b.gattScanning;
        if (advertisingPlansEqual(a, b) !== sameRadio) {
          offenders.push(`${label(ALL_INPUTS[x])} vs ${label(ALL_INPUTS[y])}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reports a real change: going invisible while accepting requests is not equal to the previous plan', () => {
    const before = plan({ platform: 'android', acceptsConnectionRequests: true });
    const after = plan({
      platform: 'android',
      acceptsConnectionRequests: true,
      visibility: 'invisible',
    });
    expect(advertisingPlansEqual(before, after)).toBe(false);
  });

  it('reports no change across an iOS slice flip for a user who is not accepting requests', () => {
    // Not reachable means no turn-taking, so the slice timer must not churn the
    // radio.
    const onPresence = plan({
      platform: 'ios',
      acceptsConnectionRequests: false,
      iosSlice: 'presence',
    });
    const onGatt = plan({ platform: 'ios', acceptsConnectionRequests: false, iosSlice: 'gatt' });
    expect(advertisingPlansEqual(onPresence, onGatt)).toBe(true);
  });

  it('reports a change across an iOS slice flip for a user who is accepting requests', () => {
    const onPresence = plan({
      platform: 'ios',
      acceptsConnectionRequests: true,
      iosSlice: 'presence',
    });
    const onGatt = plan({ platform: 'ios', acceptsConnectionRequests: true, iosSlice: 'gatt' });
    expect(advertisingPlansEqual(onPresence, onGatt)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Cross-cutting safety invariants                                     */
/* ------------------------------------------------------------------ */

describe('safety invariants that hold across the whole domain', () => {
  it('never advertises anything while the user is invisible or out of an event', () => {
    const offenders = ALL_INPUTS.filter((i) => !i.inEvent || i.visibility === 'invisible')
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return p.presenceAdvertising || p.gattPeripheral;
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('keeps at least one transmitter live for every in-event, non-invisible user on a real platform', () => {
    // The invisible failure mode: a supported phone inside an event that has
    // not asked to disappear must always be findable one way or the other.
    const offenders = ALL_INPUTS.filter(
      (i) =>
        (i.platform === 'android' || i.platform === 'ios') &&
        i.inEvent &&
        i.visibility !== 'invisible',
    )
      .filter((i) => {
        const p = computeAdvertisingPlan(i);
        return !p.presenceAdvertising && !p.gattPeripheral;
      })
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('never hosts a connectable service for a user who refuses requests and has no link', () => {
    const offenders = ALL_INPUTS.filter(
      (i) => !i.acceptsConnectionRequests && !i.hasActiveInboundLink,
    )
      .filter((i) => computeAdvertisingPlan(i).gattPeripheral)
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('scans for every in-event input on a supported platform, request outstanding or not', () => {
    // Replaces an older invariant, "never scans without an outgoing request".
    // That coupling was the deadlock: a connection request cannot be created
    // until the target device has been discovered, discovery only happens
    // while scanning, and scanning only ran once a request already existed, so
    // Connect could never succeed on any hardware. hasOutgoingRequest is still
    // an input and still documented, but nothing reads it for this decision -
    // do not "restore" the coupling.
    const candidates = ALL_INPUTS.filter(
      (i) => (i.platform === 'android' || i.platform === 'ios') && i.inEvent,
    );
    expect(candidates).toHaveLength(144);
    const offenders = candidates.filter((i) => !computeAdvertisingPlan(i).gattScanning).map(label);
    expect(offenders).toEqual([]);
  });

  it('never scans outside an event, whatever else is true', () => {
    // The other half of the rule: the scan is on iff we are in an event, bar
    // the unsupported platform, which is pinned in its own describe above.
    const offenders = ALL_INPUTS.filter((i) => !i.inEvent)
      .filter((i) => computeAdvertisingPlan(i).gattScanning)
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('ignores hasOutgoingRequest entirely: flipping it never changes any plan', () => {
    // The strongest form of the new contract, and the test that will fail
    // loudest if anyone re-couples the flag to scanning.
    const offenders: string[] = [];
    for (const i of ALL_INPUTS) {
      const withRequest = JSON.stringify(computeAdvertisingPlan({ ...i, hasOutgoingRequest: true }));
      const withoutRequest = JSON.stringify(
        computeAdvertisingPlan({ ...i, hasOutgoingRequest: false }),
      );
      if (withRequest !== withoutRequest) offenders.push(label(i));
    }
    expect(offenders).toEqual([]);
  });

  it('produces the same radio state on non-iOS platforms whatever the slice says', () => {
    const offenders: string[] = [];
    for (const i of ALL_INPUTS) {
      if (i.platform === 'ios' || i.iosSlice !== 'presence') continue;
      const baseline = radio(i);
      for (const iosSlice of SLICE_INPUTS) {
        const observed = radio({ ...i, iosSlice });
        if (observed !== baseline) {
          offenders.push(`${label(i)} -> slice=${String(iosSlice)}: ${observed} != ${baseline}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
