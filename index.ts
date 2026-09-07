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

registerRootComponent(App);
