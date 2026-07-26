import type { Unlock, UnlockContext } from './types.js'

/**
 * Achievements.
 *
 * **Nothing here gates anything.** These used to unlock characters and the second
 * mood, and that was a mistake: the roster and both themes are cosmetic, they're
 * finished, and hiding finished content behind a grind makes a trainer worse at
 * training — a player who wants to be the bear should be the bear on their first
 * run. What's left is a record of habits worth noticing, which is what the
 * underlying idea was actually for.
 *
 * The rule from docs/game-feel.md that still shapes every entry:
 * **tied to discipline, not just profit.** Not one of these can be bought with a
 * lucky run, and the two most interesting ones require *never breaking your own
 * rule* — which is the behaviour this whole game exists to train. A profit-gated
 * achievement would reward holding a loser past a stop and getting away with it.
 */

export const unlocks: readonly Unlock[] = [
  {
    id: 'badge:regular',
    displayName: 'Regular',
    requirement: 'Finish 3 runs',
    achieved: (context) => context.lifetime.runs >= 3,
  },
  {
    id: 'badge:clean-sheet',
    displayName: 'Clean sheet',
    requirement: 'Finish a run that trades and never breaks your own rule',
    achieved: (context) => context.lifetime.cleanRuns >= 1,
  },
  {
    id: 'badge:streak',
    displayName: 'On a roll',
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
 * Everything earned so far.
 *
 * Recomputed from lifetime stats on every load rather than stored as a list, so a
 * corrupted or partial save can't lose something the player earned — and so a rule
 * change here applies retroactively instead of only to new players.
 */
export function earnedUnlocks(context: UnlockContext): string[] {
  return unlocks.filter((unlock) => unlock.achieved(context)).map((unlock) => unlock.id)
}

/** The next thing to aim for, or `undefined` when everything is earned. */
export function nextUnlock(context: UnlockContext): Unlock | undefined {
  return unlocks.find((unlock) => !unlock.achieved(context))
}
