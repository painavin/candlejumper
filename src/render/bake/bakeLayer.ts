import { Container, Graphics, RenderTexture } from 'pixi.js'
import type { Renderer } from 'pixi.js'
import type { Cloud, MotifPlacement } from '@generation/index.js'
import type { MotifKind } from '@shared/contracts/index.js'

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
  motif: MotifKind,
  width: number,
  height: number,
  colour: number
): RenderTexture {
  const graphics = new Graphics()

  /**
   * Lobes on a shallow arch, normalised to fill exactly `total` vertically.
   *
   * Shared by `trees` and `bushes`, and the normalisation is the load-bearing part.
   * Which lobe is highest depends on the count — an odd canopy has one at the apex, an
   * even one does not — so any fixed offset puts even-lobed canopies below the strip top
   * and odd-lobed ones through it. Solving for the real extremes makes the shape span
   * exactly the height asked for, whatever the count.
   */
  const arch = (
    count: number,
    radius: number,
    total: number
  ): { dx: number; dy: number; r: number }[] => {
    const spacing = radius * 1.05
    const rise = radius * 0.55
    const raw = Array.from({ length: count }, (_, index) => {
      const u = count === 1 ? 0 : (index / (count - 1)) * 2 - 1
      return {
        dx: u * spacing * (count - 1) * 0.5,
        dy: u * u * rise,
        r: radius * (1 - 0.16 * u * u),
      }
    })
    const top = Math.min(...raw.map((lobe) => lobe.dy - lobe.r))
    const bottom = Math.max(...raw.map((lobe) => lobe.dy + lobe.r))
    const k = total / Math.max(1e-6, bottom - top)
    return raw.map((lobe) => ({ dx: lobe.dx * k, dy: (lobe.dy - top) * k, r: lobe.r * k }))
  }

  /**
   * Deterministic per-part jitter from an index.
   *
   * Multi-part motifs need their parts to differ, and the PRNG is not available here —
   * generation owns randomness, baking owns drawing. An irrational-ish multiplier off
   * the index gives variation that is stable for a given seed because it is not random
   * at all: the same placement always bakes the same shape.
   */
  const wobble = (index: number, offset = 0): number =>
    Math.abs(Math.sin((index + 1) * 2.399 + offset))

  for (const placement of motifs) {
    const x = placement.x * width
    const size = height * placement.scale
    const lean = placement.lean
    const parts = placement.lobes

    if (motif === 'trees') {
      // Trunk plus an arched canopy. Three overlapping circles rather than one, because
      // a single circle on a stick reads as a lollipop at this size — drawn as separate
      // fills of the same colour, which is safe precisely because it *is* one colour.
      const radius = size * (0.26 - 0.02 * parts)
      const canopy = arch(parts, radius, size * 0.62)
      const trunkWidth = Math.max(2, size * 0.1)
      const crownY = height - size
      // Trunk starts inside the canopy so it emerges from under it rather than beside it.
      const trunkTop = crownY + size * 0.24
      graphics.rect(x - trunkWidth / 2, trunkTop, trunkWidth, height - trunkTop).fill(colour)
      for (const lobe of canopy) {
        graphics.circle(x + lobe.dx, crownY + lobe.dy, lobe.r).fill(colour)
      }
      continue
    }

    if (motif === 'bushes') {
      // A canopy with no stem, sitting on the ground: the cheapest motif here, being the
      // tree's crown with the trunk left off.
      const radius = size * (0.3 - 0.02 * parts)
      for (const lobe of arch(parts, radius, size)) {
        graphics.circle(x + lobe.dx, height - size + lobe.dy, lobe.r).fill(colour)
      }
      continue
    }

    if (motif === 'conifer') {
      /**
       * Three stacked triangles over a short trunk, widening downward.
       *
       * The tiers are placed so the lowest one's base meets the trunk top exactly:
       * `0.27 * 2 + 0.46 = 1`, of the cone's own height. Getting that sum wrong is how a
       * stacked shape ends up either floating or overrunning the strip.
       */
      const trunkHeight = size * 0.12
      const coneHeight = size - trunkHeight
      const trunkWidth = Math.max(2, size * 0.08)
      graphics
        .rect(x - trunkWidth / 2, height - trunkHeight, trunkWidth, trunkHeight)
        .fill(colour)
      for (let tier = 0; tier < 3; tier++) {
        const top = height - size + coneHeight * 0.27 * tier
        const bottom = top + coneHeight * 0.46
        const halfWidth = size * (0.1 + 0.05 * tier)
        graphics.poly([x, top, x + halfWidth, bottom, x - halfWidth, bottom]).fill(colour)
      }
      continue
    }

    if (motif === 'reeds') {
      /**
       * A cluster of thin blades from one root, fanning and leaning together.
       *
       * The lean applies to the whole cluster rather than per blade, which is what makes
       * it read as wind on one plant instead of several unrelated ones.
       */
      const width2 = Math.max(1.5, size * 0.045)
      for (let blade = 0; blade < parts; blade++) {
        const spread = (blade / Math.max(1, parts - 1)) * 2 - 1
        const bladeHeight = size * (0.62 + 0.38 * wobble(blade))
        const rootX = x + spread * size * 0.08
        const tipX = rootX + spread * size * 0.16 + Math.sin(lean) * bladeHeight * 0.5
        graphics
          .poly([rootX - width2, height, rootX + width2, height, tipX, height - bladeHeight])
          .fill(colour)
      }
      continue
    }

    if (motif === 'rocks') {
      /**
       * A low irregular dome: a half-ellipse walked in steps with the radius jittered.
       *
       * Deliberately short — 40% of `size` — because a rock is ground texture rather
       * than occlusion. It adds weight along the ground line without crossing the
       * character, which is the one thing this layer must not do carelessly.
       */
      const rockHeight = size * 0.4
      const rockWidth = size * 0.5
      const steps = 3 + parts
      const points: number[] = [x - rockWidth, height]
      for (let step = 1; step < steps; step++) {
        const angle = Math.PI * (1 - step / steps)
        const jitter = 1 - 0.22 * wobble(step, placement.x)
        points.push(x + Math.cos(angle) * rockWidth, height - Math.sin(angle) * rockHeight * jitter)
      }
      points.push(x + rockWidth, height)
      graphics.poly(points).fill(colour)
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
