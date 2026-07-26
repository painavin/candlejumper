import { Container, Graphics, Text } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import { damp } from '@shared/math/index.js'
import type { FrameState, HudState, PnlSign } from './hudTypes.js'
import type { Layout } from '../stage/layout.js'
import { HUD_FONT, hudFontSize } from './hudFont.js'

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

const PNL_COLOURS = {
  'blue-orange': { up: 0x4da3ff, down: 0xff9d4d },
  'red-green': { up: 0x4ddb7a, down: 0xff6b6b },
} as const

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

export function createTopHudLayer({
  ticker,
  startingCapital,
  palette,
  theme,
}: TopHudOptions): TopHudLayer {
  const container = new Container()
  const meter = new Graphics()

  const base = {
    fontFamily: HUD_FONT,
    fontSize: hudFontSize(14),
    fill: theme.accent.text,
  } as const
  const dim = { ...base, fontSize: hudFontSize(12), fill: theme.accent.dim } as const

  const pnl = new Text({ text: '', style: { ...base, fontSize: hudFontSize(16) } })
  const position = new Text({ text: '', style: base })
  const capital = new Text({ text: '', style: dim })
  const session = new Text({ text: '', style: dim })
  const multiplier = new Text({ text: '', style: { ...base, fontSize: hudFontSize(13) } })

  container.addChild(pnl, position, capital, session, multiplier, meter)

  const colours = PNL_COLOURS[palette]

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

      // Line 1: the primary readout. Raw realized P&L is always the headline —
      // arcadeScore sits beside it, never instead of it.
      pnl.text = `${formatSigned(shownTotal)}  (${formatPercent(shownPercent)})`
      // Colour keys off the *true* value, not the tweened one: a number sliding
      // through zero should not flicker to the opposite colour on the way.
      pnl.style.fill =
        signOf(hud.totalPnl) === 'flat'
          ? theme.accent.text
          : signOf(hud.totalPnl) === 'up'
            ? colours.up
            : colours.down
      pnl.position.set(14, 8)

      // Direction is shown explicitly as LONG/SHORT, not just by sign, and unit
      // count is exactly how many exit presses remain to reach flat.
      position.text =
        hud.direction === 'flat'
          ? 'FLAT'
          : `${hud.direction.toUpperCase()} ${Math.abs(hud.shares).toFixed(2)}sh @ ${hud.avgCost.toFixed(2)}` +
            `  ${hud.unitCount}u  ${formatSigned(shownUnrealized)}`
      position.style.fontSize = hudFontSize(portrait ? 12 : 14)
      position.position.set(14, portrait ? 28 : 30)

      // Buying power is shown because entries clamp against it, and a silent
      // clamp is confusing without a visible cause. In portrait there is no room,
      // so it moves to the pause screen.
      capital.text = `BP $${shownBuyingPower.toFixed(0)} / $${startingCapital.toFixed(0)}`
      capital.visible = !portrait
      capital.position.set(layout.width - 240, 10)

      const date = frame.currentBar ? isoDate(frame.currentBar.t) : '—'
      const progress =
        frame.totalBars > 0 ? Math.round(((frame.currentIndex + 1) / frame.totalBars) * 100) : 0
      const notes = [ticker, date, `${progress}%`]
      if (frame.phase === 'paused') notes.push('PAUSED')
      if (frame.phase === 'finished') notes.push('END OF DATA')
      if (frame.droppedBars > 0) notes.push(`${frame.droppedBars} skipped`)
      session.text = notes.join('  ')
      session.position.set(layout.width - 240, portrait ? 10 : 30)

      drawStreak(hud, portrait)
    },
  }

  function drawStreak(hud: HudState, portrait: boolean): void {
    const { meter: state, multiplier: value, maxMultiplier, arcadeScore } = hud.streak

    if (state === 'dormant') {
      // No rule committed, so nothing to measure. Greyed with the multiplier
      // pinned, so the absence reads as a consequence of the player's own config
      // rather than a bug.
      multiplier.text = '×1  no stop rule'
      multiplier.style.fill = theme.accent.dim
      meter.clear()
      multiplier.position.set(portrait ? 14 : 300, portrait ? 44 : 8)
      return
    }

    const automated = state === 'automated'
    multiplier.text = automated
      ? `×${value} automated`
      : `×${value}  ${formatSigned(arcadeScore, 0)}`
    multiplier.style.fill = automated ? theme.accent.dim : theme.accent.text
    multiplier.position.set(portrait ? 14 : 300, portrait ? 44 : 8)

    // Five pips, filling one per compliant close event and emptying on a reset.
    // Deliberately not a continuous bar: there is no time decay to animate.
    const pipWidth = 10
    const pipGap = 3
    const x = multiplier.x + multiplier.width + 10
    const y = multiplier.y + 5
    meter.clear()
    for (let i = 0; i < maxMultiplier; i++) {
      const filled = i < hud.streak.streak
      meter
        .rect(x + i * (pipWidth + pipGap), y, pipWidth, 8)
        .fill({
          color: filled ? colours.up : theme.accent.axisLine,
          alpha: automated ? 0.4 : 1,
        })
    }
  }
}

function isoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}
