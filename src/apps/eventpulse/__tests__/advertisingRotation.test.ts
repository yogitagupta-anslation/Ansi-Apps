/**
 * Re-applying advertising when the peer id rotates, and only then.
 *
 * The bug this pins was measured on two emulators. Both phones started, both
 * advertised correctly, and both connected. Fifteen minutes later the rotating
 * peer id changed on the presence radar — but the plan's three booleans did
 * not, so the apply was skipped and the GATT advertisement kept broadcasting
 * the peer id from startup. From that moment the radar said one thing and the
 * advertisement said another:
 *
 *   correlation  peerId=27EAE15E  advertised=4E32D908  -> device NOT found
 *
 * Every Connect after that reported the person unreachable while their phone
 * was advertising perfectly well, under a name nobody was looking for.
 *
 * The cost of over-correcting is real too: restarting the advertiser tears the
 * advertisement down and puts it back, so doing it on every tick would make the
 * device intermittently invisible. Hence "and only then".
 */

import {
  advertisingPlansEqual,
  advertisingUnchanged,
  type AdvertisingPlan,
  type AppliedAdvertising,
} from '../bluetooth/gatt/GattAdvertisingPolicy';

const HOSTING: AdvertisingPlan = {
  presenceAdvertising: true,
  gattPeripheral: true,
  gattScanning: true,
  reason: 'presence and connections both live',
};

const SCAN_ONLY: AdvertisingPlan = {
  ...HOSTING,
  gattPeripheral: false,
  reason: 'central only',
};

const applied = (plan: AdvertisingPlan, identity: string | null): AppliedAdvertising => ({
  plan,
  identity,
});

/* ------------------------------------------------------------------ *
 * 1. Same plan, same identity -> nothing to do
 * ------------------------------------------------------------------ */

describe('nothing changed', () => {
  it('does not re-apply when the plan and the identity are both the same', () => {
    expect(advertisingUnchanged(applied(HOSTING, '4E32D908'), applied(HOSTING, '4E32D908'))).toBe(
      true,
    );
  });

  it('does not re-apply on a tick while not hosting', () => {
    // Identity is null in both, which must compare equal rather than "changed".
    expect(advertisingUnchanged(applied(SCAN_ONLY, null), applied(SCAN_ONLY, null))).toBe(true);
  });

  it('treats a plan object rebuilt with the same values as unchanged', () => {
    // computeAdvertisingPlan returns a fresh object every tick; identity of the
    // object must not be mistaken for a change.
    expect(advertisingUnchanged(applied({ ...HOSTING }, 'AAAA1111'), applied({ ...HOSTING }, 'AAAA1111'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Same plan, rotated identity -> re-apply
 * ------------------------------------------------------------------ */

describe('the peer id rotated', () => {
  it('re-applies when only the advertised identity changed', () => {
    // The exact case that broke: same three booleans, different peer id.
    expect(advertisingUnchanged(applied(HOSTING, '4E32D908'), applied(HOSTING, '27EAE15E'))).toBe(
      false,
    );
  });

  it('re-applies when hosting begins and an identity appears', () => {
    expect(advertisingUnchanged(applied(SCAN_ONLY, null), applied(HOSTING, '4E32D908'))).toBe(false);
  });

  it('re-applies when the identity disappears', () => {
    expect(advertisingUnchanged(applied(HOSTING, '4E32D908'), applied(SCAN_ONLY, null))).toBe(false);
  });

  it('is not fooled by the plan comparison alone', () => {
    // The old check would have said "equal" here, which is precisely the bug.
    const before = applied(HOSTING, '4E32D908');
    const after = applied(HOSTING, '27EAE15E');
    expect(advertisingPlansEqual(before.plan, after.plan)).toBe(true);
    expect(advertisingUnchanged(before, after)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Changed plan -> re-apply
 * ------------------------------------------------------------------ */

describe('the plan changed', () => {
  it('re-applies when the peripheral role turns off', () => {
    expect(advertisingUnchanged(applied(HOSTING, 'AAAA1111'), applied(SCAN_ONLY, 'AAAA1111'))).toBe(
      false,
    );
  });

  it('re-applies when scanning turns off', () => {
    const stopped: AdvertisingPlan = { ...HOSTING, gattScanning: false };
    expect(advertisingUnchanged(applied(HOSTING, 'AAAA1111'), applied(stopped, 'AAAA1111'))).toBe(
      false,
    );
  });

  it('re-applies on the very first pass', () => {
    // Nothing has been applied yet, so there is nothing to compare against.
    expect(advertisingUnchanged(null, applied(HOSTING, '4E32D908'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Rotation must not disturb scanning
 * ------------------------------------------------------------------ */

describe('rotation and the central half', () => {
  it('leaves the scanning decision untouched', () => {
    /*
     * Scanning is driven by `plan.gattScanning`, which a rotation does not
     * touch. This pins that a rotation changes only what is advertised — the
     * apply that follows restarts the advertiser, and `startScan` is separately
     * idempotent, so the central half keeps running across a rotation.
     */
    const before = applied(HOSTING, '4E32D908');
    const after = applied(HOSTING, '27EAE15E');

    expect(advertisingUnchanged(before, after)).toBe(false);
    expect(after.plan.gattScanning).toBe(true);
    expect(before.plan.gattScanning).toBe(after.plan.gattScanning);
  });

  it('keeps the existing plan comparison honest for callers that still use it', () => {
    // advertisingPlansEqual was deliberately left alone; nothing about its
    // meaning changed.
    expect(advertisingPlansEqual(HOSTING, { ...HOSTING })).toBe(true);
    expect(advertisingPlansEqual(HOSTING, SCAN_ONLY)).toBe(false);
  });
});
