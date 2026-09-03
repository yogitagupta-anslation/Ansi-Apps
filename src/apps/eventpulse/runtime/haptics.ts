/**
 * Haptics, behind one small vocabulary.
 *
 * Two reasons this is a module rather than scattered `Haptics.impactAsync`
 * calls. First, restraint: a phone that buzzes at everything is worse than one
 * that never buzzes, so the exported set is deliberately small and each entry
 * names an *event*, not a waveform — which makes it obvious when a new call
 * site is asking for something it has not earned.
 *
 * Second, safety: not every device has a haptic motor, iOS silently ignores
 * some patterns, and a JS reload against an older native build throws
 * synchronously. Feedback is a nicety; it must never be able to break a tap.
 */

import * as Haptics from 'expo-haptics';

function safely(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => undefined);
  } catch {
    /* no motor, or the native module is absent in this build */
  }
}

export const haptics = {
  /** Picking a person, a zone, a filter — the common, quiet one. */
  select(): void {
    safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },

  /** Opening a sheet, expanding a cluster: a touch more body. */
  reveal(): void {
    safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },

  /** A request sent, a profile saved — something left the device. */
  success(): void {
    safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },

  /** Blocking, reporting, leaving an event. Consequential, so it lands harder. */
  warn(): void {
    safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },

  /**
   * Reserved for navigation arrival. This is the one moment the phone is in a
   * pocket or held low while someone walks, so it is the one moment a buzz is
   * genuinely more useful than a pixel.
   */
  arrived(): void {
    safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
};
