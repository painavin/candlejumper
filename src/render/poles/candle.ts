import type { BarStyle } from '@config/index.js'
import type { BarDirection, VisibleBar } from '@engine/output/index.js'
import { clamp, lerp } from '@shared/math/index.js'
import type { Layout } from '../stage/layout.js'
import { unitToY } from '../stage/layout.js'

/**
 * Candle geometry: four unit heights and a layout in, two rectangles out.
 *
 * Pixi-free on purpose, the same split as `axis.ts`/`axisLayer.ts` and
 * `voicing.ts`/`bed.ts` — the interesting part here is arithmetic with an
 * invariant worth asserting (the range always encloses the body, at every point
 * of the growth animation), and arithmetic should be testable without a renderer.
 *
 * ## Why bars float
 *
 * They used to be columns rising from the ground, which drew a *close* and nothing
 * else: the open, high, and low were simply absent from the screen even though
 * every one of them was already in the data. A trading-habit trainer whose chart
 * can't show a bar's range is teaching from a chart the player will never see
 * again once they open a real terminal.
 *
 * ## One routine, two chart types
 *
 * A candlestick and a Bollinger bar differ **only** in how wide the high–low
 * range is drawn relative to the body:
 *
 *   - narrow range → a candlestick's wick
 *   - range as wide as the body → a Bollinger bar, one uniform column whose
 *     open→close section is picked out in the direction colour
 *
 * So the width is a parameter and there is no branch on chart type. Everything
 * else — colour by direction, neutral range, the forming animation — is shared,
 * because it's the same information either way.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Which way the body points. Re-exported from the engine rather than redefined: the
 * volume bar is coloured from the same value, and two definitions is two things to
 * keep in step.
 */
export type CandleDirection = BarDirection

export interface CandleShape {
  /** Body of the bar: open to close, coloured. */
  body: Rect
  /** High to low, neutral. Always encloses `body`. */
  range: Rect
  direction: CandleDirection
  /** Still forming, i.e. the bar currently under the character. */
  forming: boolean
}

/**
 * Floor for a drawn height, in pixels.
 *
 * A bar that closes where it opened has zero body, and zero pixels is
 * indistinguishable from missing data — a doji has to read as a flat mark on the
 * range, which is what it means. One constant for both rectangles rather than two:
 * a taller floor on the body than on the range is enough on its own to break the
 * enclosure invariant, which is how that bug arrived the first time.
 */
const MIN_DRAWN_HEIGHT = 2

/** Range width, as a fraction of the body, for each explicit bar style. */
const STYLE_WIDTHS = {
  /** A visible wick that still reads as a wick rather than as a second bar. */
  candlestick: 0.16,
  /** Body and range identical, which is what makes it one uniform column. */
  bollinger: 1,
} as const

/**
 * The range width the chosen style implies.
 *
 * A lookup rather than a branch at the call site, so the two chart types stay one
 * number apart. It used to also resolve a `theme` setting that deferred to the active
 * mood's own width; both moods asked for Bollinger bars, so that indirection only ever
 * produced the default.
 */
export function wickWidthFor(style: BarStyle): number {
  return STYLE_WIDTHS[style]
}

/**
 * Screen x of a bar's centre.
 *
 * The newest bar sits under the character and slides left as the bar progresses;
 * the next one spawns exactly where this one started.
 */
export function candleCentreX(age: number, barPhase: number, layout: Layout): number {
  return layout.characterX - (age + barPhase) * layout.barWidth
}

/**
 * A vertical span between two unit heights, as a rectangle, never thinner than
 * `minHeight`.
 *
 * The floor is applied symmetrically about the midpoint rather than by extending
 * one edge, so a doji stays centred on the price it actually printed instead of
 * drifting up or down by a pixel.
 */
function span(
  topUnit: number,
  bottomUnit: number,
  centreX: number,
  width: number,
  layout: Layout
): Rect {
  const top = unitToY(Math.max(topUnit, bottomUnit), layout)
  const bottom = unitToY(Math.min(topUnit, bottomUnit), layout)
  const height = Math.max(bottom - top, MIN_DRAWN_HEIGHT)
  const centreY = (top + bottom) / 2
  return { x: centreX - width / 2, y: centreY - height / 2, width, height }
}

/**
 * Slide `inner` vertically until it sits inside `outer`.
 *
 * Needed because the minimum-height floor is applied to each rectangle
 * independently, and two spans that are both shorter than the floor come out the
 * same height but centred a fraction apart — so the body can end up a sliver
 * outside its own high or low. Sub-pixel, but this is the invariant the whole shape
 * rests on, and enforcing it here makes it true by construction rather than true
 * for the inputs someone happened to try.
 *
 * Safe because `inner` is never the taller of the two: real body height never
 * exceeds real range height, and both get the same floor.
 */
function contain(inner: Rect, outer: Rect): Rect {
  const lowest = outer.y + outer.height - inner.height
  if (lowest < outer.y) return inner // outer somehow shorter; leave it alone
  return { ...inner, y: Math.min(Math.max(inner.y, outer.y), lowest) }
}

export function candleShape(
  bar: VisibleBar,
  layout: Layout,
  wickWidthFraction: number
): CandleShape {
  const centreX = candleCentreX(bar.age, 0, layout)
  return candleShapeAt(bar, layout, wickWidthFraction, centreX)
}

/** As `candleShape`, with the scroll offset already resolved by the caller. */
export function candleShapeAt(
  bar: VisibleBar,
  layout: Layout,
  wickWidthFraction: number,
  centreX: number
): CandleShape {
  const growth = clamp(bar.growth, 0, 1)

  /**
   * The forming bar extends **from its open**, which is where a real bar starts
   * and the only endpoint that's fixed for the whole of its formation.
   *
   * Interpolating all three of close, high, and low from the open by the *same*
   * factor is what guarantees the range still encloses the body at every
   * intermediate frame: `unit()` is monotonic, so `high >= close >= open` in price
   * order survives into unit order, and `lerp` with a shared `t` preserves it.
   */
  const openUnit = bar.openUnit
  const closeUnit = lerp(openUnit, bar.unit, growth)
  const highUnit = lerp(openUnit, bar.highUnit, growth)
  const lowUnit = lerp(openUnit, bar.lowUnit, growth)

  const bodyWidth = layout.poleWidth
  // Clamped to the body: a range wider than the body would read as a second,
  // conflicting bar rather than as one.
  const rangeWidth = clamp(bodyWidth * wickWidthFraction, 1, bodyWidth)

  // Taken from the frame rather than recomputed here. It's derived from the raw
  // prices — see `BarDirection` — and the volume pane reads the same field, so a
  // candle and its volume bar cannot end up disagreeing about which way the day went.
  const direction = bar.direction

  const range = span(highUnit, lowUnit, centreX, rangeWidth, layout)

  return {
    body: contain(span(closeUnit, openUnit, centreX, bodyWidth, layout), range),
    range,
    direction,
    forming: bar.growth < 1,
  }
}

/** Whether any part of the candle is still on screen. */
export function isOnScreen(shape: CandleShape): boolean {
  return shape.body.x + shape.body.width >= 0
}
