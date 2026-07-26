import type { ParamSpec, ParamValues, StopInstance, StopPlugin } from '@shared/contracts/index.js'

/**
 * `fixed-percent` — a level a fixed percent from average entry.
 *
 * Recomputed as `avgCost` changes when scaling in, so the stop follows the
 * position's actual basis rather than its first fill. Direction-aware: below
 * entry when long, above when short — the same code with a sign flip, not a
 * second implementation.
 *
 * Declares no `requires()`, so it works before an indicator registry exists.
 */

const PERCENT: ParamSpec = {
  key: 'percent',
  displayName: 'Distance from entry',
  type: 'percent',
  default: 5,
  min: 0.1,
  max: 50,
  step: 0.1,
  unit: '%',
}

export const fixedPercentStop: StopPlugin = {
  id: 'fixed-percent',
  displayName: 'Fixed percent from entry',
  params: [PERCENT],

  createInstance(params: ParamValues): StopInstance {
    const fraction = (params.percent ?? (PERCENT.default as number)) / 100

    return {
      reset() {
        // Nothing per-trade to remember: the level is a pure function of avgCost.
      },
      onBar(_bar, position) {
        if (position.size === 0) return null
        const long = position.size > 0
        return long ? position.avgCost * (1 - fraction) : position.avgCost * (1 + fraction)
      },
    }
  },
}
