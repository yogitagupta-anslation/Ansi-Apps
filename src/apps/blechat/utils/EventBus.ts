type Handler<T> = (payload: T) => void;

/** Minimal typed emitter. Avoids pulling in a dependency for ~30 lines. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers: {[K in keyof Events]?: Set<Handler<Events[K]>>} = {};

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers[event];
    if (!set) {
      set = new Set();
      this.handlers[event] = set;
    }
    set.add(handler);
    return () => {
      this.handlers[event]?.delete(handler);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers[event];
    if (!set) {
      return;
    }
    // Copy so a handler unsubscribing mid-emit cannot corrupt iteration.
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (err) {
        console.warn('[EventBus] handler threw for', String(event), err);
      }
    }
  }

  removeAll(): void {
    this.handlers = {};
  }
}
