/**
 * Process entry point.
 *
 * Two things have to happen before anything renders, and both are here rather
 * than inside an app because both are process-wide.
 */

// Installs the platform CSPRNG behind global.crypto.getRandomValues. BLE Chat's
// peer ids, packet ids and key material all depend on it, and it must be in place
// before any module that generates an identifier is even imported.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';
import { logger } from './src/apps/blechat/utils/logger';
import { saveCrash } from './src/apps/blechat/utils/crashLog';

/**
 * Catches a fatal JS exception thrown OUTSIDE any component's render — a timer
 * callback, an event handler body that is not already inside a promise chain.
 * React's own error boundaries cannot see these; only ErrorUtils can.
 *
 * This does not and cannot prevent RN's own release-build behaviour for a truly
 * fatal error, which still ends the JS instance. What it buys is a log entry
 * recorded before that happens, so a crash that used to leave zero trace at least
 * leaves one — and chaining to the previous handler keeps whatever internal
 * bookkeeping RN itself still needs to run.
 */
declare const ErrorUtils:
  | {
      setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
      getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined;
    }
  | undefined;

if (typeof ErrorUtils !== 'undefined') {
  const previousHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    try {
      logger.error(
        'App',
        `${isFatal ? 'FATAL' : 'unhandled'}: ${error.message}\n${error.stack ?? ''}`,
      );
      // The in-memory log dies with the process; this does not. Read it back from
      // Diagnostics after the restart — the only way a crash on somebody else's phone
      // ever reaches the person who can fix it.
      saveCrash(isFatal ? 'fatal' : 'unhandled', error);
    } catch {
      // Logging itself must never be why this handler throws.
    }
    previousHandler?.(error, isFatal);
  });
}

/**
 * A rejected promise nobody caught must not be able to end the process.
 *
 * The BLE stack is almost entirely asynchronous, and a rejection that escapes — a write
 * refused after the screen moved on, a disconnect landing mid-operation — reaches the
 * global handler, which in a release build ends the JS instance. To the person holding
 * the phone that is indistinguishable from the app crashing.
 *
 * Rejection tracking turns those into a recorded warning instead. It does not hide the
 * bug: the message and stack are logged and kept for Diagnostics, so an escaped
 * rejection is still visible to whoever looks — it just stops being fatal.
 */
try {
  const tracking = require('promise/setimmediate/rejection-tracking') as {
    enable: (opts: {
      allRejections: boolean;
      onUnhandled: (id: number, error: unknown) => void;
      onHandled: (id: number) => void;
    }) => void;
  };
  tracking.enable({
    allRejections: true,
    onUnhandled: (id, error) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      logger.warn('App', `unhandled rejection #${id}: ${message}` + "\n" + stack);
      saveCrash('unhandled', error);
    },
    onHandled: () => {
      // Late-handled rejections are ordinary; nothing to report.
    },
  });
} catch {
  // The polyfill is not present on every RN version. Nothing here is load-bearing.
}

registerRootComponent(App);
