/**
 * Dispatches decoded game messages to handlers by type.
 *
 * Keeping this separate from the reliability layer means the game engine
 * registers plain typed callbacks and never touches BLE plumbing, and unknown
 * message types from a newer client version are logged and skipped instead of
 * crashing the match.
 */
import {MessageType} from '../models/messages';
import type {Envelope, GameMessage} from '../models/messages';
import {createLogger} from '../utils/logger';

const log = createLogger('MessageRouter');

export interface MessageContext {
  /** BLE link the message arrived on. */
  peerId: string;
  /** Game identity of the sender, when known. */
  playerId?: string;
  receivedAt: number;
}

export type MessageHandler<P = unknown> = (
  payload: P,
  envelope: Envelope<P>,
  context: MessageContext,
) => void;

export class MessageRouter {
  private handlers = new Map<MessageType, Set<MessageHandler<never>>>();
  private fallback: ((message: GameMessage, context: MessageContext) => void) | null = null;

  /** Register a handler. Returns an unsubscribe function. */
  on<P>(type: MessageType, handler: MessageHandler<P>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as MessageHandler<never>);
    return () => {
      this.handlers.get(type)?.delete(handler as MessageHandler<never>);
    };
  }

  /** Handler for message types nothing else claimed. */
  onUnhandled(handler: (message: GameMessage, context: MessageContext) => void): void {
    this.fallback = handler;
  }

  route(message: GameMessage, context: MessageContext): void {
    const handlers = this.handlers.get(message.type);

    if (!handlers || handlers.size === 0) {
      if (this.fallback) {
        this.fallback(message, context);
      } else {
        log.debug(`no handler for ${message.type}`);
      }
      return;
    }

    for (const handler of Array.from(handlers)) {
      try {
        (handler as MessageHandler<unknown>)(
          message.payload,
          message as Envelope<unknown>,
          context,
        );
      } catch (err) {
        // A throwing handler must not stop the others or bubble into a BLE
        // callback, where it would tear down the native listener.
        log.error(`handler for ${message.type} threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
    this.fallback = null;
  }
}
