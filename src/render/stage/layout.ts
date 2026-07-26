import { LAYOUT } from '@config/index.js'

/**
 * Screen geometry for one frame size.
 *
 * The load-bearing detail is that **playfield width is the pole region only** —
 * left edge to the character — not the full viewport. Unplayed poles are never
 * rendered, so the fog strip right of the character never contains poles;
 * measuring bar width against the full viewport would silently shrink the
 * visible history by 25% and make `visibleBarCount` a lie. See
 * docs/game-design.md#scroll-speed-timing-and-pole-geometry.
 */

export interface Layout {
  width: number
  height: number
  isPortrait: boolean
  /** Reserved for the top HUD, including space for the streak meter. */
  topHudHeight: number
  chartTop: number
  chartHeight: number
  /** Baseline poles stand on. */
  groundY: number
  /** The traded "now" line; the character is pinned here. */
  characterX: number
  /** Left edge to `characterX`. */
  playfieldWidth: number
  /** `characterX` to the right edge — atmosphere and the Y axis, never poles. */
  fogWidth: number
  /** One bar's horizontal slot, including its gap. */
  barWidth: number
  /** The drawn pole, narrower than its slot. */
  poleWidth: number
  /** Top y of each sub-pane, and the height they each get. */
  subPaneTops: number[]
  subPaneHeight: number
  /** Cap on concurrent sub-panes for this viewport. */
  maxSubPanes: number
}

/**
 * Height reserved for the top HUD band.
 *
 * Has to cover the tallest the plates can get, because they size themselves to their
 * text rather than being clipped to a fixed band — so this and `SIZES` in `topHud.ts`
 * have to be changed together. Portrait is taller despite smaller type: the streak
 * plate can't fit beside the primary one at phone widths, so it wraps to a second row.
 */
const TOP_HUD_HEIGHT = { landscape: 74, portrait: 96 } as const
/** Breathing room under the poles so the ground line reads as ground. */
const GROUND_MARGIN = 28
/**
 * Reserved for the mobile thumb buttons, allocated **before** sub-panes so the
 * buttons never overlap a pane. docs/controls.md requires that ordering.
 */
const MOBILE_CONTROL_STRIP = 108

export function computeLayout(
  width: number,
  height: number,
  visibleBarCount: number,
  subPaneCount = 0
): Layout {
  const isPortrait = height > width
  const topHudHeight = isPortrait ? TOP_HUD_HEIGHT.portrait : TOP_HUD_HEIGHT.landscape

  const characterX = width * LAYOUT.characterXFraction
  const playfieldWidth = characterX
  const barWidth = playfieldWidth / visibleBarCount

  const chartTop = topHudHeight + 12
  // Vertical space is allocated top-down so gameplay never gets squeezed by a stack
  // of analytics: HUD, then the mobile control strip, then whatever remains is the
  // chart area.
  const controlStrip = isPortrait ? MOBILE_CONTROL_STRIP : 0
  const chartArea = Math.max(1, height - chartTop - GROUND_MARGIN - controlStrip)

  // On mobile there isn't the vertical room for more than one pane; three unreadable
  // slivers is worse than one readable pane.
  const maxSubPanes = isPortrait ? 1 : 3
  const panes = Math.max(0, Math.min(subPaneCount, maxSubPanes))

  // One rule, not two: sub-panes share 40% of the chart area divided equally, and the
  // main chart keeps the other 60%. The main chart's floor *is* the budget's
  // complement, so the two can't disagree.
  const paneBudget = panes === 0 ? 0 : chartArea * (1 - LAYOUT.mainChartFractionWithSubPanes)
  const subPaneHeight = panes === 0 ? 0 : paneBudget / panes
  const groundY = chartTop + (chartArea - paneBudget)

  const subPaneTops = Array.from({ length: panes }, (_, index) => groundY + index * subPaneHeight + 6)

  return {
    subPaneTops,
    subPaneHeight: Math.max(0, subPaneHeight - 8),
    maxSubPanes,
    width,
    height,
    isPortrait,
    topHudHeight,
    chartTop,
    chartHeight: Math.max(1, groundY - chartTop),
    groundY,
    characterX,
    playfieldWidth,
    fogWidth: width - characterX,
    barWidth,
    poleWidth: barWidth * (1 - LAYOUT.poleGapFraction),
  }
}

/** Screen y for a 0..1 unit height. 0 sits on the ground, 1 at the chart top. */
export function unitToY(unit: number, layout: Layout): number {
  return layout.groundY - unit * layout.chartHeight
}
