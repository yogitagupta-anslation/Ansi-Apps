/**
 * Navigation timing helpers.
 */

/**
 * Run a navigation action after React has committed the current render.
 *
 * Screens often flip a "busy" flag before an async call and navigate away when
 * it resolves. If the navigator replaces the screen in the same frame as that
 * re-render, the outgoing view tree is being detached while a commit for it is
 * still in flight, and the New Architecture's mounting layer rejects the result
 * ("View already has a parent"). Deferring by one frame lets the commit finish
 * first, which costs nothing perceptible and removes the race.
 */
export function navigateAfterCommit(action: () => void): void {
  requestAnimationFrame(() => {
    // A second frame guarantees the commit has been flushed to the host tree,
    // not merely scheduled.
    requestAnimationFrame(action);
  });
}
