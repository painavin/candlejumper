import { Container, Graphics, Text } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { unitToY } from '../stage/layout.js'
import { HUD_FONT, hudFontSize } from './hudFont.js'

/**
 * Stop levels drawn on the chart, so the player can watch one approach rather
 * than only read a number.
 *
 * **Enforcing stops draw solid; advisory stops draw dashed.** The player must
 * never be unsure whether a line will actually save them — that ambiguity is the
 * one thing this layer exists to prevent. See docs/hud.md#top-hud.
 */

export interface StopLinesLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

const DASH = 9
const GAP = 6

export function createStopLinesLayer(enabled: boolean, theme: VisualTheme): StopLinesLayer {
  const container = new Container()
  const lines = new Graphics()
  container.addChild(lines)

  /** One label per line, pooled — several stops can be active at once. */
  const labels: Text[] = []

  return {
    container,

    draw(frame, layout) {
      lines.clear()
      container.visible = enabled
      if (!enabled) return

      frame.stopLines.forEach((line, index) => {
        const y = unitToY(line.unit, layout)
        // A breached advisory level brightens: the player is past their own rule
        // and the line is the only thing saying so.
        const colour = line.breached ? theme.accent.accent : theme.accent.dim

        if (line.advisory) {
          // Dashed: displayed but never enforced.
          for (let x = 0; x < layout.width - 52; x += DASH + GAP) {
            lines.rect(x, y, DASH, 1.5).fill({ color: colour, alpha: 0.9 })
          }
        } else {
          lines.rect(0, y, layout.width - 52, 1.5).fill({ color: colour, alpha: 0.95 })
        }

        let label = labels[index]
        if (!label) {
          label = new Text({
            text: '',
            style: {
              fontFamily: HUD_FONT,
              fontSize: hudFontSize(11),
              fill: theme.accent.dim,
            },
          })
          label.anchor.set(0, 1)
          labels.push(label)
          container.addChild(label)
        }
        // Labelled with the owning plugin, since more than one can be active and
        // the stop-out record needs to be attributable.
        label.text = `${line.stopId} ${line.level.toFixed(2)}${line.advisory ? ' (advisory)' : ''}`
        label.position.set(8, y - 2)
        label.visible = true
      })

      for (let i = frame.stopLines.length; i < labels.length; i++) {
        const label = labels[i]
        if (label) label.visible = false
      }
    },
  }
}
