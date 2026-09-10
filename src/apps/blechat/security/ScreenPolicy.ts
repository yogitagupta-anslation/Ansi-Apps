import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';

const TAG = 'ScreenPolicy';

/**
 * Whether a conversation may be screenshotted, decided by BOTH people in it.
 *
 * The rule the feature exists for: a conversation is as private as its most private
 * participant wants it to be. If either phone says "not allowed", it is not allowed —
 * for both of them, in both directions. Nobody has to negotiate, and nobody's choice can
 * be overridden by the person they are talking to.
 *
 * This is a per-phone preference rather than a per-chat one, and it travels in the HELLO
 * handshake as an optional field alongside interests and languages. A build that does not
 * send it is treated as `allowed`, which is not a security hole: an old build could not
 * enforce anything anyway, and pretending otherwise would be the actual dishonesty.
 *
 * WHAT IS ACTUALLY ENFORCEABLE, since this is a promise about someone else's phone:
 *
 *  - `notAllowed` is real, and is the only level that is. FLAG_SECURE tells the Android
 *    window server to refuse capture of this window — screenshots, screen recording, and
 *    the thumbnail in the recents list, all denied by the OS rather than by us.
 *  - `notify` is real on Android 14+, which added a callback for "the user just took a
 *    screenshot". Below 14 there is no API for it that does not involve watching the
 *    photo library, so on those phones this level cannot be honoured and says so.
 *  - Neither survives a second camera pointed at the screen. Nothing can. The feature is
 *    about consent between two people who are talking, not about defeating an adversary
 *    who has already decided to be one.
 */
export type ScreenshotPolicy = 'allowed' | 'notify' | 'notAllowed';

/** Strictness order. `resolve` takes the maximum, which is the whole rule. */
const RANK: Record<ScreenshotPolicy, number> = {
  allowed: 0,
  notify: 1,
  notAllowed: 2,
};

export const SCREENSHOT_POLICIES: ReadonlyArray<{
  value: ScreenshotPolicy;
  label: string;
  detail: string;
}> = [
  {
    value: 'allowed',
    label: 'Allowed',
    detail: 'Anyone in the chat can screenshot it. Nobody is told.',
  },
  {
    value: 'notify',
    label: 'Tell me when one is taken',
    detail: 'Screenshots still work, and a note appears in the chat when one happens.',
  },
  {
    value: 'notAllowed',
    label: 'Not allowed',
    detail: 'Android refuses to capture the screen while a chat is open.',
  },
];

/**
 * The policy in force for a conversation: the stricter of the two.
 *
 * `theirs` is null for a peer we have never handshaken with, or one on a build that does
 * not send the field — both mean "no opinion", and our own choice stands alone.
 */
export function resolvePolicy(
  mine: ScreenshotPolicy,
  theirs: ScreenshotPolicy | null | undefined,
): ScreenshotPolicy {
  if (!theirs) {
    return mine;
  }
  return RANK[theirs] > RANK[mine] ? theirs : mine;
}

/** True when the stricter side is the other phone — worth saying so in the UI. */
export function isTheirRule(
  mine: ScreenshotPolicy,
  theirs: ScreenshotPolicy | null | undefined,
): boolean {
  return !!theirs && RANK[theirs] > RANK[mine];
}

/** Only ever widens what arrives over the wire into a value this app knows. */
export function parsePolicy(value: unknown): ScreenshotPolicy | null {
  return value === 'allowed' || value === 'notify' || value === 'notAllowed'
    ? value
    : null;
}

// ---- the native side --------------------------------------------------

interface ScreenGuardNative {
  /** FLAG_SECURE on the activity window. Idempotent. */
  setSecure(secure: boolean): Promise<boolean>;
  /** Android 14+ only; resolves false where the OS cannot report a capture. */
  setDetecting(detecting: boolean): Promise<boolean>;
  /** Whether this OS can tell us a screenshot happened at all. */
  canDetect(): Promise<boolean>;
}

const native: ScreenGuardNative | undefined = (
  NativeModules as {ScreenGuard?: ScreenGuardNative}
).ScreenGuard;

export const isScreenGuardAvailable = Platform.OS === 'android' && !!native;

type Events = {captured: {at: number}};

/** Fires when the OS tells us the user took a screenshot. Android 14+ only. */
export const screenGuardBus = new EventBus<Events>();

if (isScreenGuardAvailable) {
  const emitter = new NativeEventEmitter(
    NativeModules.ScreenGuard as ConstructorParameters<typeof NativeEventEmitter>[0],
  );
  emitter.addListener('screenCaptured', () => {
    logger.info(TAG, 'the OS reported a screen capture');
    screenGuardBus.emit('captured', {at: Date.now()});
  });
}

/**
 * Apply a policy to the window, and report what was actually achieved.
 *
 * The return value is the honest part: asking for `notify` on Android 13 gets you
 * `enforced: false`, and the screen that asked can then say so instead of showing a
 * shield it cannot back up.
 */
export async function applyPolicy(
  policy: ScreenshotPolicy,
): Promise<{enforced: boolean}> {
  if (!native) {
    return {enforced: false};
  }
  try {
    const secure = policy === 'notAllowed';
    await native.setSecure(secure);
    if (policy === 'notify') {
      const detecting = await native.setDetecting(true);
      return {enforced: detecting};
    }
    await native.setDetecting(false);
    return {enforced: secure};
  } catch (err) {
    logger.warn(TAG, `could not apply ${policy}: ${String(err)}`);
    return {enforced: false};
  }
}

/** Release the window when leaving a conversation, so the rest of the app is normal. */
export async function clearPolicy(): Promise<void> {
  if (!native) {
    return;
  }
  await native.setSecure(false).catch(() => undefined);
  await native.setDetecting(false).catch(() => undefined);
}

/** Whether "tell me when one is taken" can be honoured on this phone. */
export async function canDetectCaptures(): Promise<boolean> {
  if (!native) {
    return false;
  }
  return native.canDetect().catch(() => false);
}
