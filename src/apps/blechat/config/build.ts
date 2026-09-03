/**
 * Which build this is.
 *
 * Exists because six APKs accumulated in one folder during testing and there was no way,
 * from the phone, to tell which one was actually installed. That turned a fixed bug into
 * a bug that looked unfixed: the symptom was reported again from an older build, and
 * nothing in the app could contradict it.
 *
 * Bumped by hand when a build is handed over. A date is more useful here than a semantic
 * version — the question being answered is "is this the one I was just sent?".
 */
export const BUILD_LABEL = '2026-09-02 · background+notifications';

/**
 * Marker string for the placeholder-name fix, so "does this build have it?" is answerable
 * on the phone rather than by guessing. See BleChatService.init.
 */
export const BUILD_NOTES =
  'foreground service keeps BLE alive; message notifications; no generated names';
