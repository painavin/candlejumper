import { Container, Sprite, TilingSprite } from 'pixi.js'
import type { Renderer, RenderTexture } from 'pixi.js'
import type { BackgroundLayerName, RunConfig } from '@config/index.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import { generateClouds, generateHeightfield, generateMotifs } from '@generation/index.js'
import { deriveSeed } from '@shared/math/index.js'
import type { Layout } from '../stage/layout.js'
import { bakeClouds, bakeMotifs, bakeSky, bakeTerrain } from '../bake/bakeLayer.js'

/**
 * The parallax stack.
 *
 * Speeds are **multipliers of the base scroll speed**, so turning `scrollSpeed` up
 * speeds the whole scene coherently. Multipliers are a motion property and stay
 * fixed across themes — only the skin changes with mood, never the parallax maths.
 *
 * The stack extends *past* the gameplay plane: the foreground layer passes in front
 * of the character at >1×, which is the strongest depth cue available in 2D and the
 * easiest one to omit by accident when thinking of parallax as "backgrounds".
 *
 * Layers have zero coupling to trading state, so this whole file is safe to skip in
 * a headless build.
 */

export interface ParallaxStack {
  /** Mounts behind the world. */
  background: Container
  /**
   * Mounts *in front of* the character. Separate container because a layer that
   * passes over the actor is the depth cue — putting it in `background` would
   * quietly discard the whole point of it.
   */
  foreground: Container
  /** Scroll to a world position, in bar widths travelled. */
  update(barsTravelled: number, barWidth: number): void
  /** Re-bake for a new viewport. Textures are sized from it. */
  rebuild(layout: Layout): void
  destroy(): void
}

interface Layer {
  name: BackgroundLayerName
  sprite: TilingSprite | Sprite
  speed: number
  textures: RenderTexture[]
}

/**
 * Texture width as a multiple of the viewport. Longer strips reduce visible
 * repetition but cost memory on mobile; 2× is the documented balance, and
 * repetition in a fast-scrolling distant layer is barely perceptible.
 */
const TEXTURE_WIDTH_MULTIPLE = 2

export function createParallaxStack(
  renderer: Renderer,
  config: RunConfig,
  theme: VisualTheme,
  layout: Layout
): ParallaxStack {
  const background = new Container()
  const foregroundContainer = new Container()
  let layers: Layer[] = []

  const enabled = (name: BackgroundLayerName): boolean =>
    config.background.layers[name]?.enabled !== false
  const speedOf = (name: BackgroundLayerName): number =>
    config.background.layers[name]?.speedMultiplier ?? 1

  function build(target: Layout): void {
    destroyLayers()

    const width = Math.ceil(target.width * TEXTURE_WIDTH_MULTIPLE)
    const seed = config.visuals.worldSeed
    const built: Layer[] = []

    const add = (
      name: BackgroundLayerName,
      texture: RenderTexture,
      y: number,
      height: number,
      tiling = true
    ): void => {
      const sprite = tiling
        ? new TilingSprite({ texture, width: target.width, height })
        : new Sprite(texture)
      sprite.position.set(0, y)
      if (!tiling) {
        sprite.width = target.width
        sprite.height = height
      }
      background.addChild(sprite)
      built.push({ name, sprite, speed: speedOf(name), textures: [texture] })
    }

    if (enabled('sky')) {
      // Near-static, so a plain sprite rather than a tiling one.
      add('sky', bakeSky(renderer, theme.palette.sky, 16, target.height), 0, target.height, false)
    }

    if (enabled('clouds')) {
      const height = Math.round(target.height * 0.55)
      const clouds = generateClouds(theme.clouds, seed)
      add('clouds', bakeClouds(renderer, clouds, width, height, theme.palette.clouds), 0, height)
    }

    if (enabled('mountains')) {
      // Two ranges from one algorithm: distant gets lower amplitude and higher
      // frequency, near the opposite.
      const height = Math.round(target.chartHeight * 0.85)
      const y = target.groundY - height

      const far = generateHeightfield(
        256,
        theme.terrain.mountainsFar,
        deriveSeed(seed, 'mountains:far')
      )
      add(
        'mountains',
        bakeTerrain(renderer, far, width, height, theme.palette.mountains[0]),
        y,
        height
      )

      const near = generateHeightfield(
        320,
        theme.terrain.mountainsNear,
        deriveSeed(seed, 'mountains:near')
      )
      add(
        'mountains',
        bakeTerrain(renderer, near, width, height, theme.palette.mountains[1]),
        y,
        height
      )
    }

    if (enabled('trees')) {
      const height = Math.round(target.chartHeight * 0.32)
      const trees = generateHeightfield(384, theme.terrain.trees, deriveSeed(seed, 'trees'))
      add(
        'trees',
        bakeTerrain(renderer, trees, width, height, theme.palette.trees),
        target.groundY - height,
        height
      )
    }

    layers = built
  }

  function buildForeground(target: Layout): Layer | undefined {
    if (!enabled('foreground')) return undefined
    const height = Math.round(Math.max(28, target.height * 0.13))
    const motifs = generateMotifs(theme.foreground, config.visuals.worldSeed)
    const texture = bakeMotifs(
      renderer,
      motifs,
      theme.foreground.motif,
      Math.ceil(target.width * TEXTURE_WIDTH_MULTIPLE),
      height,
      theme.palette.foreground
    )
    const sprite = new TilingSprite({ texture, width: target.width, height })
    sprite.position.set(0, target.height - height)
    foregroundContainer.addChild(sprite)
    return { name: 'foreground', sprite, speed: speedOf('foreground'), textures: [texture] }
  }

  let foreground: Layer | undefined

  function destroyLayers(): void {
    for (const layer of layers) {
      layer.sprite.destroy()
      for (const texture of layer.textures) texture.destroy(true)
    }
    layers = []
  }

  build(layout)
  foreground = buildForeground(layout)

  return {
    background,
    foreground: foregroundContainer,

    update(barsTravelled, barWidth) {
      const distance = barsTravelled * barWidth
      for (const layer of layers) {
        if (layer.sprite instanceof TilingSprite) {
          layer.sprite.tilePosition.x = -distance * layer.speed
        }
      }
      if (foreground?.sprite instanceof TilingSprite) {
        foreground.sprite.tilePosition.x = -distance * foreground.speed
      }
    },

    rebuild(target) {
      // Regeneration is a load-time cost, and a resize is rare enough to pay it
      // again rather than stretch a baked texture.
      const previous = foreground
      build(target)
      if (previous) {
        previous.sprite.destroy()
        for (const texture of previous.textures) texture.destroy(true)
      }
      foreground = buildForeground(target)
    },

    destroy() {
      destroyLayers()
      if (foreground) {
        foreground.sprite.destroy()
        for (const texture of foreground.textures) texture.destroy(true)
      }
      background.destroy({ children: true })
      foregroundContainer.destroy({ children: true })
    },
  }
}
