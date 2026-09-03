/**
 * Identifier helpers. Ids must be unique across devices with no coordination,
 * so they mix a per-process random prefix with a monotonic counter.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChunk(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Stable per-process prefix; keeps ids short while staying collision-safe. */
const PROCESS_PREFIX = randomChunk(4);

let counter = 0;

/** Short unique id, e.g. "k3f9-1a-7". Unique within and across devices. */
export function uid(prefix?: string): string {
  counter = (counter + 1) % 0xffffff;
  const body = `${PROCESS_PREFIX}${counter.toString(36)}${randomChunk(2)}`;
  return prefix ? `${prefix}_${body}` : body;
}

/** Player ids are shown in logs, so keep them readable: P01, P02, ... */
export function playerIdFromIndex(index: number): string {
  return `P${String(index + 1).padStart(2, '0')}`;
}

export function messageId(): string {
  return uid('m');
}

export function gameId(): string {
  return uid('g');
}

export function itemId(index: number): string {
  return `I${String(index).padStart(3, '0')}`;
}

export function obstacleId(index: number): string {
  return `O${String(index).padStart(3, '0')}`;
}

export function treasureId(index: number): string {
  return `T${String(index + 1).padStart(2, '0')}`;
}
