import { Container, Graphics } from 'pixi.js'
import type { BarStyle } from '@config/index.js'
import { pnlColours } from '@content/pnlColours.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { candleCentreX, candleShapeAt, wickWidthFor } from './candle.js'
import type { Rect } from './candle.js'
import { bodyColour, contextPalette, rangeColour } from './candleColour.js'
import type { CandlePalette } from './candleColour.js'

/**
 * The bars, and the ground behind them.
 *
 * A bar is spawned only once it reaches the character, so this layer draws
 * exactly what `FrameState.bars` contains and never looks ahead — the
 * no-lookahead constraint is structural, enforced by the engine rather than by
 * anything here.
 *
 * Bars **float**: a candle body between the open and the close, with the high–low
 * range behind it. They no longer rest on the ground, so the ground is scenery now
 * — the horizon the parallax terrain sits against — rather than a baseline
 * anything is measured from. The character still lands on each bar's *close*,
 * which is the price it trades at, so what it rides is the closing line through
 * the bars rather than a solid surface.
 *
 * All the geometry lives in `candle.ts`, which is Pixi-free and tested. This file
 * is colour and draw calls.
 *
 * Redrawn each frame into one `Graphics`. At ~60 bars that's cheap, and it avoids
 * the bookkeeping of pooling sprites whose positions all change anyway.
 */

export interface PoleLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

export interface PoleLayerOptions {
  theme: VisualTheme
  /**
   * The P&L palette, shared with the HUD and the juice layer.
   *
   * Direction colour comes from the accessibility setting rather than from the
   * mood, because a red/green chart is *the* canonical colourblind hazard and a
   * player who selected blue/orange selected it for the bars most of all. The mood
   * contributes the colour those are muted *toward* — see `candleColour.ts`.
   */
  palette: string
  /**
   * Candlestick, Bollinger bars, or whatever the theme asks for. Resolved through
   * `wickWidthFor`, so precedence between the setting and the theme lives in one
   * place rather than here.
   */
  barStyle: BarStyle
}

/** Alpha on the bar still forming, so "this one isn't final" reads at a glance. */
const FORMING_ALPHA = 0.62

/**
 * Alpha on a bar the player never traded — one consumed to warm indicators.
 *
 * Lower than `FORMING_ALPHA`, and the alpha is only half of the signal: those bars also
 * lose their direction colour entirely (see `contextPalette`). Two cues rather than one,
 * because transparency alone already means "still forming" at the other end of the chart,
 * and one fade meaning two things is worse than either.
 */
const PRELOADED_ALPHA = 0.42

/** Outline weight for themes that ask for one. */
const OUTLINE_WIDTH = 1

/**
 * Corner radius as a fraction of width, for round-cap themes.
 *
 * Below a half, deliberately: at a half a tall body becomes a capsule, which reads
 * as a lozenge floating on the chart rather than as a bar with soft corners.
 */
const CORNER_FRACTION = 0.3

export function createPoleLayer({ theme, palette, barStyle }: PoleLayerOptions): PoleLayer {
  const container = new Container()
  const ground = new Graphics()
  const poles = new Graphics()
  container.addChild(ground, poles)

  const colours = pnlColours(palette)
  const candlePalette: CandlePalette = { pnl: colours, neutral: theme.palette.candleRange }
  /** For preloaded bars: the same neutral, with no profit or loss to report. */
  const contextBars: CandlePalette = contextPalette(candlePalette)
  const { capStyle, outline } = theme.poles
  const wickWidthFraction = wickWidthFor(barStyle)

  let lastLayoutKey = ''

  /** Rounded corners on a body, but never so round the body becomes a lozenge. */
  const paint = (graphics: Graphics, rect: Rect, colour: number, alpha: number): void => {
    if (capStyle === 'round') {
      const radius = Math.min(rect.width * CORNER_FRACTION, rect.height / 2)
      graphics.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
    } else {
      graphics.rect(rect.x, rect.y, rect.width, rect.height)
    }
    graphics.fill({ color: colour, alpha })
    if (outline) {
      // The theme's own colour rather than a shade of the fill, deliberately: one
      // constant edge colour across every bar is what makes an outlined theme read as
      // a terminal. Deriving it per bar would give each candle its own frame, which
      // is a second direction cue nobody asked for.
      graphics.stroke({ color: theme.palette.candleRange, alpha: alpha * 0.8, width: OUTLINE_WIDTH })
    }
  }

  return {
    container,

    draw(frame, layout) {
      const layoutKey = `${layout.width}x${layout.height}x${layout.subPaneTops.length}`
      if (layoutKey !== lastLayoutKey) {
        lastLayoutKey = layoutKey
        ground.clear()
        /**
         * The ground stops where the sub-panes start, rather than running to the
         * bottom of the viewport.
         *
         * It used to run the whole way, *behind* the panes — and because a pane plate
         * is translucent, the grass showed through and tinted the volume histogram
         * green. It read as a deliberate colour choice, which is the worst kind of
         * bug: below the ground line is instrument territory, not world, and a data
         * pane should never sit on scenery.
         */
        const groundBottom = layout.subPaneTops[0] ?? layout.height
        ground
          .rect(0, layout.groundY, layout.width, Math.max(0, groundBottom - layout.groundY))
          .fill(theme.palette.ground)
        ground.rect(0, layout.groundY, layout.width, 2).fill(theme.palette.groundLine)
      }

      poles.clear()
      for (const visible of frame.bars) {
        const centreX = candleCentreX(visible.age, frame.barPhase, layout)
        const shape = candleShapeAt(visible, layout, wickWidthFraction, centreX)
        if (shape.body.x + shape.body.width < 0) continue

        // Preload before forming: a preloaded bar is never the forming one, but stating
        // the order makes it obvious that the two states can't fight over an alpha.
        const alpha = visible.preloaded
          ? PRELOADED_ALPHA
          : shape.forming
            ? FORMING_ALPHA
            : 1
        const bars = visible.preloaded ? contextBars : candlePalette
        // Range first, so the body sits on top of it. The range takes a desaturated
        // version of the body's own colour, so the whole column's hue reports the
        // direction while the saturated body still marks where open and close sit.
        paint(poles, shape.range, rangeColour(shape.direction, bars), alpha)
        paint(poles, shape.body, bodyColour(shape.direction, bars), alpha)
      }
    },
  }
}
