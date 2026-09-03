/**
 * Sensor plumbing.
 *
 * Kept in one hook so the sample rates, the teardown and the "sensor not
 * present" cases live in a single place. Every phone in a conference hall is
 * different: some report a tilt-compensated heading, some only a raw
 * magnetometer, a few have no magnetometer at all. The fusion in
 * `HeadingService` copes with all three, but only if this layer is honest about
 * which inputs actually arrived.
 *
 * Rates are chosen for battery, not for smoothness: the fusion filter does the
 * smoothing, so sampling faster buys nothing and costs milliamps all day.
 */

import { useEffect } from 'react';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';

import type { PresenceController } from '../presence/PresenceController';

const MAGNETOMETER_INTERVAL_MS = 100;
const GYROSCOPE_INTERVAL_MS = 60;
const ACCELEROMETER_INTERVAL_MS = 200;

/** Above this much deviation from 1 g the user is walking, not holding still. */
const MOVEMENT_THRESHOLD_G = 0.06;

export function useDeviceSensors(presence: PresenceController, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const subscriptions: { remove(): void }[] = [];

    const attach = async (): Promise<void> => {
      const [hasMagnetometer, hasGyroscope, hasAccelerometer] = await Promise.all([
        Magnetometer.isAvailableAsync().catch(() => false),
        Gyroscope.isAvailableAsync().catch(() => false),
        Accelerometer.isAvailableAsync().catch(() => false),
      ]);
      if (cancelled) return;

      if (hasMagnetometer) {
        Magnetometer.setUpdateInterval(MAGNETOMETER_INTERVAL_MS);
        subscriptions.push(
          Magnetometer.addListener((sample) => {
            presence.pushMagnetometer({
              x: sample.x,
              y: sample.y,
              z: sample.z,
              timestamp: Date.now(),
            });
          }),
        );
      }

      if (hasGyroscope) {
        Gyroscope.setUpdateInterval(GYROSCOPE_INTERVAL_MS);
        subscriptions.push(
          Gyroscope.addListener((sample) => {
            presence.pushGyroscope({ z: sample.z, timestamp: Date.now() });
          }),
        );
      }

      if (hasAccelerometer) {
        // Movement gates the walk-gradient bearing estimator: a distance change
        // only tells you a direction if the user was actually walking.
        Accelerometer.setUpdateInterval(ACCELEROMETER_INTERVAL_MS);
        let movingSamples = 0;
        subscriptions.push(
          Accelerometer.addListener((sample) => {
            const magnitude = Math.hypot(sample.x, sample.y, sample.z);
            const moving = Math.abs(magnitude - 1) > MOVEMENT_THRESHOLD_G;
            // Require a couple of consecutive samples so a single jolt (setting
            // the phone down) does not register as walking.
            movingSamples = moving ? Math.min(movingSamples + 1, 4) : 0;
            presence.setMoving(movingSamples >= 2);
          }),
        );
      }
    };

    void attach();

    return () => {
      cancelled = true;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [presence, enabled]);
}
