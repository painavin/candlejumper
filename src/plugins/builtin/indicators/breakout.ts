import type {
  IndicatorInstance,
  IndicatorPlugin,
  ParamSpec,
  ParamValues,
} from '@shared/contracts/index.js'

/**
 * Price breakout — the highest close of the last N bars, and a mark on the bar that
 * sets a new one.
 *
 * Built as its own indicator rather than inline inside the one composite that needs
 * it, for the reason the repo already shares bar-level maths: a breakout window is
 * the input to a whole family of signals (breakout-and-hold, breakout-and-pullback,
 * failed breakout), and each one re-deriving it means each one can be subtly wrong in
 * a different way. It is also perfectly usable on its own — the level line is the
 * resistance a trader is watching.
 *
 * ## Closes, not highs
 *
 * The window measures **closing** prices, which is a deliberate choice and the one
 * most likely to surprise. A single intrabar spike prints a high nobody traded at for
 * more than a moment, so a high-based window puts the level somewhere the market
 * never accepted and then refuses to signal until price exceeds it. A close is where
 * the bar actually settled.
 *
 * ## Warm-up suppresses the signal, which is the point
 *
 * `NaN` until the window is full. Without that, bar one is trivially the highest close
 * of every bar seen so far and every early bar signals a breakout — the run would open
 * with a burst of marks that mean nothing. This is the same warm-up convention as
 * every other indicator, doing real work rather than just avoiding a divide by zero.
 */

const LENGTH: ParamSpec = {
  key: 'length',
  displayName: 'Breakout window',
  type: 'int',
  default: 20,
  min: 2,
  max: 250,
  step: 1,
  unit: 'bars',
}

export const breakoutIndicator: IndicatorPlugin = {
  id: 'breakout',
  displayName: 'Price Breakout',
  abbreviation: 'BRK',
  paneKind: 'overlay',
  outputs: ['level', 'signal'],
  params: [LENGTH],
  // The window, and not one bar more: warm-up is exactly `seen < length`.
  warmupBars: (params) => Math.max(2, Math.round(params.length ?? (LENGTH.default as number))),
  outputStyles: {
    // The level is continuous, so it joins up; the signal happens on scattered bars
    // and must not. Both keep the instance colour: "a new high" has no established
    // reading the way profit and loss do, and the player picks it anyway.
    level: { draw: 'line' },
    signal: { draw: 'dots', offsetPx: 10 },
  },

  createInstance(params: ParamValues): IndicatorInstance {
    const length = Math.max(2, Math.round(params.length ?? (LENGTH.default as number)))

    /**
     * A monotonically decreasing deque of candidate maxima, holding bar numbers.
     *
     * The front is always the window's highest close. Cost is amortised O(1) per bar
     * rather than the O(N) a rescan would cost — the same reason the moving average
     * keeps a running sum instead of re-summing its window. It costs about ten lines.
     *
     * Closes live in a ring of exactly `length` slots, so memory is bounded however
     * long a run goes on. Bar numbers stay absolute and index the ring modulo its
     * size, which is what makes "has this fallen out of the window" a subtraction.
     */
    const candidates: number[] = []
    const closes = new Float64Array(length)
    let seen = 0

    const closeAt = (barNumber: number): number => closes[barNumber % length] as number

    return {
      reset() {
        candidates.length = 0
        closes.fill(0)
        seen = 0
      },

      onBar(bar) {
        const index = seen
        seen += 1

        // Front eviction happens *before* the new close is written, so nothing in the
        // deque can point at the ring slot about to be overwritten. Doing it after
        // would still give the right answer, but only by an argument about which
        // candidate is about to expire — this way there's nothing to argue about.
        while (candidates.length > 0 && (candidates[0] as number) <= index - length) {
          candidates.shift()
        }
        closes[index % length] = bar.c

        // Anything no higher than this close can never be the maximum again. Equals
        // are dropped too, so a bar that ties the window high becomes the front — a
        // flat retest of resistance reads as the same event to a trader watching it.
        while (
          candidates.length > 0 &&
          closeAt(candidates[candidates.length - 1] as number) <= bar.c
        ) {
          candidates.pop()
        }
        candidates.push(index)

        if (seen < length) return { level: Number.NaN, signal: Number.NaN }

        const level = closeAt(candidates[0] as number)
        return {
          level,
          // The tie rule above means `level === bar.c` exactly when this bar set or
          // matched the window high, so the comparison is a formality rather than a
          // second rule that could disagree with the deque.
          signal: bar.c >= level ? bar.c : Number.NaN,
        }
      },
    }
  },
}
