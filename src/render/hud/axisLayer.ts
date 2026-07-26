import { Container, Graphics, Text } from 'pixi.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { unitToY } from '../stage/layout.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { AxisFormat } from './axis.js'
import { axisLabels, axisUnitLabel } from './axis.js'
import { LAYOUT } from '@config/index.js'
import { hudDimTextStyle, hudTextStyle } from './hudText.js'
import { drawPanel } from './hudPanel.js'

/**
 * The right-edge price axis, drawn as a HUD layer *above* the fog so it stays
 * legible even though the world behind it is obscured.
 *
 * Placed right because that's where real charting tools put the newest data and
 * where the player's eye already is.
 */

export interface AxisLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

/**
 * Width of the axis gutter.
 *
 * Wider than the old 52 because the labels are a size larger and now sit on a plate
 * with padding of its own. The indicator sub-panes stop at the same offset, which is
 * why it's exported rather than repeated.
 */
export const AXIS_WIDTH = 62

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

      lines.clear()

      // The axis gets its own plate, for the same reason the readouts do: a price
      // label sitting directly on sky belongs to the picture, and one sitting on a
      // bordered strip belongs to the chart. It also gives the gutter a defined edge
      // rather than letting the labels float in the fog.
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
        // A gridline all the way across, so a price level is readable against a
        // bar rather than only at the edge. Stops at the plate's edge so it doesn't
        // strike through the label describing it.
        lines.rect(0, y, axisX, 1).fill({ color: theme.accent.axisLine, alpha: 0.35 })
      })
    },
  }
}
