import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INDICATOR_COLOUR,
  INDICATOR_COLOURS,
  colourFromHex,
  colourToHex,
  describeColourRisk,
  indicatorColourName,
  nextIndicatorColour,
} from './indicatorColours.js'

/**
 * The palette is a curated list *plus* a free picker, and these assert the properties
 * the curation rests on: every option is distinguishable from the others, light enough
 * to read against either mood, and — under the default P&L palette — clear of the
 * up/down pair. Under `blue-orange` two of them are not, which has its own block below.
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

  it('avoids impersonating the default P&L up/down colours', () => {
    // A line the same green as a rising bar reads as price, not as an indicator.
    // Scoped to `red-green`, the default. `blue-orange` is asserted separately below,
    // because two presets do *not* clear it.
    for (const pnl of [0x4ddb7a, 0xff6b6b]) {
      for (const colour of INDICATOR_COLOURS) {
        expect(distance(colour.value, pnl), `${colour.name} vs P&L`).toBeGreaterThan(30)
      }
    }
  })

  it('offers a plain red, green and blue', () => {
    // Asked for by name, and the three that are hardest to fit: the P&L pair is a red
    // and a green, so these sit closer to it than anything else in the list.
    const names = INDICATOR_COLOURS.map((colour) => colour.name)
    expect(names).toContain('Red')
    expect(names).toContain('Green')
    expect(names).toContain('Blue')
  })

  it('keeps even those three clear of the default P&L pair, if narrowly', () => {
    // The margin is the point: they pass, but by 42/45 units where the rest of the
    // palette has 70 or more. Stated as a number so a future tweak that erodes it fails
    // here rather than being noticed on a chart.
    const euclid = (a: number, b: number): number =>
      Math.hypot(
        ((a >> 16) & 0xff) - ((b >> 16) & 0xff),
        ((a >> 8) & 0xff) - ((b >> 8) & 0xff),
        (a & 0xff) - (b & 0xff)
      )
    const PNL = { up: 0x4ddb7a, down: 0xff6b6b }
    const named = (name: string): number =>
      INDICATOR_COLOURS.find((colour) => colour.name === name)?.value as number

    expect(euclid(named('Red'), PNL.down)).toBeGreaterThan(40)
    expect(euclid(named('Green'), PNL.up)).toBeGreaterThan(40)
    // And so none of them warns under the default palette.
    for (const name of ['Red', 'Green', 'Blue']) {
      expect(describeColourRisk(named(name), PNL), name).toBeUndefined()
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

describe('the two presets that collide with the colourblind-safe palette', () => {
  /**
   * A known defect, asserted rather than hidden.
   *
   * The previous version of the test above swept it under a `if (colour.value === pnl)
   * continue` — skipping exactly the worst case, an *identical* colour, so it passed
   * while claiming the palette "avoids impersonating the P&L up/down colours". It
   * doesn't: `Sky` is byte-identical to `blue-orange`'s up colour and `Orange` to its
   * down colour, and that palette is the one a colourblind player selects, so it is the
   * setting where mistaking a line for a bar matters most.
   *
   * Left in the palette for now and *reported* by `describeColourRisk`. Fixing it means
   * changing two shipped colours, which is a product decision rather than a test fix.
   */
  const BLUE_ORANGE = { up: 0x4da3ff, down: 0xff9d4d }

  it('is exactly two, and they are Sky and Orange', () => {
    const colliding = INDICATOR_COLOURS.filter(
      (colour) => colour.value === BLUE_ORANGE.up || colour.value === BLUE_ORANGE.down
    ).map((colour) => colour.name)
    expect(colliding).toEqual(['Sky', 'Orange'])
  })

  it('is warned about, so the player is told rather than stopped', () => {
    for (const colour of INDICATOR_COLOURS) {
      const risk = describeColourRisk(colour.value, BLUE_ORANGE)
      if (colour.name === 'Sky' || colour.name === 'Orange') expect(risk).toMatch(/profit|loss/)
      else expect(risk, colour.name).toBeUndefined()
    }
  })

  it('leaves every preset clear under the default palette', () => {
    // The property the palette was designed for still holds where it was designed.
    for (const colour of INDICATOR_COLOURS) {
      expect(describeColourRisk(colour.value, { up: 0x4ddb7a, down: 0xff6b6b }), colour.name)
        .toBeUndefined()
    }
  })
})

describe('colourToHex and colourFromHex', () => {
  it('round-trip every preset', () => {
    for (const colour of INDICATOR_COLOURS) {
      expect(colourFromHex(colourToHex(colour.value))).toBe(colour.value)
    }
  })

  it('pads short values, which a native colour input requires', () => {
    // `#0f0f0f`, not `#f0f0f`. An unpadded string silently fails to set the input.
    expect(colourToHex(0x000000)).toBe('#000000')
    expect(colourToHex(0x0000ff)).toBe('#0000ff')
    expect(colourToHex(0xffffff)).toBe('#ffffff')
  })

  it('clamps a value outside 24 bits rather than emitting a 7-digit hex', () => {
    expect(colourToHex(0x1000000)).toBe('#ffffff')
    expect(colourToHex(-5)).toBe('#000000')
  })

  it('reads a hex with or without the hash, in either case', () => {
    expect(colourFromHex('#FFD166')).toBe(0xffd166)
    expect(colourFromHex('ffd166')).toBe(0xffd166)
    expect(colourFromHex('  #ffd166  ')).toBe(0xffd166)
  })

  it('refuses anything that is not a full six-digit colour', () => {
    // `undefined` so the caller keeps the previous value — a half-typed `#ff` must not
    // become black.
    for (const bad of ['', '#', '#fff', '#ffd16', '#ffd1666', 'red', '#gggggg', '0xffd166']) {
      expect(colourFromHex(bad), bad).toBeUndefined()
    }
  })
})

describe('describeColourRisk', () => {
  const PNL = { up: 0x4ddb7a, down: 0xff6b6b }

  it('flags a colour too dark to see', () => {
    expect(describeColourRisk(0x101418, PNL)).toMatch(/dark/i)
    expect(describeColourRisk(0x000000, PNL)).toMatch(/dark/i)
  })

  it('reports darkness before impersonation, since an invisible line has no colour', () => {
    // A near-black red is both dark and reddish. "You can't see it" is the more useful
    // sentence of the two.
    expect(describeColourRisk(0x1a0505, PNL)).toMatch(/dark/i)
  })

  it('passes a bright colour clear of both P&L hues', () => {
    expect(describeColourRisk(0xd2a8ff, PNL)).toBeUndefined()
  })

  it('measures against the palette it is given, not a fixed one', () => {
    // The whole reason the pair is a parameter: a warning against the wrong pair would
    // be worse than none, and `shared/` may not read the player's setting itself.
    expect(describeColourRisk(0x4da3ff, PNL)).toBeUndefined()
    expect(describeColourRisk(0x4da3ff, { up: 0x4da3ff, down: 0xff9d4d })).toMatch(/profit/)
  })
})
