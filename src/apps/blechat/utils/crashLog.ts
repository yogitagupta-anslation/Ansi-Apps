import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The last crash, kept across the restart that follows it.
 *
 * A release build that dies takes its in-memory log with it, so the one screenful of
 * information that would explain what happened is gone by the time anyone can look. That
 * is why "the app just closes" has been so hard to act on: the evidence is destroyed by
 * the event that produces it.
 *
 * Written straight to AsyncStorage rather than through LocalStorage so nothing else has
 * to be initialised first — this runs from the global error handler, at a moment when no
 * assumption about the rest of the app still holds. Best effort by nature: the JS VM is
 * about to end, and a write that does not make it out is simply lost.
 */
const KEY = '@blechat/lastCrash';

export interface CrashRecord {
  at: number;
  /** 'fatal' ends the process; 'render' was caught by the error boundary. */
  kind: 'fatal' | 'render' | 'unhandled';
  message: string;
  stack: string;
}

export function saveCrash(
  kind: CrashRecord['kind'],
  error: unknown,
  stack?: string,
): void {
  try {
    const record: CrashRecord = {
      at: Date.now(),
      kind,
      message: error instanceof Error ? error.message : String(error),
      // Bounded: a component stack can run to thousands of lines, and a write that big
      // is less likely to survive the moment it is being made in.
      stack: (stack ?? (error instanceof Error ? error.stack : '') ?? '').slice(0, 4000),
    };
    void AsyncStorage.setItem(KEY, JSON.stringify(record)).catch(() => undefined);
  } catch {
    // Recording a crash must never be the cause of one.
  }
}

export async function loadCrash(): Promise<CrashRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CrashRecord>;
    if (typeof parsed.message !== 'string' || typeof parsed.at !== 'number') {
      return null;
    }
    return {
      at: parsed.at,
      kind: parsed.kind === 'render' || parsed.kind === 'unhandled' ? parsed.kind : 'fatal',
      message: parsed.message,
      stack: typeof parsed.stack === 'string' ? parsed.stack : '',
    };
  } catch {
    return null;
  }
}

export async function clearCrash(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to do; the record is stale at worst.
  }
}
