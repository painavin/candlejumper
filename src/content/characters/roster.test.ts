import { describe, expect, it } from 'vitest'
import { visualThemes } from '../visualThemes/index.js'
import { bear, bull, character, characters, frog, hedgehog, robin, rocket, squirrel } from './index.js'
import type { Character, RigShape } from './types.js'

/**
 * Roster invariants.
 *
 * The rigs themselves cannot be tested — they are judged by eye — but the properties
 * that make a roster *usable* are arithmetic, and every one of these was a real mistake
 * caught while adding the frog, the rocket and the squirrel — or, in two cases, caught in
 * content that had already shipped.
 *
 * Deliberately **not** tested: an absolute contrast floor against every sky. Robin's gold
 * and Bull's mint both sit within 0.08 luma of Jolly's pale lower sky, so a floor high
 * enough to be meaningful would fail two shipped characters. Asserting a rule the
 * shipped content breaks is worse than asserting nothing, so what is checked instead is
 * that no *new* character is worse than the roster already is.
 */

/**
 * Sample points around a rig part, in rig space.
 *
 * Enough of them to decide whether two parts touch. An ellipse gets its perimeter and
 * centre; a triangle gets its vertices, edge midpoints and centroid. Bounding boxes were
 * tried first and are useless here — Bear's floating ears overlap the body's *box* while
 * hovering a clear 0.14 radii above the body's actual surface.
 *
 * The triangle vertices repeat `drawShape`'s polygon. Duplicated on purpose: this is
 * assertion machinery for a test, and shipping a geometry module used only by a test
 * would be the worse trade.
 */
function samplePoints(shape: RigShape): [number, number][] {
  const radians = shape.rotation ?? 0
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const place = ([x, y]: [number, number]): [number, number] => [
    shape.dx + x * cos - y * sin,
    shape.dy + x * sin + y * cos,
  ]

  if (shape.shape === 'triangle') {
    const corners: [number, number][] = [
      [-shape.width / 2, shape.height / 2],
      [shape.width / 2, 0],
      [-shape.width / 2, -shape.height / 2],
    ]
    const midpoints = corners.map((corner, index): [number, number] => {
      const next = corners[(index + 1) % corners.length] as [number, number]
      return [(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2]
    })
    return [...corners, ...midpoints, [0, 0] as [number, number]].map(place)
  }

  const rx = shape.width / 2
  const ry = shape.height / 2
  const perimeter: [number, number][] = []
  for (let step = 0; step < 24; step++) {
    const angle = (step / 24) * Math.PI * 2
    perimeter.push([rx * Math.cos(angle), ry * Math.sin(angle)])
  }
  return [...perimeter, [0, 0] as [number, number]].map(place)
}

/** Is a rig-space point inside this part? */
function contains(shape: RigShape, [px, py]: [number, number]): boolean {
  const radians = shape.rotation ?? 0
  // Into the part's own frame, where the test is axis-aligned.
  const dx = px - shape.dx
  const dy = py - shape.dy
  const x = dx * Math.cos(radians) + dy * Math.sin(radians)
  const y = -dx * Math.sin(radians) + dy * Math.cos(radians)

  if (shape.shape !== 'triangle') {
    const rx = shape.width / 2
    const ry = shape.height / 2
    return (x / rx) ** 2 + (y / ry) ** 2 <= 1
  }

  // Barycentric sign test against the same polygon `drawShape` fills.
  const vertices: [number, number][] = [
    [-shape.width / 2, shape.height / 2],
    [shape.width / 2, 0],
    [-shape.width / 2, -shape.height / 2],
  ]
  let positive = 0
  let negative = 0
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = vertices[i] as [number, number]
    const [bx, by] = vertices[(i + 1) % 3] as [number, number]
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross > 0) positive++
    if (cross < 0) negative++
  }
  return positive === 0 || negative === 0
}

/** Do two parts of a rig overlap at all? */
function touches(a: RigShape, b: RigShape): boolean {
  return (
    samplePoints(a).some((point) => contains(b, point)) ||
    samplePoints(b).some((point) => contains(a, point))
  )
}

const luma = (colour: number): number =>
  (0.299 * ((colour >> 16) & 0xff) + 0.587 * ((colour >> 8) & 0xff) + 0.114 * (colour & 0xff)) / 255

const hue = (colour: number): number => {
  const r = ((colour >> 16) & 0xff) / 255
  const g = ((colour >> 8) & 0xff) / 255
  const b = (colour & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma === 0) return -1
  const sector = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return (sector * 60 + 360) % 360
}

const hueGap = (a: number, b: number): number => {
  const delta = Math.abs(hue(a) - hue(b))
  return Math.min(delta, 360 - delta)
}

/** Every sky stop the character can be seen against, across all five themes. */
const skyStops = visualThemes.flatMap((theme) => [...theme.palette.sky])

/** The worst contrast any shipped character has against any sky, as the bar to clear. */
const worstSkyGap = (colour: number): number =>
  Math.min(...skyStops.map((stop) => Math.abs(luma(colour) - luma(stop))))

describe('roster', () => {
  it('has unique ids', () => {
    const ids = characters.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not offer the stop marker as a playable character', () => {
    /**
     * The hedgehog is a rig, not a roster entry. A marker the player could choose to
     * *be* would make the one thing this game must never be ambiguous about — whether a
     * level will actually eject you — ambiguous.
     */
    expect(characters).not.toContain(hedgehog)
    expect(characters.map((entry) => entry.id)).not.toContain('hedgehog')
  })

  it('falls back to the default rather than throwing on an unknown id', () => {
    // Ids are an open set: a saved config naming a character that no longer exists must
    // still start a run.
    expect(character('no-such-character')).toBe(robin)
    expect(character('frog')).toBe(frog)
  })

  it('joins every part of every rig to the rest of it', () => {
    /**
     * **No floating limbs.** This is the bug the first render of the frog, the rocket and
     * the squirrel made obvious, and which had shipped in Robin, Bull, Bear and the
     * hedgehog all along:
     * appendages were positioned by `dy` as though a body's top edge were flat, when an
     * ellipse curves away at the shoulders. Bear's ears sat at `dx ±0.42`, where the body
     * surface is at −0.304 while the ear's bottom was at −0.44 — a 0.136-radius gap,
     * about 4px in game. Bull's horns were worse: 0.6 radii clear of the body, which is
     * why they read as a bow tie rather than horns.
     *
     * A silhouette with detached pieces is not a silhouette. Every part must overlap at
     * least one other, which makes the rig one connected shape.
     */
    for (const entry of [...characters, hedgehog]) {
      entry.rig.forEach((shape, index) => {
        const others = entry.rig.filter((_, other) => other !== index)
        expect(
          others.some((other) => touches(shape, other)),
          `${entry.id} part ${index} (${shape.shape} at ${shape.dx},${shape.dy}) floats free`
        ).toBe(true)
      })
    }
  })

  it('encloses every dark part inside another part', () => {
    /**
     * A part on the silhouette's edge meets the **sky**, and only the body colour is
     * measured against skies. A dark part out there is therefore unchecked, and against a
     * dark theme it simply disappears.
     *
     * That is exactly how the frog's eyes broke. They bulge past the body on purpose, which
     * is what makes it read as a frog, but at luma 0.115 the eye sat within 0.04 of the top
     * of Serious, Neon and Vapour and the bottom of Cobalt — on four of five themes the
     * bulges dissolved and the frog lost its eyes. The fix was a body-coloured dome carrying
     * the bulge with the pupil inside it.
     *
     * Conditioned on **luma rather than on the `detail` slot**, which is the distinction the
     * first version of this test got wrong: it demanded every detail part be enclosed and so
     * failed the Rocket's exhaust, which is a *bright* detail and is supposed to stick out
     * below the hull. What cannot survive being on the edge is darkness, not decoration.
     */
    const DARK = 0.25
    for (const entry of [...characters, hedgehog]) {
      entry.rig.forEach((shape, index) => {
        if (luma(entry.palette[shape.slot]) >= DARK) return
        const others = entry.rig.filter((_, other) => other !== index)
        const escaping = samplePoints(shape).filter(
          (point) => !others.some((other) => contains(other, point))
        )
        expect(
          escaping.length,
          `${entry.id} part ${index} is dark and has ${escaping.length} points on the silhouette edge`
        ).toBe(0)
      })
    }
  })

  it('keeps every body colour distinguishable in the picker', () => {
    /**
     * Body hue is what separates one entry from another at a glance, and the picker puts
     * them side by side. The squirrel is purple rather than red-brown for exactly this
     * reason — a naturalistic brown lands within 20 degrees of Robin's gold.
     */
    const MIN_HUE_GAP = 25
    for (const a of characters) {
      for (const b of characters) {
        if (a === b) continue
        expect(
          hueGap(a.palette.body, b.palette.body),
          `${a.id} vs ${b.id}`
        ).toBeGreaterThanOrEqual(MIN_HUE_GAP)
      }
    }
  })

  it('gives every character an accent that reads against its own body', () => {
    // Limbs and horns are drawn in the accent over the body. Too close and the
    // silhouette collapses into one blob, which is the whole thing being avoided.
    for (const entry of characters) {
      expect(
        Math.abs(luma(entry.palette.body) - luma(entry.palette.accent)),
        entry.id
      ).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('never adds a character with worse sky contrast than the roster already has', () => {
    /**
     * The frog's first green was a bright lime, 0.012 luma from Jolly's pale lower sky —
     * effectively invisible for the part of a run where price is low. Measuring against
     * the *existing* worst rather than an absolute floor is what makes this assertion
     * true of shipped content and still able to catch that.
     */
    const floor = Math.min(worstSkyGap(robin.palette.body), worstSkyGap(bull.palette.body))
    for (const entry of [frog, rocket, squirrel]) {
      expect(worstSkyGap(entry.palette.body), entry.id).toBeGreaterThan(floor)
    }
  })

  it('drives limbs off the jump only where the rig actually has limbs', () => {
    // `limbDriver: 'hop'` on a rig with nothing flagged `flaps` is dead configuration,
    // and reads as if an animation exists when none does.
    for (const entry of characters) {
      if (entry.motion.limbDriver !== 'hop') continue
      expect(entry.rig.some((shape) => shape.flaps), entry.id).toBe(true)
    }
  })

  it('gives limbs a rest pose the flap adds to rather than replaces', () => {
    /**
     * The layer used to assign limb rotation outright, which silently discarded any base
     * `rotation` the rig asked for. That was invisible while Robin's wing — which starts
     * at zero — was the only limb, and would have flattened every swept-back leg added
     * since.
     */
    const swept = [frog, squirrel].flatMap((entry) => entry.rig.filter((shape) => shape.flaps))
    expect(swept.length).toBeGreaterThan(0)
    for (const shape of swept) expect(shape.rotation).toBeTruthy()
  })

  it('keeps every rig near the size the hitbox implies', () => {
    /**
     * The hitbox is one radius for every character, so a rig much larger than that
     * misrepresents the thing the player is aiming. This is a loose bound — Robin's beak
     * already reaches 1.06 radii — but it catches a rig drawn at the wrong scale, which
     * is the mistake that clipped every foreground motif before.
     */
    const extent = (entry: Character): number =>
      Math.max(...entry.rig.flatMap((shape) => [
        Math.abs(shape.dx) + shape.width / 2,
        Math.abs(shape.dy) + shape.height / 2,
      ]))
    for (const entry of [...characters, hedgehog]) {
      expect(extent(entry), entry.id).toBeLessThan(1.5)
    }
  })

  it('leaves the bar-driven characters alone', () => {
    // A regression guard on the three that shipped before `limbDriver` existed: adding
    // the field must not have changed how any of them moves.
    for (const entry of [robin, bull, bear]) expect(entry.motion.limbDriver).toBe('bar')
  })
})
