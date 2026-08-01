import { Container, Graphics, Text } from 'pixi.js'
import { pnlColours } from '@content/pnlColours.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState, OverlayLine } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { hudDimTextStyle, hudTextStyle } from './hudText.js'
import { AXIS_WIDTH } from './axisLayer.js'
import { PANEL_GAP, PANEL_MARGIN, PANEL_PADDING, drawPanel } from './hudPanel.js'
import { histogramColour } from '../poles/candleColour.js'
import type { CandlePalette } from '../poles/candleColour.js'
import type { Point } from './dash.js'
import { dashSegments } from './dash.js'

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

/**
 * Legend swatch geometry.
 *
 * A legend only matters once more than one overlay is active — but that's the case
 * the game is built for now: three SMAs at different lengths get three colours from
 * `SERIES_COLOURS` and are otherwise indistinguishable. Three unlabelled lines are
 * worse than one labelled line, so this isn't decoration.
 */
const SWATCH = { width: 16, height: 3, gap: 6, rowHeight: 17 }

/**
 * Marker radius for a `dots` output, as a fraction of the bar width.
 *
 * Tied to bar width rather than fixed, so a mark stays proportionate to the bar it
 * belongs to at any zoom — and floored, because below about a pixel and a half a dot
 * stops registering as a mark at all and just dirties the line of the chart.
 */
const DOT = { fraction: 0.3, min: 1.6, max: 4.5 }

/**
 * Dash and gap length for a `dash` output, in pixels.
 *
 * The same pair the stop-line layer uses, deliberately: a dashed line already means
 * "shown but not enforced" on this chart, and a second dash rhythm would read as a
 * different kind of thing rather than the same idea applied to an indicator.
 */
const DASH = { on: 9, off: 6 }

/**
 * Alpha on a volume bar for a preloaded bar, matching the pole above it.
 *
 * Slightly higher than the poles' own, because these sit on a pane plate rather than on
 * sky and lose more contrast to the same transparency.
 */
const CONTEXT_ALPHA = 0.5

/** Stroke a polyline as dashes. The walk itself lives in `dash.ts`, where it's tested. */
function strokeDashed(graphics: Graphics, points: readonly Point[], colour: number): void {
  for (const segment of dashSegments(points, DASH)) {
    graphics.moveTo(segment.from.x, segment.from.y)
    graphics.lineTo(segment.to.x, segment.to.y)
  }
  graphics.stroke({ width: 1.6, color: colour, alpha: 0.95 })
}

export interface IndicatorLayerOptions {
  theme: VisualTheme
  /**
   * The P&L palette, so a volume bar can be coloured exactly like the candle above it.
   * Same setting the bars, the HUD, and the exit particles read.
   */
  palette: string
}

export function createIndicatorLayer({ theme, palette }: IndicatorLayerOptions): IndicatorLayer {
  const container = new Container()
  const candlePalette: CandlePalette = {
    pnl: pnlColours(palette),
    neutral: theme.palette.candleRange,
  }
  const overlays = new Graphics()
  const panes = new Graphics()
  container.addChild(overlays, panes)

  const titles: Text[] = []
  /** Flat pool, indexed `paneIndex * PANE_AXIS_LABELS + row`. */
  const scaleLabels: Text[] = []
  const legendPlate = new Graphics()
  const legendLabels: Text[] = []
  container.addChild(legendPlate)

  const legendLabelFor = (index: number): Text => {
    const existing = legendLabels[index]
    if (existing) return existing
    const label = new Text({ text: '', style: hudTextStyle({ theme, size: 12 }) })
    label.anchor.set(0, 0.5)
    legendLabels[index] = label
    container.addChild(label)
    return label
  }

  const scaleLabelFor = (index: number): Text => {
    const existing = scaleLabels[index]
    if (existing) return existing
    const label = new Text({ text: '', style: hudTextStyle({ theme, size: 12 }) })
    label.anchor.set(0, 0.5)
    scaleLabels[index] = label
    container.addChild(label)
    return label
  }

  /**
   * One labelled swatch per overlay, in the line's own colour.
   *
   * Positioned under the top HUD band rather than over it, and only drawn when there
   * is something to disambiguate — a single overlay names itself well enough in
   * Settings, and a one-row legend is pure clutter.
   */
  const drawLegend = (lines: readonly OverlayLine[], layout: Layout): void => {
    const show = lines.length > 1
    legendPlate.visible = show
    if (!show) {
      for (const label of legendLabels) label.visible = false
      return
    }

    let widest = 0
    lines.forEach((line, index) => {
      const label = legendLabelFor(index)
      label.text = line.label
      widest = Math.max(widest, label.width)
    })

    const pad = layout.isPortrait ? PANEL_PADDING.portrait : PANEL_PADDING.landscape
    const box = {
      x: PANEL_MARGIN,
      y: layout.chartTop + PANEL_GAP,
      width: pad * 2 + SWATCH.width + SWATCH.gap + widest,
      height: pad * 2 + lines.length * SWATCH.rowHeight - (SWATCH.rowHeight - 12),
    }
    legendPlate.clear()
    drawPanel(legendPlate, box, theme)

    lines.forEach((line, index) => {
      const colour = line.colour
      const rowY = box.y + pad + index * SWATCH.rowHeight
      const label = legendLabelFor(index)
      label.visible = true
      label.position.set(box.x + pad + SWATCH.width + SWATCH.gap, rowY + 6)
      // A swatch shaped like what's actually on the chart: a bar for a line, a mark
      // for dots, two short bars for a dash. Showing a solid bar for all three would
      // be a small lie in the one place the player looks to decode the chart.
      if (line.draw === 'dots') {
        legendPlate
          .circle(box.x + pad + SWATCH.width / 2, rowY + 6, DOT.max / 2 + 0.5)
          .fill({ color: colour, alpha: 0.95 })
      } else if (line.draw === 'dash') {
        const segment = (SWATCH.width - 3) / 2
        legendPlate
          .rect(box.x + pad, rowY + 6 - SWATCH.height / 2, segment, SWATCH.height)
          .rect(box.x + pad + segment + 3, rowY + 6 - SWATCH.height / 2, segment, SWATCH.height)
          .fill({ color: colour, alpha: 0.95 })
      } else {
        legendPlate
          .rect(box.x + pad, rowY + 6 - SWATCH.height / 2, SWATCH.width, SWATCH.height)
          .fill({ color: colour, alpha: 0.95 })
      }
    })

    for (let i = lines.length; i < legendLabels.length; i++) {
      const label = legendLabels[i]
      if (label) label.visible = false
    }
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

      const dotRadius = Math.min(DOT.max, Math.max(DOT.min, layout.barWidth * DOT.fraction))

      for (const line of frame.overlays) {
        // The colour this output resolved to — its own, or the instance's. Not derived
        // from its index here: removing one indicator would then recolour the rest.
        const colour = line.colour

        if (line.draw === 'dots') {
          // No path at all: a sparse output's points are individually meaningful, and
          // joining them would draw a trend across the bars in between.
          const lift = line.offsetPx ?? 0
          line.units.forEach((unit, offset) => {
            if (unit === null) return
            const y = layout.groundY - unit * layout.chartHeight - lift
            overlays.circle(xOf(offset), y, dotRadius)
          })
          overlays.fill({ color: colour, alpha: 0.95 })
          continue
        }

        if (line.draw === 'dash') {
          // Dashes break at a gap the same way a solid line does, so each run of
          // consecutive values is dashed on its own.
          let run: Point[] = []
          const flush = (): void => {
            if (run.length > 1) strokeDashed(overlays, run, colour)
            run = []
          }
          line.units.forEach((unit, offset) => {
            if (unit === null) {
              flush()
              return
            }
            run.push({ x: xOf(offset), y: layout.groundY - unit * layout.chartHeight })
          })
          flush()
          continue
        }

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
      }

      drawLegend(frame.overlays, layout)

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

        for (const series of pane.series) {
          const colour = series.colour
          /**
           * A point's own colour, when the series reports a direction for it.
           *
           * Derived from the *same* function that colours a candle's high–low range, so
           * a volume bar stays recognisably the colour of the candle above it. Darker,
           * because it sits on a pane plate rather than on sky — see
           * `histogramColour`.
           */
          const colourAt = (offset: number): number => {
            const direction = series.directions?.[offset]
            return direction === undefined ? colour : histogramColour(direction, candlePalette)
          }

          if (pane.histogram) {
            const contextBefore = series.contextBefore ?? 0
            series.units.forEach((unit, offset) => {
              if (unit === null) return
              const barHeight = Math.max(1, unit * height)
              // A bar the player never traded loses its direction colour and some alpha,
              // matching the pole above it. Two cues, for the reason `contextPalette`
              // gives — and matching, because a bright histogram under a greyed candle
              // reads as a rendering bug rather than as context.
              const context = offset < contextBefore
              panes
                .rect(xOf(offset) - layout.poleWidth / 2, top + height - barHeight, layout.poleWidth, barHeight)
                // Otherwise fully opaque: the colour is information, and any transparency
                // blends it back toward the plate, which is the contrast problem this is
                // solving.
                .fill({
                  color: context
                    ? histogramColour('flat', candlePalette)
                    : colourAt(offset),
                  alpha: context ? CONTEXT_ALPHA : 1,
                })
            })
            continue
          }

          if (series.draw === 'dots') {
            const lift = series.offsetPx ?? 0
            series.units.forEach((unit, offset) => {
              if (unit === null) return
              panes.circle(xOf(offset), top + height - unit * height - lift, dotRadius)
            })
            panes.fill({ color: colour, alpha: 0.95 })
            continue
          }

          const runs: Point[][] = []
          let run: Point[] = []
          series.units.forEach((unit, offset) => {
            if (unit === null) {
              if (run.length > 0) runs.push(run)
              run = []
              return
            }
            run.push({ x: xOf(offset), y: top + height - unit * height })
          })
          if (run.length > 0) runs.push(run)

          if (series.draw === 'dash') {
            for (const segment of runs) {
              if (segment.length > 1) strokeDashed(panes, segment, colour)
            }
            continue
          }

          for (const segment of runs) {
            segment.forEach((point, index) => {
              if (index === 0) panes.moveTo(point.x, point.y)
              else panes.lineTo(point.x, point.y)
            })
          }
          panes.stroke({ width: 1.4, color: colour, alpha: 0.95 })
        }

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
