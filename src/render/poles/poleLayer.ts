import { Container, Graphics } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { unitToY } from '../stage/layout.js'

/**
 * Poles, and the ground they stand on.
 *
 * A pole is spawned only once it reaches the character, so this layer draws
 * exactly what `FrameState.bars` contains and never looks ahead — the
 * no-lookahead constraint is structural, enforced by the engine rather than by
 * anything here.
 *
 * Redrawn each frame into one `Graphics`. At ~60 poles that's cheap, and it
 * avoids the bookkeeping of pooling sprites whose positions all change anyway.
 */

export interface PoleLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

export function createPoleLayer(theme: VisualTheme): PoleLayer {
  const container = new Container()
  const ground = new Graphics()
  const poles = new Graphics()
  container.addChild(ground, poles)

  let lastLayoutKey = ''

  return {
    container,

    draw(frame, layout) {
      const layoutKey = `${layout.width}x${layout.height}`
      if (layoutKey !== lastLayoutKey) {
        lastLayoutKey = layoutKey
        ground.clear()
        ground
          .rect(0, layout.groundY, layout.width, layout.height - layout.groundY)
          .fill(theme.palette.ground)
        ground.rect(0, layout.groundY, layout.width, 2).fill(theme.palette.groundLine)
      }

      poles.clear()
      for (const visible of frame.bars) {
        // The newest bar sits under the character and slides left as the bar
        // progresses; the next one spawns exactly where this one started.
        const centre = layout.characterX - (visible.age + frame.barPhase) * layout.barWidth
        const left = centre - layout.poleWidth / 2
        if (left + layout.poleWidth < 0) continue

        // Growth is 1 for every bar but the newest. A pole appearing at full
        // height directly under the character reads as a glitch, so the current
        // bar grows from the ground the way a real bar forms during a day.
        const height = visible.unit * layout.chartHeight * visible.growth
        const forming = visible.growth < 1

        const colour = forming ? theme.palette.polesForming : theme.palette.poles
        // Pole *height* is always price data and never touched by a theme; only
        // colour and cap style are skinnable.
        if (theme.poles.capStyle === 'round') {
          const radius = Math.min(layout.poleWidth / 2, height / 2)
          poles
            .roundRect(left, layout.groundY - height, layout.poleWidth, height, radius)
            .fill(colour)
        } else {
          poles.rect(left, layout.groundY - height, layout.poleWidth, height).fill(colour)
        }
      }
    },
  }
}

/** Screen y of the top of a bar at a given unit height. */
export function poleTopY(unit: number, layout: Layout): number {
  return unitToY(unit, layout)
}
