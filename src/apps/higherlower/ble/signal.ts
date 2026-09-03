/**
 * Radio strength, in words a player can act on. dBm is engineering trivia --
 * "move closer" is the only thing anyone can actually do about it.
 */
export interface Signal {
  label: string;
  /** Filled bars out of four. */
  bars: 1 | 2 | 3 | 4;
  /** True when the link is good enough not to worry about. */
  healthy: boolean;
}

export function signalFor(rssi: number): Signal {
  if (rssi >= -55) return { label: 'Excellent connection', bars: 4, healthy: true };
  if (rssi >= -68) return { label: 'Good connection', bars: 3, healthy: true };
  if (rssi >= -80) return { label: 'Fair — stay close', bars: 2, healthy: true };
  return { label: 'Weak — move closer', bars: 1, healthy: false };
}
