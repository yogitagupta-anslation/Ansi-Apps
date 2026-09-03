/**
 * A tiny typed event emitter.
 *
 * React Native ships one, but it is untyped and pulls in platform code, which
 * would make the game engine untestable in plain Node. This has no dependencies
 * so src/game and src/ble stay pure TypeScript.
 */

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      this.off(event, listener);
    };
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, payload => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return;
    }
    // Copy first: a listener may unsubscribe itself while we iterate.
    for (const listener of Array.from(set)) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (err) {
        // One bad listener must not stop the others or kill a BLE callback.
        console.warn(`[Emitter] listener for "${String(event)}" threw`, err);
      }
    }
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(event?: keyof Events): void {
    if (event === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(event);
    }
  }
}
