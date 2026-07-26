import { Container, Graphics, Text } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState, VisibleBar } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { hudDimTextStyle } from '../hud/hudText.js'
import { EMPHASIS, boundaryBetween } from './landmarks.js'

/**
 * Landmarks in the scroll: month, quarter, and year boundaries.
 *
 * Why this matters more than decoration: an endless scroll of poles gives a player
 * no sense of *when* they are or how far they've come, and both are part of reading
 * a chart. See docs/game-feel.md#new-landmarks-in-the-scroll.
 *
 * **No new data is needed and none is leaked.** A boundary is detected by comparing
 * a bar's date with the previous *played* bar's — both already on screen — so this
 * cannot reveal anything about bars the player hasn't reached. A landmark computed
 * from the full series (e.g. "the year's high is coming") would leak; this does not.
 *
 * Drawn behind the poles, deliberately: a banner that crosses a pole would obscure
 * price data, which is the one thing that must stay readable.
 */

export interface LandmarkLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

export function createLandmarkLayer(theme: VisualTheme): LandmarkLayer {
  const container = new Container()
  const lines = new Graphics()
  const labelPool: Text[] = []
  container.addChild(lines)

  const labelFor = (index: number): Text => {
    const existing = labelPool[index]
    if (existing) return existing
    const text = new Text({ text: '', style: hudDimTextStyle(theme, 13) })
    text.anchor.set(0, 0)
    labelPool[index] = text
    container.addChild(text)
    return text
  }

  return {
    container,

    draw(frame, layout) {
      lines.clear()
      let used = 0

      // `bars` is oldest-first, so the previous played bar is the one before it in
      // the array. Skipping index 0 is correct rather than lazy: its predecessor has
      // already scrolled off screen, and inventing a boundary for it would make
      // banners flicker into existence at the left edge.
      for (let i = 1; i < frame.bars.length; i++) {
        const current = frame.bars[i] as VisibleBar
        const previous = frame.bars[i - 1] as VisibleBar
        const boundary = boundaryBetween(previous.bar.t, current.bar.t)
        if (!boundary) continue

        const centre = layout.characterX - (current.age + frame.barPhase) * layout.barWidth
        const x = centre - layout.barWidth / 2
        if (x < -40 || x > layout.characterX) continue

        const { alpha, label } = EMPHASIS[boundary]
        lines
          .rect(x, layout.chartTop, 1, layout.groundY - layout.chartTop)
          .fill({ color: theme.accent.axisLine, alpha })

        const text = labelFor(used++)
        text.text = label(new Date(current.bar.t * 1000))
        text.alpha = Math.min(1, alpha + 0.35)
        text.position.set(x + 4, layout.chartTop + 2)
        text.visible = true
      }

      for (let i = used; i < labelPool.length; i++) {
        const text = labelPool[i]
        if (text) text.visible = false
      }
    },
  }
}
