import { Container, Graphics, Text } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import { pnlColours } from '@content/pnlColours.js'
import { damp } from '@shared/math/index.js'
import type { FrameState, HudState, PnlSign } from './hudTypes.js'
import type { Layout } from '../stage/layout.js'
import { hudFontSize } from './hudFont.js'
import { hudDimTextStyle, hudTextStyle } from './hudText.js'
import {
  PANEL_GAP,
  PANEL_MARGIN,
  PANEL_PADDING,
  PANEL_ROW_GAP,
  bottomOf,
  drawPanel,
  rightOf,
} from './hudPanel.js'
import type { PanelBox } from './hudPanel.js'

/**
 * The top HUD.
 *
 * Rendered in PixiJS, not Svelte. tech-stack.md picks Svelte on the premise that
 * the settings UI and the render loop are never active simultaneously — and the
 * HUD updates every tick, so putting it in the DOM would break that premise and
 * re-open the performance argument that doc explicitly retracts. The rule that
 * makes this tolerable: **no per-frame DOM updates during a run**.
 *
 * Every P&L indication carries **sign and shape, never colour alone** — an
 * explicit `+`/`−` and an arrow glyph — because P&L direction is *the*
 * information this game conveys and ~8% of men can't distinguish red from green.
 * See docs/accessibility.md.
 */

export interface TopHudLayer {
  container: Container
  draw(frame: FrameState, layout: Layout, dt: number): void
}

export interface TopHudOptions {
  ticker: string
  startingCapital: number
  /** `red-green` ships as the default; `blue-orange` is the colourblind-safe option. */
  palette: 'blue-orange' | 'red-green'
  theme: VisualTheme
}

/**
 * Seconds to close roughly 63% of the gap. Fast enough to feel responsive, slow
 * enough that the movement is visible at all.
 */
const NUMBER_SMOOTHING = 0.14

function signOf(value: number): PnlSign {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

/** Sign and an arrow, so the value reads correctly with no colour at all. */
function formatSigned(value: number, digits = 2): string {
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '·'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${arrow} ${sign}$${Math.abs(value).toFixed(digits)}`
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

/**
 * Type sizes, per orientation.
 *
 * Collected here rather than inline because they now have to agree with
 * `TOP_HUD_HEIGHT` in `layout.ts` — the plates size themselves to their text, so
 * growing a number here grows the band, and the reserved height has to cover it.
 */
const SIZES = {
  landscape: { pnl: 19, position: 16, dim: 13, multiplier: 15 },
  portrait: { pnl: 17, position: 14, dim: 12, multiplier: 13 },
} as const

/** Streak pips. Wider in landscape, where there's room for them to be countable. */
const PIP = {
  landscape: { width: 11, height: 9 },
  portrait: { width: 9, height: 8 },
} as const

/** Gap between the multiplier text and the first pip. */
const PIP_OFFSET = 8

/** Gap between pips, so they stay countable rather than reading as one bar. */
const PIP_GAP = 3

export function createTopHudLayer({
  ticker,
  startingCapital,
  palette,
  theme,
}: TopHudOptions): TopHudLayer {
  const container = new Container()
  const meter = new Graphics()

  const base = hudTextStyle({ theme, size: SIZES.landscape.position })
  const dim = hudDimTextStyle(theme, SIZES.landscape.dim)

  const panels = new Graphics()
  const pnl = new Text({ text: '', style: hudTextStyle({ theme, size: SIZES.landscape.pnl }) })
  const position = new Text({ text: '', style: base })
  const capital = new Text({ text: '', style: dim })
  const session = new Text({ text: '', style: dim })
  const multiplier = new Text({
    text: '',
    style: hudTextStyle({ theme, size: SIZES.landscape.multiplier }),
  })

  // Panels first, so every readout sits on top of its own plate.
  container.addChild(panels, pnl, position, capital, session, multiplier, meter)

  const colours = pnlColours(palette)

  /**
   * A number that catches up to its target instead of jumping.
   *
   * docs/game-feel.md asks for this and calls it close to free — it is, but the
   * reason it matters is specific: a realized gain lands as a single discrete jump,
   * and a readout that slides makes the *size* of the change legible rather than
   * just its result. The value shown is briefly not the true value, which is fine
   * for a display and would not be for anything the engine reads.
   *
   * Frame-rate corrected via `damp`, so the ease looks identical at 60 and 144Hz.
   */
  const tween = (initial: number) => {
    let current = initial
    let primed = false
    return {
      to(target: number, dt: number): number {
        // First frame snaps: easing up from zero at run start would show a
        // fictional P&L history the player didn't earn.
        if (!primed || dt <= 0) {
          primed = true
          current = target
          return current
        }
        current = damp(current, target, NUMBER_SMOOTHING, dt)
        // Land exactly rather than approaching forever, so the readout can settle on
        // a round number instead of hovering a cent away from it.
        if (Math.abs(target - current) < 0.005) current = target
        return current
      },
    }
  }

  const total = tween(0)
  const percent = tween(0)
  const unrealized = tween(0)
  const buying = tween(startingCapital)

  return {
    container,

    draw(frame, layout, dt) {
      const hud: HudState = frame.hud
      // Tweened, not raw: see `tween()` below.
      const shownTotal = total.to(hud.totalPnl, dt)
      const shownPercent = percent.to(hud.percentReturn, dt)
      const shownUnrealized = unrealized.to(hud.unrealizedPnl, dt)
      const shownBuyingPower = buying.to(hud.buyingPower, dt)
      const portrait = layout.isPortrait
      const sizes = portrait ? SIZES.portrait : SIZES.landscape
      const pad = portrait ? PANEL_PADDING.portrait : PANEL_PADDING.landscape

      // ── Content first, geometry second ────────────────────────────────────
      // Plates are sized from the text they contain, so every string and every font
      // size has to be settled before a single box is measured. Laying out as we go
      // would mean a plate fitted to the *previous* frame's numbers, which shows up
      // as a border that jitters by a character width as a value crosses a digit.

      // The primary readout. Raw realized P&L is always the headline — arcadeScore
      // sits beside it, never instead of it.
      pnl.text = `${formatSigned(shownTotal)}  (${formatPercent(shownPercent)})`
      pnl.style.fontSize = hudFontSize(sizes.pnl)
      // Colour keys off the *true* value, not the tweened one: a number sliding
      // through zero should not flicker to the opposite colour on the way.
      pnl.style.fill =
        signOf(hud.totalPnl) === 'flat'
          ? theme.accent.text
          : signOf(hud.totalPnl) === 'up'
            ? colours.up
            : colours.down

      // Direction is shown explicitly as LONG/SHORT, not just by sign, and unit
      // count is exactly how many exit presses remain to reach flat.
      position.text =
        hud.direction === 'flat'
          ? 'FLAT'
          : `${hud.direction.toUpperCase()} ${Math.abs(hud.shares).toFixed(2)}sh @ ${hud.avgCost.toFixed(2)}` +
            `  ${hud.unitCount}u  ${formatSigned(shownUnrealized)}`
      position.style.fontSize = hudFontSize(sizes.position)

      // Buying power is shown because entries clamp against it, and a silent
      // clamp is confusing without a visible cause. In portrait there is no room,
      // so it moves to the pause screen.
      capital.text = `BP $${shownBuyingPower.toFixed(0)} / $${startingCapital.toFixed(0)}`
      capital.visible = !portrait
      capital.style.fontSize = hudFontSize(sizes.dim)

      const date = frame.currentBar ? isoDate(frame.currentBar.t) : '—'
      // Over the playable range, not the whole file: preloaded bars were consumed before
      // the player arrived, and counting them would open the run at 17%.
      const playable = frame.totalBars - frame.firstIndex
      const progress =
        playable > 0
          ? Math.round(((frame.currentIndex - frame.firstIndex + 1) / playable) * 100)
          : 0
      const notes = [ticker, date, `${progress}%`]
      // Read off the frame, so it is the speed the clock is actually running at rather
      // than the one the run was configured with — the player can change it mid-run.
      // Trimmed rather than padded: 2 reads better than 2.0, and 0.5 needs the decimal.
      //
      // Abbreviated in portrait, where this plate is right-aligned and grows leftward
      // toward the primary one — the same reason `capital` is hidden there. `b/s` still
      // reads as a rate next to a date and a percentage; a bare `2` would not.
      const speed = Number(hud.scrollSpeed.toFixed(1))
      notes.push(portrait ? `${speed} b/s` : `${speed} bars/sec`)
      if (frame.phase === 'paused') notes.push('PAUSED')
      if (frame.phase === 'finished') notes.push('END OF DATA')
      if (frame.droppedBars > 0) notes.push(`${frame.droppedBars} skipped`)
      session.text = notes.join('  ')
      session.style.fontSize = hudFontSize(sizes.dim)

      const streak = streakContent(hud, sizes.multiplier)

      // ── Geometry ──────────────────────────────────────────────────────────
      panels.clear()

      // Left: the instrument. P&L over position, because they're one reading — "what
      // am I holding and what is it doing" — and splitting them into two plates would
      // imply they're answers to different questions.
      const primary: PanelBox = {
        x: PANEL_MARGIN,
        y: PANEL_MARGIN - 4,
        width: pad * 2 + Math.max(pnl.width, position.width),
        height: pad * 2 + pnl.height + PANEL_ROW_GAP + position.height,
      }
      drawPanel(panels, primary, theme)
      pnl.position.set(primary.x + pad, primary.y + pad)
      position.position.set(primary.x + pad, primary.y + pad + pnl.height + PANEL_ROW_GAP)

      // Right: session context. Read occasionally rather than continuously, so it
      // gets its own plate at the opposite edge and stays out of the way.
      const contextRows = portrait ? [session] : [capital, session]
      const context: PanelBox = {
        x: 0,
        y: primary.y,
        width: pad * 2 + Math.max(...contextRows.map((row) => row.width)),
        height:
          pad * 2 +
          contextRows.reduce((sum, row) => sum + row.height, 0) +
          PANEL_ROW_GAP * (contextRows.length - 1),
      }
      context.x = layout.width - PANEL_MARGIN - context.width
      drawPanel(panels, context, theme)
      let rowY = context.y + pad
      for (const row of contextRows) {
        row.position.set(context.x + pad, rowY)
        rowY += row.height + PANEL_ROW_GAP
      }

      // Middle: the streak. Beside the instrument when it fits, tucked under it when
      // it doesn't — measured rather than assumed per orientation, because it's the
      // window width that decides, not whether the phone is turned sideways.
      const pip = portrait ? PIP.portrait : PIP.landscape
      const pipsWidth =
        streak.pips === 0 ? 0 : PIP_OFFSET + streak.pips * (pip.width + PIP_GAP) - PIP_GAP
      const streakBox: PanelBox = {
        x: rightOf(primary) + PANEL_GAP,
        y: primary.y,
        width: pad * 2 + multiplier.width + pipsWidth,
        height: pad * 2 + Math.max(multiplier.height, pip.height),
      }
      if (streakBox.x + streakBox.width > context.x - PANEL_GAP) {
        streakBox.x = PANEL_MARGIN
        streakBox.y = bottomOf(primary) + PANEL_GAP / 2
      }
      drawPanel(panels, streakBox, theme)
      multiplier.position.set(
        streakBox.x + pad,
        streakBox.y + (streakBox.height - multiplier.height) / 2
      )

      meter.clear()
      const pipY = streakBox.y + (streakBox.height - pip.height) / 2
      const pipX = multiplier.x + multiplier.width + PIP_OFFSET
      for (let i = 0; i < streak.pips; i++) {
        meter.rect(pipX + i * (pip.width + PIP_GAP), pipY, pip.width, pip.height).fill({
          color: i < streak.filled ? colours.up : theme.accent.axisLine,
          alpha: streak.automated ? 0.4 : 1,
        })
      }
    },
  }

  /**
   * Sets the multiplier text and reports what the meter should draw.
   *
   * Split from the drawing so the plate can be measured before anything is
   * positioned — the streak plate's width depends on both the text and the pip
   * count, and neither is known until the streak state has been read.
   */
  function streakContent(
    hud: HudState,
    size: number
  ): { pips: number; filled: number; automated: boolean } {
    const { meter: state, multiplier: value, maxMultiplier, arcadeScore } = hud.streak
    multiplier.style.fontSize = hudFontSize(size)

    if (state === 'dormant') {
      // No rule committed, so nothing to measure. Greyed with the multiplier
      // pinned, so the absence reads as a consequence of the player's own config
      // rather than a bug.
      multiplier.text = '×1  no stop rule'
      multiplier.style.fill = theme.accent.dim
      return { pips: 0, filled: 0, automated: false }
    }

    const automated = state === 'automated'
    multiplier.text = automated
      ? `×${value} automated`
      : `×${value}  ${formatSigned(arcadeScore, 0)}`
    multiplier.style.fill = automated ? theme.accent.dim : theme.accent.text
    // Five pips, filling one per compliant close event and emptying on a reset.
    // Deliberately not a continuous bar: there is no time decay to animate.
    return { pips: maxMultiplier, filled: hud.streak.streak, automated }
  }
}

function isoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}
