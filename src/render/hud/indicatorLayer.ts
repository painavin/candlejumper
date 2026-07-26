import { Container, Graphics, Text } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { hudDimTextStyle, hudTextStyle } from './hudText.js'
import { AXIS_WIDTH } from './axisLayer.js'
import { drawPanel } from './hudPanel.js'

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

/**
 * Scale labels per pane: top, middle, bottom.
 *
 * Three rather than the price axis's five because a pane is a fraction of the
 * height — five would collide. Three is the minimum that conveys a *scale* rather
 * than just a ceiling: you need two endpoints to know the range and a midpoint to
 * know it's linear.
 */
const PANE_AXIS_LABELS = 3

/** Keeps the top and bottom labels clear of the plate's own border. */
const LABEL_INSET = 9

export function createIndicatorLayer(theme: VisualTheme): IndicatorLayer {
  const container = new Container()
  const overlays = new Graphics()
  const panes = new Graphics()
  container.addChild(overlays, panes)

  const titles: Text[] = []
  /** Flat pool, indexed `paneIndex * PANE_AXIS_LABELS + row`. */
  const scaleLabels: Text[] = []

  const scaleLabelFor = (index: number): Text => {
    const existing = scaleLabels[index]
    if (existing) return existing
    const label = new Text({ text: '', style: hudTextStyle({ theme, size: 12 }) })
    label.anchor.set(0, 0.5)
    scaleLabels[index] = label
    container.addChild(label)
    return label
  }

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

      const axisX = layout.width - AXIS_WIDTH

      frame.subPanes.forEach((pane, paneIndex) => {
        const top = layout.subPaneTops[paneIndex]
        const height = layout.subPaneHeight
        if (top === undefined || height <= 0) return

        // Each pane is a plate, so it reads as its own instrument.
        drawPanel(panes, { x: 0, y: top, width: axisX, height }, theme)
        // And its own scale band, aligned with the price axis above it. A pane
        // without one shows a *shape* rather than a measurement — you can see that
        // today's volume is tall without being able to say what it was.
        drawPanel(panes, { x: axisX, y: top, width: AXIS_WIDTH - 4, height }, theme)

        // Labels and their gridlines, top value first.
        for (let row = 0; row < PANE_AXIS_LABELS; row++) {
          const t = row / (PANE_AXIS_LABELS - 1)
          const label = scaleLabelFor(paneIndex * PANE_AXIS_LABELS + row)
          label.visible = true
          label.text = formatBound(pane.max - (pane.max - pane.min) * t)
          const y = top + LABEL_INSET + t * (height - LABEL_INSET * 2)
          label.position.set(axisX + 6, y)
          // Fainter than the price axis's gridlines: a pane is secondary, and a
          // strong grid here would compete with the chart it sits under.
          panes.rect(0, y, axisX, 1).fill({ color: theme.accent.axisLine, alpha: 0.18 })
        }

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
          title = new Text({ text: '', style: hudDimTextStyle(theme, 12) })
          titles.push(title)
          container.addChild(title)
        }
        // Name only. The bounds used to be crammed in here, which is what an axis is
        // for — and reading "90.2M / 0.00" told you the range without telling you
        // where in it any given bar sat.
        title.text = pane.title
        title.position.set(8, top + 3)
        title.visible = true
      })

      for (let i = frame.subPanes.length; i < titles.length; i++) {
        const title = titles[i]
        if (title) title.visible = false
      }
      for (let i = frame.subPanes.length * PANE_AXIS_LABELS; i < scaleLabels.length; i++) {
        const label = scaleLabels[i]
        if (label) label.visible = false
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
