import { Container, Graphics, RenderTexture } from 'pixi.js'
import type { Renderer } from 'pixi.js'
import type { Cloud, MotifPlacement } from '@generation/index.js'

/**
 * Generation output → baked `RenderTexture`.
 *
 * **The core rule: generate once, not per frame.** Everything here runs at load
 * time and hands a texture to a tiling sprite; per-frame cost is then exactly what
 * a hand-drawn PNG would have cost. Redrawing vector shapes every frame is the
 * trap that makes procedural rendering seem expensive, and baking avoids it
 * entirely.
 *
 * This is also the seam that keeps `generation/` testable: everything upstream of
 * here is numbers, everything here is PixiJS.
 */

function bake(renderer: Renderer, width: number, height: number, draw: Graphics): RenderTexture {
  const texture = RenderTexture.create({ width, height, antialias: true })
  const stage = new Container()
  stage.addChild(draw)
  renderer.render({ container: stage, target: texture, clear: true })
  stage.destroy({ children: true })
  return texture
}

/** A filled polygon under the heightfield's silhouette. */
export function bakeTerrain(
  renderer: Renderer,
  heights: Float64Array,
  width: number,
  height: number,
  colour: number
): RenderTexture {
  const graphics = new Graphics()
  const step = width / heights.length

  graphics.moveTo(0, height)
  for (let i = 0; i < heights.length; i++) {
    graphics.lineTo(i * step, height - (heights[i] ?? 0) * height)
  }
  // Close on the first sample, not the last: the field is circular, so this is the
  // same point and the tile joins without a seam.
  graphics.lineTo(width, height - (heights[0] ?? 0) * height)
  graphics.lineTo(width, height)
  graphics.closePath()
  graphics.fill(colour)

  return bake(renderer, width, height, graphics)
}

export function bakeClouds(
  renderer: Renderer,
  clouds: readonly Cloud[],
  width: number,
  height: number,
  colour: number
): RenderTexture {
  const graphics = new Graphics()

  for (const cloud of clouds) {
    const radius = cloud.scale * height
    const cx = cloud.x * width
    const cy = cloud.y * height
    for (const puff of cloud.puffs) {
      graphics
        .circle(cx + puff.dx * radius, cy + puff.dy * radius, puff.radius * radius)
        .fill({ color: colour, alpha: cloud.alpha })
    }
    // A wrapped copy, so a cloud straddling the edge appears on both sides rather
    // than being clipped — the tile has to loop for every layer, not just terrain.
    if (cx + radius * 2 > width) {
      for (const puff of cloud.puffs) {
        graphics
          .circle(cx - width + puff.dx * radius, cy + puff.dy * radius, puff.radius * radius)
          .fill({ color: colour, alpha: cloud.alpha })
      }
    }
  }

  return bake(renderer, width, height, graphics)
}

export function bakeMotifs(
  renderer: Renderer,
  motifs: readonly MotifPlacement[],
  motif: 'grass' | 'leaves' | 'railing',
  width: number,
  height: number,
  colour: number
): RenderTexture {
  const graphics = new Graphics()

  for (const placement of motifs) {
    const x = placement.x * width
    const size = height * placement.scale
    const lean = placement.lean

    if (motif === 'railing') {
      graphics.rect(x, height - size, Math.max(2, size * 0.12), size).fill(colour)
      continue
    }
    if (motif === 'leaves') {
      graphics.ellipse(x, height - size * 0.5, size * 0.34, size * 0.2).fill(colour)
      continue
    }
    // Grass: a tapered triangle leaning by its own amount.
    const tipX = x + Math.sin(lean) * size * 0.5
    graphics
      .poly([x - size * 0.09, height, x + size * 0.09, height, tipX, height - size])
      .fill(colour)
  }

  return bake(renderer, width, height, graphics)
}

/** The sky is a vertical gradient — nothing to generate beyond interpolation. */
export function bakeSky(
  renderer: Renderer,
  [top, bottom]: readonly [number, number],
  width: number,
  height: number
): RenderTexture {
  const graphics = new Graphics()
  const bands = 48
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    graphics.rect(0, (height * i) / bands, width, height / bands + 1).fill(mix(top, bottom, t))
  }
  return bake(renderer, width, height, graphics)
}

function mix(a: number, b: number, t: number): number {
  const channel = (shift: number): number => {
    const from = (a >> shift) & 0xff
    const to = (b >> shift) & 0xff
    return Math.round(from + (to - from) * t) << shift
  }
  return channel(16) | channel(8) | channel(0)
}
