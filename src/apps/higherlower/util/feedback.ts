import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { soundManager } from '../audio/SoundManager';
import { Verdict } from '../types/game';

/**
 * Haptics and sound behind one call, so a screen asks for "a verdict landed"
 * rather than wiring both every time. Configured once from settings; every
 * entry point is safe to call whether or not either channel is switched on.
 */
let haptics = true;
const canBuzz = () => haptics && Platform.OS !== 'web';

export const feedback = {
  configure(next: { haptics: boolean; sound: boolean }): void {
    haptics = next.haptics;
    soundManager.setEnabled(next.sound);
  },

  /** A key press. Deliberately the quietest thing in the game. */
  tap(): void {
    if (canBuzz()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    soundManager.play('tap', 0.7);
  },

  /** The app's answer to your guess. */
  verdict(verdict: Verdict): void {
    if (verdict === 'correct') {
      if (canBuzz()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      soundManager.play('correct');
      return;
    }
    if (canBuzz()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    soundManager.play(verdict === 'higher' ? 'higher' : 'lower');
  },

  roundStart(): void {
    soundManager.play('start');
  },

  win(): void {
    if (canBuzz()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    soundManager.play('win');
  },

  lose(): void {
    if (canBuzz()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    soundManager.play('lose');
  },

  eliminated(): void {
    if (canBuzz()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    soundManager.play('eliminated');
  },

  /** An opponent's guess arriving on your board. */
  peerGuess(): void {
    soundManager.play('peer', 0.5);
  },

  unlock(): void {
    if (canBuzz()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    soundManager.play('unlock');
  },

  wager(on: boolean): void {
    if (canBuzz()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    if (on) soundManager.play('wager');
  },

  react(): void {
    soundManager.play('react', 0.8);
  },
};
