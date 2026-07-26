import type { OhlcvBar, PositionState } from '@shared/contracts/index.js'

/**
 * The port stops answer through.
 *
 * `engine/` defines what it asks for; `plugins/host/` supplies the
 * implementations — one in-process for the built-ins, one worker-sandboxed for
 * user code at roadmap step 8. That split is what lets step 4 ship working stops
 * before the sandbox exists, and makes step 8 an implementation swap rather than
 * a rewrite of this wiring.
 *
 * Note which side of the boundary the wiring sits on: **`engine/` never learns
 * that stops can use indicators.** It asks for a level and gets a number or
 * null. Dependency resolution, instance ownership, and per-bar feeding are all
 * host concerns. See docs/code-structure.md.
 */

export interface ActiveStopLevel {
  stopId: string
  /** Absolute price. Never NaN — the engine coerces non-finite to absent. */
  level: number
  /** Advisory levels display but never close; the player must honour them. */
  advisory: boolean
}

export interface StopTrigger {
  stopId: string
  level: number
}

export interface StopEvaluation {
  /**
   * The enforcing level that fired, if any. With several active, whichever is
   * hit first — effectively the tightest binding constraint.
   */
  triggered: StopTrigger | null
  /** Advisory levels this bar's close is past. Drives compliance events. */
  breaches: readonly ActiveStopLevel[]
}

export interface StopEngine {
  /**
   * Fed **every bar from the first bar of the run**, whether or not a position
   * is open. Only the stop's own `onBar` is gated on having a position; its
   * indicators must keep warming, or a 14-bar ATR stop restarts warm-up on every
   * entry and offers no level for the first 14 bars of each trade.
   */
  observeBar(bar: OhlcvBar): void

  /** Step 5: levels computed at bar N−1, evaluated against bar N's close. */
  evaluate(close: number, position: PositionState): StopEvaluation

  /** Step 6: ask each active plugin for the level to enforce on bar N+1. */
  computeLevels(bar: OhlcvBar, position: PositionState): void

  /** Current levels, for the HUD to draw. Solid if enforcing, dashed if advisory. */
  readonly levels: readonly ActiveStopLevel[]

  /** A position opened from flat. Resets per-trade stop state, not indicators. */
  onEntry(): void

  /** The position returned to flat. Clears levels. */
  onExit(): void

  /** Run start or ticker change. Resets everything, including indicators. */
  reset(): void

  /**
   * Whether any *advisory* stop is configured. Determines whether the discipline
   * streak has a rule to measure at all — with none, the meter is dormant.
   */
  readonly hasAdvisoryRule: boolean

  /** Whether any stop at all is configured. */
  readonly hasAnyRule: boolean
}

/**
 * The empty implementation: a run with no stops configured.
 *
 * A valid configuration — the player is then fully in charge of exits, which
 * supports the "full manual discipline" risk profile. The discipline streak goes
 * dormant, since there is no committed rule to comply with.
 */
export function createNoStops(): StopEngine {
  return {
    observeBar() {},
    evaluate: () => ({ triggered: null, breaches: [] }),
    computeLevels() {},
    levels: [],
    onEntry() {},
    onExit() {},
    reset() {},
    hasAdvisoryRule: false,
    hasAnyRule: false,
  }
}

/**
 * A level is only usable if it's a finite number.
 *
 * Belt and braces against a plugin returning NaN during indicator warm-up: every
 * comparison against NaN is false, so a NaN level is a stop the HUD shows as
 * active that can never fire — strictly worse than having no stop. The plugin
 * contract requires `null`; this guarantees it regardless of what came back.
 * See docs/stops.md#warm-up-must-produce-null-never-a-nan-level.
 */
export function usableLevel(level: number | null | undefined): number | null {
  return typeof level === 'number' && Number.isFinite(level) ? level : null
}
