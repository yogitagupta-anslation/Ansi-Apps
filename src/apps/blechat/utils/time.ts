/** Compact relative timestamps for the peer list and the exported report. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 2) {
    return 'just now';
  }
  if (seconds < 60) {
    return seconds + 's ago';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes + 'm ago';
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours + 'h ago';
  }
  return Math.floor(hours / 24) + 'd ago';
}
