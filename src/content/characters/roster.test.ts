import { describe, expect, it } from 'vitest'
import { visualThemes } from '../visualThemes/index.js'
import { bear, bull, character, characters, frog, hedgehog, kangaroo, robin, rocket } from './index.js'
import type { Character } from './types.js'

/**
 * Roster invariants.
 *
 * The rigs themselves cannot be tested — they are judged by eye — but the properties
 * that make a roster *usable* are arithmetic, and every one of these was a real mistake
 * caught while adding the frog, the rocket and the kangaroo.
 *
 * Deliberately **not** tested: an absolute contrast floor against every sky. Robin's gold
 * and Bull's mint both sit within 0.08 luma of Jolly's pale lower sky, so a floor high
 * enough to be meaningful would fail two shipped characters. Asserting a rule the
 * shipped content breaks is worse than asserting nothing, so what is checked instead is
 * that no *new* character is worse than the roster already is.
 */

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

  it('keeps every body colour distinguishable in the picker', () => {
    /**
     * Body hue is what separates one entry from another at a glance, and the picker puts
     * them side by side. The kangaroo is purple rather than tan for exactly this reason —
     * a naturalistic tan lands within 20 degrees of Robin's gold.
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
    for (const entry of [frog, rocket, kangaroo]) {
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
    const swept = [frog, kangaroo].flatMap((entry) => entry.rig.filter((shape) => shape.flaps))
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
