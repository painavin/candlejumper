import { characters } from '@content/characters/index.js'
import type { Character, RigShape } from '@content/characters/types.js'

/**
 * A character rig as SVG primitives, for the settings picker.
 *
 * The picker used to show a two-colour swatch and a name. That works while the roster is
 * three long and stops working immediately after, because **shape is identity here** —
 * the art direction is geometric silhouettes, so choosing by colour is choosing blind.
 * It is also the only thing that tells a green frog from a green bull.
 *
 * SVG rather than a second Pixi canvas per entry: `src/ui` may not import `@render` (see
 * eslint.zones.js), spinning up six renderers to draw twenty ellipses would be absurd,
 * and this way the preview is a pure function with a test rather than a live scene.
 *
 * The trade is that this file has to agree with `drawShape` in the character layer about
 * what a rig means, and nothing enforces that. It is kept small and literal for exactly
 * that reason — the same three primitives, the same offsets in body radii, no styling of
 * its own. Two details are easy to get wrong and worth stating:
 *
 *   - **Offsets are in radii, not pixels.** One radius is `PREVIEW_RADIUS` here and a
 *     layout-derived number in the game; the rig is identical either way.
 *   - **An `arc` is drawn as an ellipse about its own centre.** That is what the layer
 *     actually does, despite its comment claiming a hinge at the inner edge — see the
 *     note in `drawShape`.
 *
 * Static pose, no animation: a picker showing six looping animations is noise, and the
 * flap is a rotation the silhouette barely depends on.
 */

/** One body radius, in the preview's own units. Arbitrary; keeps the numbers tidy. */
const PREVIEW_RADIUS = 100

/** Breathing room around the widest rig, as a fraction of it. */
const PADDING = 0.08

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type PreviewShape =
  | { kind: 'ellipse'; rx: number; ry: number; transform: string; fill: string }
  | { kind: 'polygon'; points: string; transform: string; fill: string }

/** The triangle `drawShape` fills: apex forward, in body radii. */
function triangleVertices(width: number, height: number): [number, number][] {
  return [
    [-width / 2, height / 2],
    [width / 2, 0],
    [-width / 2, -height / 2],
  ]
}

function rotate([x, y]: [number, number], radians: number): [number, number] {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [x * cos - y * sin, x * sin + y * cos]
}

/**
 * The axis-aligned box a rig occupies, in body radii.
 *
 * Rotation is accounted for, which is the only fiddly part: a rotated ellipse's
 * half-extents are `hypot(rx·cosθ, ry·sinθ)` and `hypot(rx·sinθ, ry·cosθ)`, and a
 * triangle's are found by rotating its three vertices. Ignoring rotation would clip the
 * rocket's nose cone, which is a triangle turned a quarter turn.
 *
 * Limbs are measured in their **rest pose**. The flap adds up to `flapAmplitude` more
 * rotation at the apex of a jump, which the preview never shows.
 */
export function rigBounds(rig: readonly RigShape[]): Bounds {
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0

  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const shape of rig) {
    const radians = shape.rotation ?? 0
    if (shape.shape === 'triangle') {
      for (const vertex of triangleVertices(shape.width, shape.height)) {
        const [x, y] = rotate(vertex, radians)
        include(shape.dx + x, shape.dy + y)
      }
      continue
    }
    const rx = shape.width / 2
    const ry = shape.height / 2
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const hx = Math.hypot(rx * cos, ry * sin)
    const hy = Math.hypot(rx * sin, ry * cos)
    include(shape.dx - hx, shape.dy - hy)
    include(shape.dx + hx, shape.dy + hy)
  }

  return { minX, minY, maxX, maxY }
}

/**
 * One square viewBox for the whole roster, centred on the rig origin.
 *
 * Shared rather than per-character on purpose: fitting each rig to its own box would
 * scale a frog and a rocket to the same height and throw away the one thing the preview
 * is for. Relative size and proportion are the information.
 *
 * Square and origin-centred so every entry's body sits in the same place in its cell,
 * which is what makes the row scannable.
 */
export function previewViewBox(roster: readonly Character[] = characters): string {
  let half = 0
  for (const entry of roster) {
    const { minX, minY, maxX, maxY } = rigBounds(entry.rig)
    half = Math.max(half, -minX, maxX, -minY, maxY)
  }
  const extent = half * (1 + PADDING) * PREVIEW_RADIUS
  return `${-extent} ${-extent} ${extent * 2} ${extent * 2}`
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`
}

/** Rounded, because a transform string full of floating-point tails is unreadable. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A rig as SVG shapes, in the order they are drawn.
 *
 * Order is preserved because rigs use it: the frog's far leg is listed before its body
 * so the body covers the leg's root, and reordering would flatten that.
 */
export function previewShapes(character: Character): PreviewShape[] {
  return character.rig.map((shape) => {
    const fill = hex(character.palette[shape.slot])
    const degrees = round(((shape.rotation ?? 0) * 180) / Math.PI)
    const x = round(shape.dx * PREVIEW_RADIUS)
    const y = round(shape.dy * PREVIEW_RADIUS)
    const transform = degrees === 0 ? `translate(${x} ${y})` : `translate(${x} ${y}) rotate(${degrees})`

    if (shape.shape === 'triangle') {
      const points = triangleVertices(shape.width, shape.height)
        .map(([px, py]) => `${round(px * PREVIEW_RADIUS)},${round(py * PREVIEW_RADIUS)}`)
        .join(' ')
      return { kind: 'polygon', points, transform, fill }
    }

    return {
      kind: 'ellipse',
      rx: round((shape.width / 2) * PREVIEW_RADIUS),
      ry: round((shape.height / 2) * PREVIEW_RADIUS),
      transform,
      fill,
    }
  })
}
