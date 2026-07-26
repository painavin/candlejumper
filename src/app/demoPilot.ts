import type { FrameState } from '@engine/output/index.js'
import type { TradeAction } from '@engine/pipeline/inputBuffer.js'
import { createPrng } from '@shared/math/index.js'

/**
 * The attract-mode autopilot: what presses the buttons while nobody is playing.
 *
 * This is **set dressing, not a strategy**. It exists so the title screen shows a
 * character that trades rather than one that only hops, and nothing about it is
 * advice — it doesn't look at price, only at whether it currently holds something
 * and for how long. Anyone reading it for edge will find none, which is
 * deliberate: a trainer that ships a bundled strategy teaches the wrong lesson.
 *
 * Seeded rather than random, like everything else here, so the same seed replays
 * the same demo — which also makes it testable.
 */

export interface DemoPilot {
  /** One decision per bar, at most. `undefined` means hold. */
  decide(frame: FrameState): TradeAction | undefined
}

/** Chance per bar of opening, when flat. */
const OPEN_CHANCE = 0.07
/** Chance per bar of adding, while holding a winner under the unit cap. */
const ADD_CHANCE = 0.13
/** Bars to hold before exits become possible at all. */
const MIN_HOLD_BARS = 4
/** Chance per bar of exiting one unit, once past the minimum hold. */
const EXIT_CHANCE = 0.22
/** Never deploy more than this many units, so the ghost stack stays readable. */
const MAX_UNITS = 3

export function createDemoPilot(seed: number): DemoPilot {
  const prng = createPrng(seed)
  let decidedIndex = -1
  let barsHeld = 0

  return {
    decide(frame) {
      // One decision per bar: `decide` is called every frame, and pressing on
      // every frame would deploy the whole account in a fraction of a second.
      if (frame.phase !== 'playing' || frame.currentIndex === decidedIndex) return undefined
      decidedIndex = frame.currentIndex

      if (frame.hud.direction === 'flat') {
        barsHeld = 0
        return prng.chance(OPEN_CHANCE) ? 'buy' : undefined
      }

      barsHeld++
      if (
        frame.hud.unrealizedPnl > 0 &&
        frame.hud.unitCount < MAX_UNITS &&
        prng.chance(ADD_CHANCE)
      ) {
        return 'buy'
      }
      if (barsHeld >= MIN_HOLD_BARS && prng.chance(EXIT_CHANCE)) return 'sell'
      return undefined
    },
  }
}
