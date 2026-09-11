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

/**
 * A scheduled send time, written the way somebody would say it.
 *
 * "Tomorrow at 10:00" rather than a date stamp: a message you are holding is almost
 * always for later today or tomorrow, and on that horizon the weekday and the clock are
 * the only parts anybody reads. Beyond a week the date has to appear, because "Thursday"
 * stops being unambiguous.
 *
 * 24-hour or 12-hour follows the phone, via toLocaleTimeString — the composer chip and
 * the bubble header both come through here so they can never disagree.
 */
export function describeSchedule(at: number, now: number = Date.now()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(when) - startOfDay(new Date(now))) / 86_400_000);

  if (days <= 0) {
    return `Today at ${time}`;
  }
  if (days === 1) {
    return `Tomorrow at ${time}`;
  }
  if (days < 7) {
    return `${when.toLocaleDateString(undefined, {weekday: 'long'})} at ${time}`;
  }
  const date = when.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
  return `${date} at ${time}`;
}
