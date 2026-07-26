import { describe, expect, it } from 'vitest'
import { pnlColours } from '@content/pnlColours.js'
import { visualThemes } from '@content/visualThemes/index.js'
import { MIN_LUMA_GAP, RANGE_MIX, bodyColour, mixColour, rangeColour } from './candleColour.js'
import type { CandlePalette } from './candleColour.js'

/**
 * The rule under test: a bar's *range* is a desaturated version of its own direction
 * colour, not a shared neutral.
 *
 * A neutral range was fine while the range was a thin wick. At Bollinger width the
 * range is most of the column, so a neutral one meant the majority of every bar
 * carried no information and the coloured part read as a sticker stuck to it.
 */

const paletteFor = (themeIndex: number, pnl = 'red-green'): CandlePalette => ({
  pnl: pnlColours(pnl),
  neutral: (visualThemes[themeIndex] as (typeof visualThemes)[number]).palette.candleRange,
})

/** Rec. 601 luma, for light-vs-dark judgements. */
const luma = (colour: number): number =>
  (0.299 * ((colour >> 16) & 0xff) + 0.587 * ((colour >> 8) & 0xff) + 0.114 * (colour & 0xff)) / 255

/** Max minus min channel — a serviceable stand-in for saturation. */
const chroma = (colour: number): number => {
  const channels = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff]
  return (Math.max(...channels) - Math.min(...channels)) / 255
}

/** Which channel dominates. Enough to say "this is the greenish one". */
const dominant = (colour: number): number => {
  const channels = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff]
  return channels.indexOf(Math.max(...channels))
}

describe('mixColour', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mixColour(0x000000, 0xffffff, 0)).toBe(0x000000)
    expect(mixColour(0x000000, 0xffffff, 1)).toBe(0xffffff)
  })

  it('blends each channel independently', () => {
    expect(mixColour(0x000000, 0xffffff, 0.5)).toBe(0x808080)
    expect(mixColour(0xff0000, 0x0000ff, 0.5)).toBe(0x800080)
  })

  it('clamps rather than producing a colour outside the range', () => {
    // A malformed mix constant should look wrong, not produce channels that wrap.
    expect(mixColour(0x102030, 0xffffff, -1)).toBe(0x102030)
    expect(mixColour(0x102030, 0xffffff, 5)).toBe(0xffffff)
  })

  it('never overflows a channel', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const mixed = mixColour(0xffffff, 0xffffff, t)
      expect(mixed).toBeLessThanOrEqual(0xffffff)
      expect(mixed).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('rangeColour', () => {
  it('keeps the direction hue rather than going neutral', () => {
    // The whole point: the column's hue reports the direction, so a chart is
    // readable at a glance without inspecting where each body sits.
    for (let i = 0; i < visualThemes.length; i++) {
      const palette = paletteFor(i)
      const id = (visualThemes[i] as (typeof visualThemes)[number]).id
      expect(dominant(rangeColour('up', palette)), `${id} up`).toBe(dominant(palette.pnl.up))
      expect(dominant(rangeColour('down', palette)), `${id} down`).toBe(dominant(palette.pnl.down))
    }
  })

  it('is less saturated than the body it belongs to', () => {
    // Otherwise the range competes with the body, and the body is the part you read
    // an actual price off.
    for (let i = 0; i < visualThemes.length; i++) {
      const palette = paletteFor(i)
      const id = (visualThemes[i] as (typeof visualThemes)[number]).id
      for (const direction of ['up', 'down'] as const) {
        expect(
          chroma(rangeColour(direction, palette)),
          `${id} ${direction}`
        ).toBeLessThan(chroma(bodyColour(direction, palette)))
      }
    }
  })

  it('is always dimmer than its body, by a margin, in every theme', () => {
    // Mixing toward the neutral supplies the saturation drop but *not* reliably a
    // lightness drop: `serious`'s neutral is a light steel blue, so its muted red came
    // out within 0.02 luma of the body red. A saturation-only difference is the
    // weakest cue available and the first thing lost to a colour-vision difference.
    for (let i = 0; i < visualThemes.length; i++) {
      const palette = paletteFor(i)
      const id = (visualThemes[i] as (typeof visualThemes)[number]).id
      for (const direction of ['up', 'down'] as const) {
        const range = luma(rangeColour(direction, palette))
        const body = luma(bodyColour(direction, palette))
        expect(range, `${id} ${direction} range is not dimmer`).toBeLessThan(body)
        expect(body - range, `${id} ${direction} gap too small`).toBeGreaterThanOrEqual(
          MIN_LUMA_GAP - 0.005
        )
      }
    }
  })

  it('dims in the same direction whatever the theme', () => {
    // Never lighter in one mood and darker in another: the rule has to read the same
    // everywhere, rather than flipping depending on which side of the body colour a
    // mood's neutral happens to land.
    for (let i = 0; i < visualThemes.length; i++) {
      for (const pnl of ['red-green', 'blue-orange']) {
        const palette = paletteFor(i, pnl)
        for (const direction of ['up', 'down'] as const) {
          expect(luma(rangeColour(direction, palette))).toBeLessThan(
            luma(bodyColour(direction, palette))
          )
        }
      }
    }
  })

  it('tells up from down, in every theme and every palette', () => {
    // A range that came out the same colour either way would be a neutral with extra
    // steps.
    for (let i = 0; i < visualThemes.length; i++) {
      for (const pnl of ['red-green', 'blue-orange']) {
        const palette = paletteFor(i, pnl)
        expect(rangeColour('up', palette)).not.toBe(rangeColour('down', palette))
      }
    }
  })

  it('leaves a directionless bar neutral', () => {
    // A doji has nothing to report, so it gets the theme's own colour rather than an
    // arbitrary one of the two directions.
    const palette = paletteFor(0)
    expect(rangeColour('flat', palette)).toBe(palette.neutral)
    expect(bodyColour('flat', palette)).toBe(palette.neutral)
  })

  it('moves toward the theme neutral, so a mood keeps control of its bars', () => {
    // Each mood's bars stay dark or light to suit its sky, without the hue changing.
    const dark = paletteFor(0)
    const light = paletteFor(1)
    const darker = luma(dark.neutral) < luma(light.neutral) ? dark : light
    const lighter = darker === dark ? light : dark
    expect(luma(rangeColour('up', darker))).toBeLessThan(luma(rangeColour('up', lighter)))
  })
})

describe('RANGE_MIX', () => {
  it('stays inside the band where the tint survives and the body still wins', () => {
    // Below ~0.4 the range and body are hard to tell apart; above ~0.8 the hue is
    // gone and this is a neutral again. Asserted so a future tweak has to be a
    // deliberate one.
    expect(RANGE_MIX).toBeGreaterThan(0.4)
    expect(RANGE_MIX).toBeLessThan(0.8)
  })
})
