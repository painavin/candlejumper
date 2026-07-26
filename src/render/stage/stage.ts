import { Application, Container, Graphics } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { Layout } from './layout.js'
import { computeLayout } from './layout.js'

/**
 * PixiJS setup and the layer order. This is the only place the `Application`
 * exists; everything else takes a `Container` and a `Layout`.
 *
 * Layer order matters for two reasons beyond aesthetics: the fog strip must sit
 * above the world so the leading edge reads as atmosphere, and the HUD must sit
 * above the fog so the Y axis stays legible over it (docs/hud.md).
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
   * Parallax that passes *in front of* the character at >1×. Above `actors` and
   * below `fog`, which is the whole reason it's a separate layer.
   */
  overlay: Container
  /** Leading-edge fog: atmosphere only, since unplayed poles are never drawn. */
  fog: Container
  /** Y axis, top HUD, stop lines. Above the fog. */
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
  const fog = new Container()
  const hud = new Container()
  // Order matters beyond aesthetics: the fog must sit above the world so the
  // leading edge reads as atmosphere, and the HUD above the fog so the Y axis stays
  // legible over it.
  app.stage.addChild(background, world, actors, overlay, fog, hud)

  const fogGraphics = new Graphics()
  fog.addChild(fogGraphics)

  let layout = computeLayout(app.screen.width, app.screen.height, visibleBarCount, subPaneCount)
  const listeners: ((layout: Layout) => void)[] = []

  const drawFog = (): void => {
    // A plain gradient in the fog colour. It carries no information-hiding
    // burden — unplayed poles don't exist — so there is no opacity to tune.
    fogGraphics.clear()
    const steps = 12
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      fogGraphics
        .rect(
          layout.characterX + layout.fogWidth * t,
          0,
          layout.fogWidth / steps + 1,
          layout.height
        )
        .fill({ color: theme.palette.fog, alpha: 0.14 + t * 0.62 })
    }
  }

  const relayout = (): void => {
    layout = computeLayout(app.screen.width, app.screen.height, visibleBarCount, subPaneCount)
    drawFog()
    for (const listener of listeners) listener(layout)
  }

  drawFog()
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
    fog,
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
