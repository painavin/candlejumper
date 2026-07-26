import type { Graphics } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'

/**
 * The plate behind a group of HUD readouts.
 *
 * ## Why a plate rather than more outline
 *
 * Outlining the glyphs (see `hudText.ts`) made the numbers legible; it didn't make
 * them read as *instruments*. Text floating directly on sky reads as an overlay on a
 * picture, and the eye has to find each value on its own. A bordered plate does two
 * things outline can't: it groups values that belong together, and it gives every
 * number a constant local background, so a readout doesn't change character as a
 * cloud passes behind it.
 *
 * ## Why it's translucent
 *
 * Attract mode plays behind the menus for the same reason the game plays behind the
 * HUD: hiding the thing you're advertising defeats the point. The fill is opaque
 * enough to settle the background and no more.
 *
 * Colours come from the theme — `accent.outline` for the fill (it's already the
 * theme's "behind text" dark) and `accent.axisLine` for the border, so a plate matches
 * the gridlines it sits above rather than introducing a third greyscale.
 */

export interface PanelBox {
  x: number
  y: number
  width: number
  height: number
}

/** Corner radius. Soft enough to read as a panel, tight enough to read as an instrument. */
const RADIUS = 6

/** Opaque enough to settle whatever is behind it, transparent enough to see through. */
const FILL_ALPHA = 0.46

const BORDER_ALPHA = 0.7
const BORDER_WIDTH = 1

/** Inner padding, and the gap between plates. Portrait is tighter on both. */
export const PANEL_PADDING = { landscape: 9, portrait: 6 } as const
export const PANEL_GAP = 8
/** Distance from the viewport edge. */
export const PANEL_MARGIN = 10
/** Vertical gap between two rows of text inside one plate. */
export const PANEL_ROW_GAP = 2

export function drawPanel(graphics: Graphics, box: PanelBox, theme: VisualTheme): void {
  graphics
    .roundRect(box.x, box.y, box.width, box.height, RADIUS)
    .fill({ color: theme.accent.outline, alpha: FILL_ALPHA })
    .stroke({ color: theme.accent.axisLine, alpha: BORDER_ALPHA, width: BORDER_WIDTH })
}

/** Right edge of a box, for laying the next one out beside it. */
export function rightOf(box: PanelBox): number {
  return box.x + box.width
}

/** Bottom edge of a box, for stacking. */
export function bottomOf(box: PanelBox): number {
  return box.y + box.height
}
