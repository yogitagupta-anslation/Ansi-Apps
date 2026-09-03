/**
 * A ~50-line external store.
 *
 * Why not a state library: the map's hot path pushes a new snapshot several
 * times a second, and what matters is that a component re-renders only when the
 * *slice* it selected actually changed. `useSyncExternalStore` gives exactly
 * that with no dependency, no proxies, and no surprises about when React
 * decides to tear.
 *
 * The rule that keeps the map at 60 fps: `useStore(store, selector)` must
 * return a stable reference when nothing changed. Selectors here return
 * primitives or already-memoised arrays; they never build a new object inline.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface Store<T> {
  getState(): T;
  setState(updater: Partial<T> | ((current: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
  /** Replace the whole state. Used on sign-out / leave-event resets. */
  reset(next: T): void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,

    setState(updater) {
      const patch = typeof updater === 'function' ? updater(state) : updater;

      // Bail out when the patch is a no-op: a snapshot that changes nothing
      // must not wake every subscriber.
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;

      state = { ...state, ...patch };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    reset(next) {
      state = next;
      notify();
    },
  };
}

/** Subscribe to a slice. Re-renders only when `isEqual` says the slice moved. */
export function useStore<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const lastValue = useRef<S | undefined>(undefined);
  const hasValue = useRef(false);

  const getSnapshot = useCallback(() => {
    const next = selector(store.getState());
    if (hasValue.current && isEqual(lastValue.current as S, next)) {
      return lastValue.current as S;
    }
    lastValue.current = next;
    hasValue.current = true;
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Shallow array comparison, for selectors that return lists. */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
