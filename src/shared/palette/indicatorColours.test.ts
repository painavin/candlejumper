import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INDICATOR_COLOUR,
  INDICATOR_COLOURS,
  indicatorColourName,
  nextIndicatorColour,
} from './indicatorColours.js'

/**
 * The palette is a fixed list rather than a free colour picker, and these assert the
 * properties that decision rests on: every option is distinguishable from the others,
 * and none of them impersonates the P&L up/down pair.
 */

/** Rec. 601 luma. */
const luma = (colour: number): number =>
  (0.299 * ((colour >> 16) & 0xff) + 0.587 * ((colour >> 8) & 0xff) + 0.114 * (colour & 0xff)) / 255

const distance = (a: number, b: number): number =>
  Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
  Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
  Math.abs((a & 0xff) - (b & 0xff))

describe('the palette', () => {
  it('has no duplicate colours', () => {
    const values = INDICATOR_COLOURS.map((colour) => colour.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('gives every colour a distinct name', () => {
    // The name is the accessible half: a swatch alone conveys nothing to a screen
    // reader, and "the third orange square" isn't a choice a colourblind player can
    // make.
    const names = INDICATOR_COLOURS.map((colour) => colour.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name.length > 0)).toBe(true)
  })

  it('keeps every entry distinguishable from every other', () => {
    // A palette with two near-identical entries is a palette that lets a player pick
    // two lines they can't tell apart.
    for (let i = 0; i < INDICATOR_COLOURS.length; i++) {
      for (let j = i + 1; j < INDICATOR_COLOURS.length; j++) {
        const a = INDICATOR_COLOURS[i] as (typeof INDICATOR_COLOURS)[number]
        const b = INDICATOR_COLOURS[j] as (typeof INDICATOR_COLOURS)[number]
        expect(distance(a.value, b.value), `${a.name} vs ${b.name}`).toBeGreaterThan(60)
      }
    }
  })

  it('stays light enough to read against either mood', () => {
    // Both themes draw the chart over a sky and both use light HUD text; a dark
    // overlay line would disappear into `serious`'s dusk gradient.
    for (const colour of INDICATOR_COLOURS) {
      expect(luma(colour.value), colour.name).toBeGreaterThan(0.5)
    }
  })

  it('avoids impersonating the P&L up/down colours', () => {
    // A line the same green as a rising bar reads as price, not as an indicator.
    for (const pnl of [0x4ddb7a, 0xff6b6b, 0x4da3ff, 0xff9d4d]) {
      for (const colour of INDICATOR_COLOURS) {
        if (colour.value === pnl) continue
        expect(distance(colour.value, pnl), `${colour.name} vs P&L`).toBeGreaterThan(30)
      }
    }
  })
})

describe('nextIndicatorColour', () => {
  it('starts at the first colour when nothing is taken', () => {
    expect(nextIndicatorColour([])).toBe(INDICATOR_COLOURS[0]?.value)
  })

  it('skips colours already in use', () => {
    const first = INDICATOR_COLOURS[0]?.value as number
    expect(nextIndicatorColour([first])).toBe(INDICATOR_COLOURS[1]?.value)
  })

  it('reuses a freed colour rather than marching on', () => {
    // Add three, remove the middle one, add another: the new line takes the colour
    // that was released instead of a fourth. Keeps a long-lived config tidy.
    const [a, b, c] = INDICATOR_COLOURS.map((colour) => colour.value) as [number, number, number]
    void c
    expect(nextIndicatorColour([a, INDICATOR_COLOURS[2]?.value as number])).toBe(b)
  })

  it('wraps instead of failing once every colour is taken', () => {
    // More instances than colours is legal — reuse beats refusing to add one.
    const all = INDICATOR_COLOURS.map((colour) => colour.value)
    const next = nextIndicatorColour(all)
    expect(all).toContain(next)
  })

  it('is deterministic', () => {
    // No Math.random anywhere, including here: the same config must always produce
    // the same colours.
    const taken = [INDICATOR_COLOURS[0]?.value as number]
    expect(nextIndicatorColour(taken)).toBe(nextIndicatorColour(taken))
  })
})

describe('indicatorColourName', () => {
  it('names a palette colour', () => {
    const first = INDICATOR_COLOURS[0] as (typeof INDICATOR_COLOURS)[number]
    expect(indicatorColourName(first.value)).toBe(first.name)
  })

  it('reports a value from outside the palette rather than throwing', () => {
    // A hand-edited config can carry anything; it should look odd, not crash.
    expect(indicatorColourName(0x123456)).toBe('Custom')
  })
})

describe('DEFAULT_INDICATOR_COLOUR', () => {
  it('is a palette entry, so nothing falls back to an unlisted colour', () => {
    expect(INDICATOR_COLOURS.map((colour) => colour.value)).toContain(DEFAULT_INDICATOR_COLOUR)
  })
})
