import type { NormalizationMode, RunConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { clamp, damp } from '@shared/math/index.js'
import { applyPriceTransform } from './priceTransform.js'

/**
 * Price → screen height, and the axis that describes it.
 *
 * Three rules make this file more than arithmetic:
 *
 *   1. **Only already-played bars may inform the bounds.** Every mode here is
 *      causal. A mode computing bounds over the whole series would reveal the
 *      run's eventual high and low through the axis, which destroys the
 *      training value even though no future pole is ever drawn. See
 *      docs/game-design.md#why-full-series-normalization-leaks.
 *   2. **The axis is the inverse of this, not a parallel system.** Poles and
 *      axis labels read the same eased bounds, so they cannot disagree about
 *      what the chart is showing.
 *   3. **Bounds span the visible lows and highs, not the closes.** Candles draw
 *      their full range, and a bound that only knows about closes clips every
 *      wick flat against the top and bottom of the chart.
 */

export interface Bounds {
  /** In *value* space — post-transform, post-relative-division. */
  min: number
  max: number
}

export interface Normalizer {
  readonly mode: NormalizationMode
  /** Start of run, or ticker change. */
  reset(firstBar: OhlcvBar | undefined): void
  /** Map a raw price into the value space the bounds are expressed in. */
  valueOf(price: number): number
  /**
   * Recompute target bounds from the played, visible window, then ease the
   * live bounds toward them.
   *
   * @param visible bars currently on screen and already played — never any bar
   *                beyond the playback cursor
   * @param dt      elapsed seconds, so easing is frame-rate independent
   */
  update(visible: readonly OhlcvBar[], dt: number): Bounds
  /** Current eased bounds, without advancing them. */
  readonly bounds: Bounds
  /** 0 at the bottom of the chart, 1 at the top. Clamped. */
  unit(price: number): number
}

/**
 * Padding applied to the window's min/max, as a fraction of its span.
 *
 * Without it the tallest visible pole touches the top of the chart and the
 * shortest has zero height — an invisible pole reads as missing data. The axis
 * inherits the same padding, so labels still describe what's drawn.
 */
const BOUNDS_PADDING = 0.08

/**
 * Minimum span, as a fraction of price, for a window whose bars are all but
 * identical. Otherwise a flat stretch divides by ~0 and the chart explodes into
 * noise at full amplitude.
 */
const MIN_SPAN_FRACTION = 0.005

/**
 * Fraction of the gap left after one second of easing. The default
 * `visible-window-min-max` mode shifts its bounds as the window slides, so
 * without easing every new extreme snaps the whole chart — this is load-bearing
 * rather than cosmetic (docs/hud.md).
 */
const BOUNDS_SMOOTHING = 0.02

export function createNormalizer(config: RunConfig): Normalizer {
  const { normalizationMode: mode, priceTransform, normalizationReference } = config

  let referenceClose: number | undefined
  /** Locked at run start for `fixed-price-per-pixel`; never rescales after. */
  let lockedSpan: number | undefined
  let live: Bounds = { min: 0, max: 1 }
  let initialized = false

  const valueOf = (price: number): number => {
    const transformed = applyPriceTransform(price, priceTransform)
    if (mode === 'starting-price-relative') {
      const base =
        referenceClose === undefined
          ? transformed
          : applyPriceTransform(referenceClose, priceTransform)
      // In log space a ratio is a difference, so express "relative to start"
      // additively there — dividing log values is meaningless.
      return priceTransform === 'log10'
        ? (transformed - base) * normalizationReference + normalizationReference
        : (transformed / base) * normalizationReference
    }
    return transformed
  }

  const padded = (min: number, max: number): Bounds => {
    const mid = (min + max) / 2
    const minSpan = Math.max(Math.abs(mid) * MIN_SPAN_FRACTION, Number.EPSILON)
    const span = Math.max(max - min, minSpan)
    const pad = span * BOUNDS_PADDING
    return { min: mid - span / 2 - pad, max: mid + span / 2 + pad }
  }

  const targetBounds = (visible: readonly OhlcvBar[]): Bounds => {
    if (visible.length === 0) return live

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const bar of visible) {
      // The **low and the high**, not the close. `unit()` clamps to 0..1, so
      // bounds taken from closes alone don't push a wick off-chart where it would
      // be noticed — they silently flatten every high above the window's highest
      // close into a line along the chart ceiling.
      //
      // Min/max of the pair rather than assuming `l <= h`: a malformed bar from a
      // bad CSV should widen the window, not invert it.
      const a = valueOf(bar.l)
      const b = valueOf(bar.h)
      if (Math.min(a, b) < min) min = Math.min(a, b)
      if (Math.max(a, b) > max) max = Math.max(a, b)
    }

    if (mode === 'fixed-price-per-pixel') {
      // A constant scale factor: the span never changes once locked, so nothing
      // rescales. The view pans to keep the window centred, which is the only
      // way a fixed span can follow a trending series without leaving it.
      const window = padded(min, max)
      lockedSpan ??= window.max - window.min
      const mid = (min + max) / 2
      return { min: mid - lockedSpan / 2, max: mid + lockedSpan / 2 }
    }

    return padded(min, max)
  }

  return {
    mode,

    reset(firstBar) {
      referenceClose = firstBar?.c
      lockedSpan = undefined
      initialized = false
      live = { min: 0, max: 1 }
    },

    valueOf,

    update(visible, dt) {
      const target = targetBounds(visible)
      if (!initialized) {
        // Snap on the first frame; easing from a placeholder 0..1 would send the
        // whole chart flying in from nowhere.
        live = target
        initialized = visible.length > 0
      } else {
        live = {
          min: damp(live.min, target.min, BOUNDS_SMOOTHING, dt),
          max: damp(live.max, target.max, BOUNDS_SMOOTHING, dt),
        }
      }
      return live
    },

    get bounds() {
      return live
    },

    unit(price) {
      const span = live.max - live.min
      if (span <= 0) return 0.5
      return clamp((valueOf(price) - live.min) / span, 0, 1)
    },
  }
}
