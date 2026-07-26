import type { RunConfig } from '@config/index.js'
import type { PositionEvent } from '../output/events.js'

/**
 * The discipline streak.
 *
 * **It measures rule compliance, not profitability.** A loss taken because the
 * player's own committed rule said to exit is a success — the habit fired
 * correctly and the position was closed on their terms. Not every trade has to
 * be a winner, and a meter that reset on a correctly-taken loss would teach loss
 * aversion, which is the opposite of the curriculum. A win streak would also
 * measure the market's cooperation as much as the player's discipline.
 *
 * See docs/game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak.
 */

/**
 * - `live` — an advisory stop is active, so the meter can actually be lost.
 * - `automated` — only enforcing stops: the engine closes at the level, so
 *   holding past it is impossible and the streak cannot be lost. Labelled rather
 *   than drawn full, so nobody is misled about what it's measuring.
 * - `dormant` — no stop configured, so there is no rule to comply with.
 */
export type MeterState = 'live' | 'automated' | 'dormant'

export interface StreakState {
  meter: MeterState
  /** Consecutive compliant close events. */
  streak: number
  /** `min(1 + streak, maxMultiplier)`. */
  multiplier: number
  /** Realized P&L weighted by the multiplier. Never replaces raw P&L. */
  arcadeScore: number
  /** How many times an ignored advisory level reset the meter. */
  resets: number
  /** Longest compliant run this session, for the results screen. */
  longest: number
}

export interface StreakInputs {
  config: RunConfig
  /** Any advisory stop configured? */
  hasAdvisoryRule: boolean
  /** Any stop at all configured? */
  hasAnyRule: boolean
}

export function initialStreak({ config, hasAdvisoryRule, hasAnyRule }: StreakInputs): StreakState {
  const meter: MeterState = !hasAnyRule || !config.scoring.streakEnabled
    ? 'dormant'
    : hasAdvisoryRule
      ? 'live'
      : 'automated'
  return { meter, streak: 0, multiplier: 1, arcadeScore: 0, resets: 0, longest: 0 }
}

export interface StreakContext {
  config: RunConfig
  /** Is the position currently past an advisory level? Per-bar, not a latch. */
  inBreach: boolean
}

/**
 * Fold one bar's events into the streak.
 *
 * Reset lands **at the breach**, not at the eventual exit: the feedback belongs
 * at the moment the player fails to act, not several bars later when they finally
 * do. A close event while still in breach therefore does nothing — the reset has
 * already happened.
 */
export function applyStreak(
  state: StreakState,
  events: readonly PositionEvent[],
  { config, inBreach }: StreakContext
): StreakState {
  if (state.meter === 'dormant') {
    // No rule to measure. arcadeScore still tracks raw realized P&L so the
    // results screen has one number to show either way.
    let arcade = state.arcadeScore
    for (const event of events) {
      if (event.kind === 'positionClosed') arcade += event.realized
    }
    return { ...state, arcadeScore: arcade }
  }

  let { streak, arcadeScore, resets, longest } = state
  const cap = config.scoring.maxMultiplier
  const multiplierFor = (value: number): number => Math.min(1 + value, cap)

  for (const event of events) {
    switch (event.kind) {
      case 'advisoryBreached':
        // Ignoring your own rule is the only thing that breaks the streak.
        streak = 0
        resets += 1
        break

      case 'positionClosed': {
        // Profit collects at the multiplier already earned — discipline builds
        // it, profit collects on it, so the first compliant close pays ×1.
        const multiplier = multiplierFor(streak)
        arcadeScore += event.profitable ? event.realized * multiplier : event.realized

        // A close event while in breach does not tick: the reset already
        // happened on the breach bar. Otherwise the exit would instantly start
        // rebuilding what the player just failed to honour.
        if (!inBreach) {
          streak += 1
          longest = Math.max(longest, streak)
        }
        break
      }

      case 'stoppedOut':
        // The rule worked, but the engine acted, not the player. Neither a
        // build nor a reset.
        break

      case 'forceClosed':
        // Not a player decision.
        break

      default:
        break
    }
  }

  return { ...state, streak, multiplier: multiplierFor(streak), arcadeScore, resets, longest }
}
