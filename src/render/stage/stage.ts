import { Application, Container } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { Layout } from './layout.js'
import { computeLayout } from './layout.js'

/**
 * PixiJS setup and the layer order. This is the only place the `Application`
 * exists; everything else takes a `Container` and a `Layout`.
 *
 * Layer order matters beyond aesthetics: the HUD sits above everything so the Y axis
 * and the readouts stay legible over the world (docs/hud.md).
 *
 * There was a leading-edge fog layer here, gradient-filling the strip right of the
 * character. It's gone. It never had a job: the no-lookahead constraint is structural —
 * unplayed bars aren't in the frame at all — so the fog was hiding nothing, and what it
 * actually did was wash out the right-hand two thirds of the scene, the parallax
 * terrain, and the axis behind a haze.
 */

export interface Stage {
  app: Application
  layout: Layout
  /** Parallax and sky. */
  background: Container
  /** Poles and the ground line. */
  world: Container
  /** The character and its ghost stack. */
  actors: Container
  /**
   * Parallax that passes *in front of* the character at >1×. Above `actors`, which
   * is the whole reason it's a separate layer.
   */
  overlay: Container
  /** Y axis, top HUD, stop lines. Above everything else. */
  hud: Container
  /** Called after a resize; re-reads `layout`. */
  onResize(listener: (layout: Layout) => void): void
  destroy(): void
}

export interface StageOptions {
  host: HTMLElement
  /** Resolved once at run start from orientation, then frozen for the run. */
  visibleBarCount: number
  theme: VisualTheme
  /** Drives the vertical budget: panes share 40% of the chart area. */
  subPaneCount?: number
}

export async function createStage({
  host,
  visibleBarCount,
  theme,
  subPaneCount = 0,
}: StageOptions): Promise<Stage> {
  const app = new Application()
  await app.init({
    background: theme.palette.sky[1],
    antialias: true,
    resizeTo: host,
    // Sharp on a phone without paying for 3x on a desktop that doesn't need it.
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
    autoDensity: true,
  })
  host.appendChild(app.canvas)

  const background = new Container()
  const world = new Container()
  const actors = new Container()
  const overlay = new Container()
  const hud = new Container()
  // Order matters beyond aesthetics: the HUD sits above the world so the Y axis and
  // the readouts stay legible over it.
  app.stage.addChild(background, world, actors, overlay, hud)

  let layout = computeLayout(app.screen.width, app.screen.height, visibleBarCount, subPaneCount)
  const listeners: ((layout: Layout) => void)[] = []

  const relayout = (): void => {
    layout = computeLayout(app.screen.width, app.screen.height, visibleBarCount, subPaneCount)
    for (const listener of listeners) listener(layout)
  }

  app.renderer.on('resize', relayout)

  return {
    app,
    get layout() {
      return layout
    },
    background,
    world,
    actors,
    overlay,
    hud,
    onResize(listener) {
      listeners.push(listener)
    },
    destroy() {
      app.renderer.off('resize', relayout)
      app.destroy(true, { children: true })
    },
  }
}
