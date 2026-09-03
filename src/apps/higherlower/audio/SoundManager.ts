import { SOUND_FILES, SoundName } from './sounds';

/**
 * One player per effect, created on first use and kept for the session.
 *
 * Effects are short and fire in bursts, so re-creating a player per press would
 * cost more than it saves. Playing an already-playing effect rewinds it, which
 * is the right behaviour for a keypad click.
 *
 * expo-audio is loaded lazily behind a guard: without its native half the
 * import throws, and a missing sound should never take the game down with it.
 */
interface Player {
  play(): void;
  seekTo(seconds: number): void;
  remove(): void;
  volume: number;
}

interface AudioModule {
  createAudioPlayer(source: unknown): Player;
  setAudioModeAsync(mode: Record<string, unknown>): Promise<void>;
}

let audio: AudioModule | null | undefined;

function backend(): AudioModule | null {
  if (audio !== undefined) return audio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-audio');
    audio = typeof mod?.createAudioPlayer === 'function' ? (mod as AudioModule) : null;
  } catch {
    audio = null;
  }
  return audio;
}

class SoundManager {
  private players = new Map<SoundName, Player>();
  private enabled = true;
  private configured = false;

  /**
   * Effects should mix with whatever else is playing and still be audible with
   * the ringer switched off — this is feedback, not media.
   */
  private configure(mod: AudioModule): void {
    if (this.configured) return;
    this.configured = true;
    void mod
      .setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })
      .catch(() => undefined);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isAvailable(): boolean {
    return backend() !== null;
  }

  play(name: SoundName, volume = 1): void {
    if (!this.enabled) return;
    const mod = backend();
    if (!mod) return;
    this.configure(mod);

    try {
      let player = this.players.get(name);
      if (!player) {
        player = mod.createAudioPlayer(SOUND_FILES[name]);
        this.players.set(name, player);
      }
      player.volume = volume;
      player.seekTo(0);
      player.play();
    } catch {
      // A dud effect is not worth interrupting a round for.
    }
  }

  /** Frees every player. Called when the app tears down. */
  release(): void {
    this.players.forEach((player) => {
      try {
        player.remove();
      } catch {
        // already gone
      }
    });
    this.players.clear();
  }
}

export const soundManager = new SoundManager();
