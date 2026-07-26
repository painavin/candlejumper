import { Container, Graphics, Text } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { HUD_FONT, hudFontSize } from './hudFont.js'

/**
 * Overlay indicator lines, and the oscillator/volume sub-panes.
 *
 * **One renderer serves both** the volume toggle and any oscillator indicator,
 * because they're structurally identical: a series with its own scale in its own
 * pane. Building volume as a bespoke system would have meant two renderers for one
 * idea.
 *
 * Panes share the main chart's X axis and scroll in lockstep with it — a pane that
 * scrolled independently of the poles above it would be worse than no pane.
 *
 * `null` values are gaps, not zeros: an indicator that isn't warmed up yet draws
 * nothing rather than a line running out of the floor.
 */

export interface IndicatorLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

/** Distinct enough to tell two overlays apart without a legend. */
const SERIES_COLOURS = [0xffd166, 0x4da3ff, 0xff9d4d, 0x9dd6a0, 0xd2a8ff] as const

export function createIndicatorLayer(theme: VisualTheme): IndicatorLayer {
  const container = new Container()
  const overlays = new Graphics()
  const panes = new Graphics()
  container.addChild(overlays, panes)

  const titles: Text[] = []

  return {
    container,

    draw(frame, layout) {
      overlays.clear()
      panes.clear()

      // X of the bar at `index` in the visible window — the same expression the pole
      // layer uses, so lines and poles cannot drift apart.
      const xOf = (offset: number): number => {
        const age = frame.bars.length - 1 - offset
        return layout.characterX - (age + frame.barPhase) * layout.barWidth
      }

      frame.overlays.forEach((line, seriesIndex) => {
        const colour = SERIES_COLOURS[seriesIndex % SERIES_COLOURS.length] as number
        let drawing = false
        line.units.forEach((unit, offset) => {
          if (unit === null) {
            drawing = false
            return
          }
          const x = xOf(offset)
          const y = layout.groundY - unit * layout.chartHeight
          if (drawing) overlays.lineTo(x, y)
          else overlays.moveTo(x, y)
          drawing = true
        })
        overlays.stroke({ width: 1.6, color: colour, alpha: 0.95 })
      })

      frame.subPanes.forEach((pane, paneIndex) => {
        const top = layout.subPaneTops[paneIndex]
        const height = layout.subPaneHeight
        if (top === undefined || height <= 0) return

        // A faint frame, so a pane reads as its own scale rather than as part of the
        // chart above it.
        panes.rect(0, top, layout.width - 52, height).fill({ color: theme.accent.axisLine, alpha: 0.08 })

        pane.series.forEach((series, seriesIndex) => {
          const colour = SERIES_COLOURS[(paneIndex + seriesIndex) % SERIES_COLOURS.length] as number

          if (pane.histogram) {
            series.units.forEach((unit, offset) => {
              if (unit === null) return
              const barHeight = Math.max(1, unit * height)
              panes
                .rect(xOf(offset) - layout.poleWidth / 2, top + height - barHeight, layout.poleWidth, barHeight)
                .fill({ color: colour, alpha: 0.55 })
            })
            return
          }

          let drawing = false
          series.units.forEach((unit, offset) => {
            if (unit === null) {
              drawing = false
              return
            }
            const x = xOf(offset)
            const y = top + height - unit * height
            if (drawing) panes.lineTo(x, y)
            else panes.moveTo(x, y)
            drawing = true
          })
          panes.stroke({ width: 1.4, color: colour, alpha: 0.95 })
        })

        let title = titles[paneIndex]
        if (!title) {
          title = new Text({
            text: '',
            style: { fontFamily: HUD_FONT, fontSize: hudFontSize(10), fill: theme.accent.dim },
          })
          titles.push(title)
          container.addChild(title)
        }
        title.text = `${pane.title}  ${formatBound(pane.max)} / ${formatBound(pane.min)}`
        title.position.set(6, top + 2)
        title.visible = true
      })

      for (let i = frame.subPanes.length; i < titles.length; i++) {
        const title = titles[i]
        if (title) title.visible = false
      }
    },
  }
}

/** Volume runs to the millions; an oscillator to single digits. */
function formatBound(value: number): string {
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return magnitude >= 10 ? value.toFixed(0) : value.toFixed(2)
}
