/** Formats a duration for the results screen: 4.2s, 1:04.8 */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** "1 guess" / "4 guesses" -- sibilant endings take -es. */
export function plural(count: number, word: string): string {
  if (count === 1) return `${count} ${word}`;
  const suffix = /(s|x|z|ch|sh)$/.test(word) ? 'es' : 's';
  return `${count} ${word}${suffix}`;
}
