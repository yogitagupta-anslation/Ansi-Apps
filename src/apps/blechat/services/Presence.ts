import {AppState, NativeModules, Platform} from 'react-native';
import {logger} from '../utils/logger';

/**
 * Staying reachable while the app is not on screen, and saying so when something arrives.
 *
 * Two gaps this closes, both of which made the app only work while you were looking at it:
 *
 *  - Android stops an ordinary app's Bluetooth work shortly after backgrounding. Over BLE
 *    there is no server holding the message: it exists only while both radios are on, so
 *    a missed message is missed PERMANENTLY rather than delayed. A foreground service is
 *    the only sanctioned way to keep the radio alive.
 *
 *  - Nothing told the user a message had arrived. They had to open the app and look.
 *
 * Every call degrades rather than throws. A phone that refuses the notification
 * permission, or an OS that blocks the service, gets an app that still works and reports
 * honestly that it will stop when closed.
 */

const TAG = 'Presence';

interface PresenceNative {
  hasNotificationPermission(): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  startPresence(title: string, text: string): Promise<boolean>;
  stopPresence(): Promise<boolean>;
  notifyMessage(
    conversationKey: string,
    title: string,
    body: string,
    count: number,
  ): Promise<boolean>;
  clearMessageNotification(conversationKey: string): Promise<boolean>;
  getLastExitReason(): Promise<LastExit | null>;
}

/**
 * How the process died last time, straight from Android.
 *
 * The one thing the app cannot work out for itself: a native crash, an ANR or a
 * low-memory kill leave nothing running to write anything down, so without asking the
 * system the app wakes up believing it was started normally.
 */
export interface LastExit {
  /** Already in words — "Native crash", "Stopped responding", "Killed to free memory". */
  reason: string;
  description: string;
  at: number;
  status: number;
  /** True for a crash or an ANR; false for the OS reclaiming memory or the user closing it. */
  wasCrash: boolean;
}

const native: PresenceNative | undefined = (
  NativeModules as {Presence?: PresenceNative}
).Presence;

/** Android-only for now: no iOS equivalent is written, and claiming one would be a lie. */
export const isPresenceSupported = Platform.OS === 'android' && !!native;

let running = false;

export function isPresenceRunning(): boolean {
  return running;
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!native) {
    return false;
  }
  try {
    return await native.hasNotificationPermission();
  } catch {
    return false;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!native) {
    return false;
  }
  try {
    return await native.requestNotificationPermission();
  } catch (err) {
    logger.warn(TAG, `notification permission request failed: ${String(err)}`);
    return false;
  }
}

/**
 * Keep the radio alive in the background.
 *
 * The permanent notification this creates is not a side effect to be minimised — it is
 * how the user knows their radio is in use and how they stop it. Hiding it would be both
 * against the rules and dishonest.
 */
export async function startPresence(peerCount: number): Promise<boolean> {
  if (!native) {
    return false;
  }
  const text =
    peerCount > 0
      ? `Connected to ${peerCount} ${peerCount === 1 ? 'person' : 'people'} nearby.`
      : 'Staying discoverable so people nearby can reach you.';
  try {
    await native.startPresence('BLE Chat is active', text);
    running = true;
    logger.info(TAG, 'foreground presence started');
    return true;
  } catch (err) {
    // Reported, not swallowed: without this the app stops working when closed, and the
    // user should be told rather than left to discover it by missing messages.
    running = false;
    logger.warn(TAG, `could not start foreground presence: ${String(err)}`);
    return false;
  }
}

export async function stopPresence(): Promise<void> {
  if (!native) {
    return;
  }
  try {
    await native.stopPresence();
  } catch (err) {
    logger.warn(TAG, `stopPresence failed: ${String(err)}`);
  }
  running = false;
}

/**
 * Tell the user a message arrived.
 *
 * Only while the app is in the background: a notification for a message already visible
 * on screen is noise, and noise is what teaches people to swipe notifications away
 * without reading them.
 *
 * Keyed per conversation so a second message from the same person replaces the first
 * rather than stacking — ten notifications from one chat is noise, one saying there are
 * ten is information.
 */
export async function notifyIncoming(params: {
  conversationId: string;
  senderName: string;
  text: string;
  unreadCount: number;
}): Promise<void> {
  if (!native || AppState.currentState === 'active') {
    return;
  }
  const body =
    params.unreadCount > 1
      ? `${params.unreadCount} new messages`
      : params.text.slice(0, 200);
  try {
    await native.notifyMessage(
      params.conversationId,
      params.senderName,
      body,
      params.unreadCount,
    );
  } catch (err) {
    logger.warn(TAG, `notifyMessage failed: ${String(err)}`);
  }
}

/** Clear a conversation's notification once the user has actually seen it. */
export async function clearNotification(conversationId: string): Promise<void> {
  if (!native) {
    return;
  }
  try {
    await native.clearMessageNotification(conversationId);
  } catch {
    // Nothing to recover from: a stale notification is a cosmetic problem.
  }
}

/**
 * Why the app closed last time, if the OS still remembers.
 *
 * Null when there is nothing recorded or Android is older than 11 — an unanswered
 * question rather than an all-clear, and the UI says so.
 */
export async function getLastExitReason(): Promise<LastExit | null> {
  if (!native?.getLastExitReason) {
    return null;
  }
  try {
    return await native.getLastExitReason();
  } catch (err) {
    logger.warn(TAG, `could not read the last exit reason: ${String(err)}`);
    return null;
  }
}
