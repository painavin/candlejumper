import type { OhlcvBar, PositionState } from '@shared/contracts/index.js'
import type { ActiveStopLevel, StopEngine, StopEvaluation, StopTrigger } from './port.js'

/**
 * Several stop engines behind one port.
 *
 * Needed because the two hosts are not interchangeable *per run*: built-in stops
 * run in-process (they're ours, and a round trip to a worker buys nothing), while
 * player-supplied ones must run sandboxed. A player who configures one of each
 * needs both, and `engine/` must not learn that there is more than one kind.
 *
 * The resolution rule is the same one a single host applies across its own slots —
 * **whichever enforcing level is hit first wins** — so combining engines can't
 * change the outcome relative to one engine holding all the slots. That equivalence
 * is what makes this a composition rather than a policy of its own.
 */
export function createCompositeStopEngine(engines: readonly StopEngine[]): StopEngine {
  if (engines.length === 1) return engines[0] as StopEngine

  return {
    observeBar(bar: OhlcvBar) {
      for (const engine of engines) engine.observeBar(bar)
    },

    evaluate(close: number, position: PositionState): StopEvaluation {
      const breaches: ActiveStopLevel[] = []
      let triggered: StopTrigger | null = null

      for (const engine of engines) {
        const result = engine.evaluate(close, position)
        breaches.push(...result.breaches)
        const candidate = result.triggered
        if (!candidate) continue
        // Tightest binding constraint, sign-flipped for shorts — identical to the
        // rule each engine already uses internally.
        if (
          triggered === null ||
          (position.size > 0 ? candidate.level > triggered.level : candidate.level < triggered.level)
        ) {
          triggered = candidate
        }
      }

      return { triggered, breaches }
    },

    computeLevels(bar: OhlcvBar, position: PositionState) {
      for (const engine of engines) engine.computeLevels(bar, position)
    },

    get levels(): readonly ActiveStopLevel[] {
      return engines.flatMap((engine) => [...engine.levels])
    },

    onEntry() {
      for (const engine of engines) engine.onEntry()
    },

    onExit() {
      for (const engine of engines) engine.onExit()
    },

    reset() {
      for (const engine of engines) engine.reset()
    },

    get hasAdvisoryRule() {
      return engines.some((engine) => engine.hasAdvisoryRule)
    },

    get hasAnyRule() {
      return engines.some((engine) => engine.hasAnyRule)
    },
  }
}
