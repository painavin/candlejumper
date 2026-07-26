import type { Unlock, UnlockContext } from './types.js'

/**
 * Unlockables, as plain data.
 *
 * The rule from docs/game-feel.md that shapes every entry here:
 * **achievements tied to discipline, not just profit.** Not one of these can be
 * bought with a lucky run, and the two most interesting ones (`bear`, `serious`)
 * require *never breaking your own rule* — which is the behaviour this whole game
 * exists to train. A profit-gated unlock would reward the opposite: holding a loser
 * past a stop and getting away with it.
 *
 * Everything gated here is **cosmetic**. Locking a mechanic behind a grind would
 * make the trainer worse at training; locking a costume behind a habit makes the
 * habit visible. See docs/character.md — character choice never affects gameplay.
 */

export const unlocks: readonly Unlock[] = [
  {
    id: 'character:bull',
    displayName: 'Bull',
    requirement: 'Finish 3 runs',
    achieved: (context) => context.lifetime.runs >= 3,
  },
  {
    id: 'character:bear',
    displayName: 'Bear',
    requirement: 'Finish a run that trades and never breaks your own rule',
    achieved: (context) => context.lifetime.cleanRuns >= 1,
  },
  {
    id: 'theme:serious',
    displayName: 'Serious mood',
    requirement: 'Reach a discipline streak of 5',
    achieved: (context) => context.lifetime.bestStreak >= 5,
  },
  {
    id: 'badge:composure',
    displayName: 'Composure',
    requirement: 'Finish 5 clean runs',
    achieved: (context) => context.lifetime.cleanRuns >= 5,
  },
  {
    id: 'badge:volume',
    displayName: 'Screen time',
    requirement: 'Close 50 trades',
    achieved: (context) => context.lifetime.campaigns >= 50,
  },
]

/**
 * Everything currently unlocked.
 *
 * Recomputed from lifetime stats on every load rather than stored as a list, so a
 * corrupted or partial save can't permanently lose an unlock the player earned —
 * and so a rule change here applies retroactively instead of only to new players.
 */
export function earnedUnlocks(context: UnlockContext): string[] {
  return unlocks.filter((unlock) => unlock.achieved(context)).map((unlock) => unlock.id)
}

/** Content ids that need no unlock — the starting set. */
const ALWAYS: readonly string[] = ['character:robin', 'theme:jolly']

export function isUnlocked(id: string, earned: readonly string[]): boolean {
  return ALWAYS.includes(id) || earned.includes(id)
}

/** The next thing to aim for, or `undefined` when everything is earned. */
export function nextUnlock(context: UnlockContext): Unlock | undefined {
  return unlocks.find((unlock) => !unlock.achieved(context))
}
