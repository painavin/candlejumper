import { Container, Graphics, Text } from 'pixi.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { unitToY } from '../stage/layout.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { AxisFormat } from './axis.js'
import { axisLabels, axisUnitLabel } from './axis.js'
import { LAYOUT } from '@config/index.js'
import { HUD_FONT, hudFontSize } from './hudFont.js'

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

export function createAxisLayer(format: AxisFormat, theme: VisualTheme): AxisLayer {
  const container = new Container()
  const lines = new Graphics()
  container.addChild(lines)

  const labels = Array.from({ length: LAYOUT.axisLabelCount }, () => {
    const text = new Text({
      text: '',
      style: {
        fontFamily: HUD_FONT,
        // Minimum legible size on a phone; docs/accessibility.md.
        fontSize: hudFontSize(12),
        fill: theme.accent.dim,
      },
    })
    text.anchor.set(0, 0.5)
    container.addChild(text)
    return text
  })

  const unitLabel = new Text({
    text: axisUnitLabel(format),
    style: {
      fontFamily: HUD_FONT,
      fontSize: hudFontSize(11),
      fill: theme.accent.dim,
    },
  })
  unitLabel.anchor.set(0, 0)
  container.addChild(unitLabel)

  return {
    container,

    draw(frame, layout) {
      const values = axisLabels(frame.bounds, format)
      const axisX = layout.width - 52

      lines.clear()
      unitLabel.position.set(axisX, layout.chartTop - 16)

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
        // pole rather than only at the edge.
        lines.rect(0, y, axisX, 1).fill({ color: theme.accent.axisLine, alpha: 0.35 })
      })

      lines.rect(axisX, layout.chartTop - 20, 1, layout.groundY - layout.chartTop + 20).fill({
        color: theme.accent.axisLine,
        alpha: 0.85,
      })
    },
  }
}
