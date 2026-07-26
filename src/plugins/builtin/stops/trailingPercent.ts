import type { ParamSpec, ParamValues, StopInstance, StopPlugin } from '@shared/contracts/index.js'

/**
 * `trailing-percent` — a level a fixed percent from the best price reached.
 *
 * Ratchets in the position's favour and never rewinds. That falls out of
 * `bestPrice` only ever moving favourably, but the ratchet is also enforced
 * explicitly here: a plugin that quietly widened its own trailing stop would be
 * indistinguishable from one that never had a level, and this one's whole
 * contract is that it tightens.
 *
 * Note that widening is *not* forbidden in general — a volatility stop should
 * widen when volatility rises, and forcing monotonicity would break it. The
 * ratchet is this plugin's own promise, not an engine rule. See
 * docs/stops.md#no-monotonic-tightening-enforcement.
 *
 * Looser default than the fixed stop, precisely because it ratchets.
 */

const PERCENT: ParamSpec = {
  key: 'percent',
  displayName: 'Trail distance',
  type: 'percent',
  default: 8,
  min: 0.1,
  max: 50,
  step: 0.1,
  unit: '%',
}

export const trailingPercentStop: StopPlugin = {
  id: 'trailing-percent',
  displayName: 'Trailing percent',
  params: [PERCENT],

  createInstance(params: ParamValues): StopInstance {
    const fraction = (params.percent ?? (PERCENT.default as number)) / 100
    let ratchet: number | null = null

    return {
      reset() {
        // Called on entry: the previous trade's ratchet must not carry over.
        ratchet = null
      },
      onBar(_bar, position) {
        if (position.size === 0) return null
        const long = position.size > 0
        const candidate = long
          ? position.bestPrice * (1 - fraction)
          : position.bestPrice * (1 + fraction)

        // Tighten only. For a long that means never lowering the level; for a
        // short, never raising it.
        ratchet =
          ratchet === null
            ? candidate
            : long
              ? Math.max(ratchet, candidate)
              : Math.min(ratchet, candidate)
        return ratchet
      },
    }
  },
}
