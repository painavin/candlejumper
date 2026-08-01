import type { IndicatorInstance, IndicatorPlugin, ParamSpec, ParamValues } from '@shared/contracts/index.js'

/**
 * Simple Moving Average — the one built-in indicator, shipped to prove the
 * contract end to end before investing in more content.
 *
 * The **warm-up convention** is the part that matters beyond the arithmetic:
 * return `NaN` until `length` bars exist. Without an explicit "no value yet"
 * signal, the first bars either draw a line from zero or make every renderer
 * special-case startup. `NaN` gives one rule everywhere — and a stop consuming
 * this must translate it to a `null` level rather than passing it through.
 */

const LENGTH: ParamSpec = {
  key: 'length',
  displayName: 'Length',
  type: 'int',
  default: 20,
  min: 2,
  max: 200,
  step: 1,
  unit: 'bars',
}

export const smaIndicator: IndicatorPlugin = {
  id: 'sma',
  displayName: 'Simple Moving Average',
  abbreviation: 'SMA',
  paneKind: 'overlay',
  outputs: ['sma'],
  params: [LENGTH],
  // Exactly the window: the average is NaN until `length` bars exist.
  warmupBars: (params) => Math.max(2, Math.round(params.length ?? (LENGTH.default as number))),

  createInstance(params: ParamValues): IndicatorInstance {
    const length = Math.max(2, Math.round(params.length ?? (LENGTH.default as number)))
    // A ring buffer with a running sum, so cost is bounded as a run gets longer
    // rather than re-summing the window every bar.
    const window = new Float64Array(length)
    let filled = 0
    let cursor = 0
    let sum = 0

    return {
      reset() {
        window.fill(0)
        filled = 0
        cursor = 0
        sum = 0
      },

      onBar(bar) {
        sum -= window[cursor] ?? 0
        window[cursor] = bar.c
        sum += bar.c
        cursor = (cursor + 1) % length
        if (filled < length) filled += 1

        // Not warmed up yet: the renderer skips NaN rather than drawing to zero.
        return { sma: filled < length ? Number.NaN : sum / length }
      },
    }
  },
}

/**
 * Average True Range.
 *
 * Not shipped as an *active* default, but built because **ATR is the first
 * indicator with a second customer**: an ATR/volatility stop and a chandelier stop
 * both need it, so building it unlocks two stop strategies rather than one chart
 * line. It also proves the indicator-consuming stop mechanism end to end.
 */
export const atrIndicator: IndicatorPlugin = {
  id: 'atr',
  displayName: 'Average True Range',
  abbreviation: 'ATR',
  paneKind: 'oscillator',
  outputs: ['atr'],
  params: [{ ...LENGTH, default: 14 }],
  /**
   * The window, plus one.
   *
   * Wilder's smoothing never fully forgets its seed, so strictly it is warm *forever*.
   * `length + 1` is the point where it stops being NaN and starts being a usable
   * approximation, which is the question preload is asking. The extra bar is the first
   * one, whose true range has no previous close to reach back to.
   */
  warmupBars: (params) => Math.max(2, Math.round(params.length ?? 14)) + 1,

  createInstance(params: ParamValues): IndicatorInstance {
    const length = Math.max(2, Math.round(params.length ?? 14))
    let previousClose: number | undefined
    let sum = 0
    let count = 0
    /** Wilder's smoothing once warmed up. */
    let atr = Number.NaN

    return {
      reset() {
        previousClose = undefined
        sum = 0
        count = 0
        atr = Number.NaN
      },

      onBar(bar) {
        const trueRange =
          previousClose === undefined
            ? bar.h - bar.l
            : Math.max(
                bar.h - bar.l,
                Math.abs(bar.h - previousClose),
                Math.abs(bar.l - previousClose)
              )
        previousClose = bar.c

        if (count < length) {
          sum += trueRange
          count += 1
          atr = count < length ? Number.NaN : sum / length
        } else {
          atr = (atr * (length - 1) + trueRange) / length
        }

        return { atr }
      },
    }
  },
}
