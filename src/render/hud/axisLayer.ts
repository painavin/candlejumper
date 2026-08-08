import { Container, Graphics, Text } from 'pixi.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { AXIS_WIDTH, unitToY } from '../stage/layout.js'
import { MAX_MARKERS, stopColour, visibleStops } from './stopMarker.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { AxisFormat } from './axis.js'
import { formatValue } from './axis.js'
import { axisLabels, axisUnitLabel } from './axis.js'
import { LAYOUT } from '@config/index.js'
import { hudDimTextStyle, hudTextStyle } from './hudText.js'
import { drawPanel } from './hudPanel.js'

/**
 * The right-edge price axis, drawn as a HUD layer above the world so it stays
 * legible over whatever is behind it.
 *
 * Placed right because that's where real charting tools put the newest data and
 * where the player's eye already is.
 */

export interface AxisLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

// Re-exported so the layers that already import it from here keep working; the
// constant itself lives in `stage/layout.ts`, which is Pixi-free.
export { AXIS_WIDTH } from '../stage/layout.js'

/**
 * How close a gridline label may come to a stop tag before it yields, in pixels.
 *
 * Just over the tag's own half-height, so the two never touch rather than merely never
 * overlapping — abutting text on a narrow plate still reads as one smear.
 */
const TAG_CLEARANCE = 11


export function createAxisLayer(format: AxisFormat, theme: VisualTheme): AxisLayer {
  const container = new Container()
  const lines = new Graphics()
  container.addChild(lines)

  const labels = Array.from({ length: LAYOUT.axisLabelCount }, () => {
    // Primary, not dim. A price label is a value the player reads off the chart to
    // decide with — it was the least legible thing on screen while it was secondary.
    const text = new Text({ text: '', style: hudTextStyle({ theme, size: 13 }) })
    text.anchor.set(0, 0.5)
    container.addChild(text)
    return text
  })

  /**
   * Stop-level tags, pooled — at most `MAX_MARKERS` of them.
   *
   * The stop's *number* belongs on the price axis rather than on the chart: this is
   * where every other price already is, so a player reads one convention instead of two,
   * and the axis already draws its gridlines the full width — so a tag here gives back
   * the horizontal reference the old stop line provided, without drawing a line.
   */
  const tags = Array.from({ length: MAX_MARKERS }, () => {
    const plate = new Graphics()
    const text = new Text({ text: '', style: hudTextStyle({ theme, size: 12 }) })
    text.anchor.set(0, 0.5)
    container.addChild(plate, text)
    return { plate, text }
  })

  const unitLabel = new Text({
    text: axisUnitLabel(format),
    style: hudDimTextStyle(theme, 12),
  })
  unitLabel.anchor.set(0, 0)
  container.addChild(unitLabel)

  return {
    container,

    draw(frame, layout) {
      const values = axisLabels(frame.bounds, format)
      const axisX = layout.width - AXIS_WIDTH
      const stops = visibleStops(frame.stopLines)

      lines.clear()

      // The axis gets its own plate, for the same reason the readouts do: a price
      // label sitting directly on sky belongs to the picture, and one sitting on a
      // bordered strip belongs to the chart. It also gives the gutter a defined edge
      // rather than letting the labels float over open sky.
      drawPanel(
        lines,
        {
          x: axisX,
          y: layout.chartTop - 22,
          width: AXIS_WIDTH - 4,
          height: layout.groundY - layout.chartTop + 26,
        },
        theme
      )

      unitLabel.position.set(axisX + 6, layout.chartTop - 18)

      labels.forEach((label, i) => {
        const value = values[i]
        if (!value) {
          label.visible = false
          return
        }
        label.visible = true
        const y = unitToY(value.unit, layout)
        label.text = value.text
        label.position.set(axisX + 6, y)
        /**
         * Hidden when a stop tag would land on it.
         *
         * Two prices overlapping on a 62px plate is an unreadable smear, and worse than
         * losing either — so the gridline label yields to the stop, which is the one the
         * player is actively watching. The gridline itself still draws: the row keeps its
         * horizontal reference even without its number.
         */
        if (stops.some((line) => Math.abs(unitToY(line.unit, layout) - y) < TAG_CLEARANCE)) {
          label.visible = false
        }
        // A gridline all the way across, so a price level is readable against a
        // bar rather than only at the edge. Stops at the plate's edge so it doesn't
        // strike through the label describing it.
        lines.rect(0, y, axisX, 1).fill({ color: theme.accent.axisLine, alpha: 0.35 })
      })

      tags.forEach((tag, index) => {
        const line = stops[index]
        if (!line) {
          tag.plate.visible = false
          tag.text.visible = false
          return
        }
        const y = unitToY(line.unit, layout)
        // The same value the hedgehog is tinted with — see `stopColour`.
        const colour = stopColour(line, theme)
        tag.plate.visible = true
        tag.text.visible = true
        tag.plate.clear()
        /**
         * Filled for enforcing, outlined for advisory — the same structural split the
         * marker uses, so the two agree at a glance. A tag whose fill contradicted its
         * hedgehog would be worse than no tag.
         */
        tag.plate.roundRect(axisX + 2, y - 9, AXIS_WIDTH - 6, 18, 4)
        if (line.advisory) tag.plate.stroke({ color: colour, width: 1.2, alpha: 0.95 })
        else tag.plate.fill({ color: colour, alpha: 0.9 })
        tag.text.text = formatValue(line.level, format)
        // Dark ink on a filled plate, the theme's ink on an outlined one.
        tag.text.style.fill = line.advisory ? colour : theme.accent.outline
        tag.text.position.set(axisX + 6, y)
      })
    },
  }
}
