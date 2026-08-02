import { LAYOUT } from '@config/index.js'
import { arc, clamp, lerp } from '@shared/math/index.js'

/**
 * Where the character is, as a continuous function of the bar in progress.
 *
 * Pixi-free and pure, the same split as `candle.ts`/`poleLayer.ts` — the interesting
 * part is the timing, and timing should be testable without a renderer.
 *
 * ## It stands on bars, and only on closed ones
 *
 * The character used to be pinned at `characterX` and hop during the growth window, so
 * it landed on a bar exactly as that bar finished forming. Two things were wrong with
 * that, and they were the same thing seen twice. It never travelled with the bar, so for
 * three quarters of every bar it hung motionless while the bar it had just landed on slid
 * out from under it — reading as a slide, because a fixed point against a moving world
 * *is* a slide. And it committed to a bar that was still being drawn.
 *
 * So the perch is now **the most recently closed bar**, and the character rides it: its x
 * follows that bar leftward at the scroll speed, exactly as the pole does. When the
 * forming bar closes, the character leaps one bar width to the right onto it and rides
 * that one. Standing on a bar that has closed is also the honest version of the rule the
 * rest of the game runs on — a bar's close is what the game fills at, and a bar that
 * hasn't closed has no close to stand on.
 *
 * `characterX` is therefore the line the character *arrives at*, not where it lives. It
 * oscillates in a band about one bar wide to the left of it, which is what an
 * auto-runner hopping from platform to platform looks like.
 *
 * ## Continuity is the whole design
 *
 * `barsBehind` is `phase + (1 - hop)`, and that single expression is why nothing jumps.
 * Both perches — the previous bar and the forming one — move left with the phase and sit
 * exactly one bar width apart, so the hop closes a gap of exactly 1 while both ends
 * travel. It is continuous at the moment the hop starts, at the moment it ends, **and**
 * across the bar boundary, where the bar the character rode becomes "the previous bar"
 * and its offset of 1 is picked up unchanged.
 *
 * The hop is still fixed-height with a variable landing. An arc scaled to the height
 * difference would need the next bar's price before jumping, which is the future
 * information the no-lookahead constraint forbids.
 */

export interface Gait {
  /**
   * How far left of `characterX` the character is, in bar widths.
   *
   * The same units `candle.ts` uses for a pole, so the character and the bar it is
   * standing on are positioned by the same arithmetic and cannot drift apart.
   */
  barsBehind: number
  /** Chart height 0..1 of the perch, interpolated across the hop. */
  unit: number
  /** 0 grounded, 1 landed; the arc is derived from it. */
  hop: number
  /** Height of the arc above the interpolated line, in bar widths. Peaks mid-hop. */
  liftInBarWidths: number
}

export interface GaitInputs {
  /** 0..1 through the bar currently forming. */
  barPhase: number
  /** Close of the bar that has just closed — the perch being left. */
  previousUnit: number | undefined
  /** Close of the bar currently forming — the perch being jumped to. */
  newestUnit: number
}

export function gaitOf({ barPhase, previousUnit, newestUnit }: GaitInputs): Gait {
  const phase = clamp(barPhase, 0, 1)
  const growth = clamp(LAYOUT.barGrowthFraction, 0, 1)
  const duration = LAYOUT.hopDurationFraction

  /**
   * The hop starts the instant the bar closes, never before.
   *
   * A zero or negative duration would divide by zero; treated as instantaneous, which
   * keeps a nonsense constant from producing NaN coordinates.
   */
  const hop = duration <= 0 ? (phase >= growth ? 1 : 0) : clamp((phase - growth) / duration, 0, 1)

  return {
    // Riding, not standing: the perch moves left with the phase, and the hop closes the
    // one-bar-width gap between the old perch and the new one.
    barsBehind: phase + (1 - hop),
    // No previous bar yet on the very first one, so there is nothing to leave: the
    // character starts where it would have landed.
    unit: lerp(previousUnit ?? newestUnit, newestUnit, hop),
    hop,
    liftInBarWidths: arc(hop) * LAYOUT.hopHeightInBarWidths,
  }
}
