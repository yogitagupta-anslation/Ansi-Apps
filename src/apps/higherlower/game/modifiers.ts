import { Range } from '../types/game';
import { parGuesses } from './engine';

/**
 * Modifiers exist because plain Higher/Lower has one optimal strategy. Each one
 * breaks a different assumption binary search relies on: that you can see the
 * range, that feedback is only directional, that guesses are free, or that the
 * number stays put.
 */
export type ModifierId = 'blind' | 'heat' | 'limited' | 'moving' | 'risk' | 'double';

export interface Modifier {
  id: ModifierId;
  name: string;
  icon: string;
  blurb: string;
  /** Needs one shared target per player, so it cannot travel over the link. */
  soloOnly?: boolean;
  /** Cannot be combined with these. */
  conflicts?: ModifierId[];
}

export const MODIFIERS: Modifier[] = [
  {
    id: 'blind',
    name: 'Blind',
    icon: '🙈',
    blurb: 'No range track, no counter. Just higher or lower.',
  },
  {
    id: 'heat',
    name: 'Hot / Cold',
    icon: '🔥',
    blurb: 'Every verdict also tells you how close you landed.',
  },
  {
    id: 'limited',
    name: 'Limited',
    icon: '⏳',
    blurb: 'Par guesses, no more. Run out and you are eliminated.',
  },
  {
    id: 'moving',
    name: 'Moving target',
    icon: '🏃',
    blurb: 'Every 3 guesses the number moves — inside what is still possible.',
    soloOnly: true,
  },
  {
    id: 'risk',
    name: 'Risk it',
    icon: '🎲',
    blurb: 'Flag a guess as risky: +40 if it lands, −15 if it misses.',
    conflicts: ['double'],
  },
  {
    id: 'double',
    name: 'Double down',
    icon: '💰',
    blurb: 'Stake the round: double your score if that guess lands, −50 if not.',
    conflicts: ['risk'],
  },
];

export function modifierById(id: ModifierId): Modifier {
  return MODIFIERS.find((m) => m.id === id) ?? MODIFIERS[0];
}

/** What the modifiers actually do to a round, resolved once at the start. */
export interface RoundRules {
  modifiers: ModifierId[];
  /** Hide the range track and every "numbers left" readout. */
  hideRange: boolean;
  /** Report proximity alongside the verdict. */
  heat: boolean;
  /** Guesses allowed before elimination, or null for unlimited. */
  guessLimit: number | null;
  /** Move the target every N guesses, or null to hold still. */
  movesEvery: number | null;
  /** Which wager mechanic the keypad offers. */
  wager: 'risk' | 'double' | null;
}

export function resolveRules(range: Range, modifiers: ModifierId[]): RoundRules {
  const on = (id: ModifierId) => modifiers.includes(id);
  return {
    modifiers,
    hideRange: on('blind'),
    heat: on('heat'),
    guessLimit: on('limited') ? parGuesses(range) : null,
    movesEvery: on('moving') ? 3 : null,
    wager: on('double') ? 'double' : on('risk') ? 'risk' : null,
  };
}

export const NO_MODIFIERS: RoundRules = {
  modifiers: [],
  hideRange: false,
  heat: false,
  guessLimit: null,
  movesEvery: null,
  wager: null,
};

/** Drops the modifiers that cannot be shared across devices. */
export function multiplayerSafe(ids: ModifierId[]): ModifierId[] {
  return ids.filter((id) => !modifierById(id).soloOnly);
}

/** Only keeps ids we actually know, so a stray packet cannot invent rules. */
export function parseModifierIds(raw: string[] | undefined): ModifierId[] {
  const known = new Set(MODIFIERS.map((m) => m.id as string));
  return (raw ?? []).filter((id) => known.has(id)) as ModifierId[];
}

/** One line describing the rules in play, for a screen subtitle. */
export function rulesSummary(range: { min: number; max: number }, modifiers: ModifierId[], mode?: string): string {
  const parts = [`${range.min.toLocaleString('en-US')} – ${range.max.toLocaleString('en-US')}`];
  if (mode === 'efficiency') parts.push('fewest guesses');
  if (mode === 'elimination') parts.push('survival');
  if (modifiers.length > 0) parts.push(modifiers.map((id) => modifierById(id).icon).join(' '));
  return parts.join(' · ');
}

/** Toggling one modifier off/on, respecting conflicts. */
export function toggleModifier(active: ModifierId[], id: ModifierId): ModifierId[] {
  if (active.includes(id)) return active.filter((m) => m !== id);
  const conflicts = modifierById(id).conflicts ?? [];
  return [...active.filter((m) => !conflicts.includes(m)), id];
}
