import {useEffect, useRef, useState} from 'react';
import type {Peer} from '../types/Peer';

/** How many one-second samples the sparkline shows. */
export const TRAFFIC_WINDOW = 5;

export interface LinkTraffic {
  /** Bytes per second over the last sample. 0 on an idle link. */
  rate: number;
  /** One entry per second, oldest first, `TRAFFIC_WINDOW` long once warmed up. */
  history: number[];
  /** True only when bytes actually moved in the last second. */
  active: boolean;
  /** Which direction dominated the last sample, for the label. */
  direction: 'tx' | 'rx' | null;
}

const IDLE: LinkTraffic = {rate: 0, history: [], active: false, direction: null};

/**
 * Bytes actually on a link, sampled once a second.
 *
 * This exists so presence animation can be driven by traffic rather than by a timer.
 * A ring that pulses on every connected peer says nothing: a healthy idle link and a
 * link carrying a file look identical, which is exactly the state the user cannot
 * distinguish and most needs to. Sampling the transport's own cumulative counters means
 * the ring is a readout, not decoration — when it is still, that is a fact about the
 * link.
 *
 * The counters are cumulative and monotonic, so a delta is the honest per-second figure.
 * `Math.max(0, …)` guards the one case where it is not: a reconnect resets the metrics,
 * and a negative delta would otherwise render as a spike.
 */
export function useLinkTraffic(peer: Peer | null): LinkTraffic {
  const connected = peer?.state === 'connected';

  // Written on every render, read from the interval. A ref rather than a dependency
  // because the sampler must tick on a fixed clock: an effect keyed on the byte count
  // would never fire on an idle link, so the history would freeze at its last non-zero
  // value instead of decaying to nothing.
  const latest = useRef(0);
  latest.current = (peer?.metrics?.bytesTx ?? 0) + (peer?.metrics?.bytesRx ?? 0);

  const latestSplit = useRef({tx: 0, rx: 0});
  latestSplit.current = {
    tx: peer?.metrics?.bytesTx ?? 0,
    rx: peer?.metrics?.bytesRx ?? 0,
  };

  const [traffic, setTraffic] = useState<LinkTraffic>(IDLE);

  useEffect(() => {
    if (!connected) {
      setTraffic(IDLE);
      return;
    }

    let previous = latest.current;
    let previousSplit = latestSplit.current;

    const id = setInterval(() => {
      const current = latest.current;
      const split = latestSplit.current;

      const delta = Math.max(0, current - previous);
      const dTx = Math.max(0, split.tx - previousSplit.tx);
      const dRx = Math.max(0, split.rx - previousSplit.rx);
      previous = current;
      previousSplit = split;

      setTraffic(state => ({
        rate: delta,
        history: [...state.history, delta].slice(-TRAFFIC_WINDOW),
        active: delta > 0,
        direction: delta === 0 ? null : dRx >= dTx ? 'rx' : 'tx',
      }));
    }, 1000);

    return () => clearInterval(id);
  }, [connected]);

  return traffic;
}

/** "1.4 KB/s" — the unit a link's throughput is actually read in. */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}
