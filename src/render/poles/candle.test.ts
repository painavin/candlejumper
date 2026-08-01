import { describe, expect, it } from 'vitest'
import type { VisibleBar } from '@engine/output/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { computeLayout } from '../stage/layout.js'
import { candleCentreX, candleShapeAt, isOnScreen, wickWidthFor } from './candle.js'

/**
 * `poleLayer.ts` can't be tested — it needs a WebGL context — so the geometry it
 * draws lives in `candle.ts` where it can be. The enclosure property below is the
 * one that would produce visible nonsense if it broke: a body poking out past its
 * own high or low.
 */

const layout = computeLayout(1200, 700, 40, 0)

/**
 * Units are what the renderer actually consumes, so the fixtures are written in
 * unit space and carry whatever raw prices the direction test needs.
 */
function visible(units: {
  open: number
  high: number
  low: number
  close: number
  growth?: number
  age?: number
  prices?: [number, number]
}): VisibleBar {
  const [o, c] = units.prices ?? [units.open, units.close]
  const bar: OhlcvBar = { o, h: units.high, l: units.low, c, v: 1, t: 0 }
  return {
    bar,
    index: 0,
    age: units.age ?? 0,
    unit: units.close,
    openUnit: units.open,
    highUnit: units.high,
    lowUnit: units.low,
    // Mirrors what playback derives, so the fixture can't disagree with the engine.
    direction: c > o ? 'up' : c < o ? 'down' : 'flat',
    preloaded: false,
    growth: units.growth ?? 1,
  }
}

const shapeOf = (bar: VisibleBar, wick = 0.16) => candleShapeAt(bar, layout, wick, 600)

describe('candleShapeAt', () => {
  it('floats the body between the open and the close, off the ground', () => {
    const shape = shapeOf(visible({ open: 0.4, high: 0.8, low: 0.3, close: 0.7 }))
    // Nothing touches the ground any more: that's the whole change.
    expect(shape.body.y + shape.body.height).toBeLessThan(layout.groundY)
    expect(shape.range.y + shape.range.height).toBeLessThan(layout.groundY)
  })

  it('puts the body between the open and close heights, whichever way round they are', () => {
    const up = shapeOf(visible({ open: 0.4, high: 0.9, low: 0.3, close: 0.7 }))
    const down = shapeOf(visible({ open: 0.7, high: 0.9, low: 0.3, close: 0.4 }))
    // Same two prices, so the same rectangle — only the colour differs, which is
    // the renderer's business rather than the geometry's.
    expect(up.body.y).toBeCloseTo(down.body.y, 6)
    expect(up.body.height).toBeCloseTo(down.body.height, 6)
  })

  it('maps a higher price to a smaller y, since the screen counts downward', () => {
    const high = shapeOf(visible({ open: 0.8, high: 0.9, low: 0.75, close: 0.85 }))
    const low = shapeOf(visible({ open: 0.2, high: 0.3, low: 0.1, close: 0.25 }))
    expect(high.body.y).toBeLessThan(low.body.y)
  })

  it('encloses the body within the range', () => {
    const shape = shapeOf(visible({ open: 0.4, high: 0.95, low: 0.05, close: 0.6 }))
    expect(shape.range.y).toBeLessThanOrEqual(shape.body.y)
    expect(shape.range.y + shape.range.height).toBeGreaterThanOrEqual(
      shape.body.y + shape.body.height
    )
  })

  it('keeps the body inside the range at every point of the growth animation', () => {
    // The property that makes "grow from the open" safe rather than lucky: close,
    // high, and low are all interpolated from the open by the *same* factor, so the
    // price ordering survives into every intermediate frame. Interpolating them
    // independently, or animating the body but not the range, breaks this and the
    // body visibly pokes out of its own wick partway through the bar.
    for (let step = 0; step <= 20; step++) {
      const growth = step / 20
      const shape = shapeOf(visible({ open: 0.4, high: 0.95, low: 0.05, close: 0.9, growth }))
      expect(shape.range.y, `growth ${growth}`).toBeLessThanOrEqual(shape.body.y)
      expect(shape.range.y + shape.range.height, `growth ${growth}`).toBeGreaterThanOrEqual(
        shape.body.y + shape.body.height
      )
    }
  })

  it('keeps the body enclosed even when both spans are sub-pixel', () => {
    // The case that broke it: body and range both shorter than the minimum height
    // come out the same height but centred a fraction apart, so the body sits a
    // sliver outside its own low. Invisible, but it's the invariant everything else
    // here assumes, so it holds by construction rather than by luck.
    const shape = shapeOf(visible({ open: 0.5, high: 0.5002, low: 0.5, close: 0.5001 }))
    expect(shape.range.y).toBeLessThanOrEqual(shape.body.y)
    expect(shape.range.y + shape.range.height).toBeGreaterThanOrEqual(
      shape.body.y + shape.body.height
    )
  })

  it('starts the forming bar as a flat mark at its open and extends from there', () => {
    const bar = { open: 0.4, high: 0.95, low: 0.05, close: 0.9 }
    const start = shapeOf(visible({ ...bar, growth: 0 }))
    const middle = shapeOf(visible({ ...bar, growth: 0.5 }))
    const done = shapeOf(visible({ ...bar, growth: 1 }))

    // At growth 0 the bar has no extent yet beyond the minimum-height floor.
    expect(start.range.height).toBeLessThan(3)
    expect(middle.range.height).toBeGreaterThan(start.range.height)
    expect(done.range.height).toBeGreaterThan(middle.range.height)

    // And it grows away from the open, which stays put throughout — that's what
    // makes it read as a bar forming rather than a bar sliding.
    const openY = start.body.y + start.body.height / 2
    expect(middle.body.y + middle.body.height).toBeCloseTo(openY, 0)
    expect(done.body.y + done.body.height).toBeCloseTo(openY, 0)
  })

  it('reports forming only for a bar below full growth', () => {
    expect(shapeOf(visible({ open: 0.4, high: 0.5, low: 0.3, close: 0.45 })).forming).toBe(false)
    expect(
      shapeOf(visible({ open: 0.4, high: 0.5, low: 0.3, close: 0.45, growth: 0.5 })).forming
    ).toBe(true)
  })

  it('gives a doji a visible body instead of nothing', () => {
    // Zero height is indistinguishable from missing data, and "opened and closed at
    // the same price" is information the player needs.
    const shape = shapeOf(visible({ open: 0.5, high: 0.7, low: 0.3, close: 0.5 }))
    expect(shape.body.height).toBeGreaterThanOrEqual(2)
    // Still centred on the price it printed, rather than nudged off it.
    const priceY = shape.body.y + shape.body.height / 2
    const rangeMiddle = shape.range.y + shape.range.height / 2
    expect(priceY).toBeCloseTo(rangeMiddle, 6)
  })

  it('takes direction from the prices, not the units', () => {
    // At the edge of the chart `unit()` clamps, so a rising bar whose open and close
    // both sit above the bounds compares equal in unit space. Reading the raw prices
    // is what stops it being miscoloured as unchanged.
    const clamped = visible({ open: 1, high: 1, low: 1, close: 1, prices: [100, 110] })
    expect(shapeOf(clamped).direction).toBe('up')

    expect(shapeOf(visible({ open: 0.3, high: 0.8, low: 0.2, close: 0.7 })).direction).toBe('up')
    expect(shapeOf(visible({ open: 0.7, high: 0.8, low: 0.2, close: 0.3 })).direction).toBe('down')
    expect(shapeOf(visible({ open: 0.5, high: 0.8, low: 0.2, close: 0.5 })).direction).toBe('flat')
  })
})

describe('wick width', () => {
  const bar = visible({ open: 0.4, high: 0.9, low: 0.1, close: 0.6 })

  it('draws a candlestick when the range is narrower than the body', () => {
    const shape = shapeOf(bar, 0.16)
    expect(shape.range.width).toBeLessThan(shape.body.width)
  })

  it('draws a Bollinger bar when the range matches the body', () => {
    // The entire difference between the two chart types, and the reason there is one
    // drawing routine rather than two.
    const shape = shapeOf(bar, 1)
    expect(shape.range.width).toBeCloseTo(shape.body.width, 6)
  })

  it('never lets the range exceed the body, however the theme is configured', () => {
    // A range wider than the body reads as a second, conflicting bar.
    const shape = shapeOf(bar, 4)
    expect(shape.range.width).toBeLessThanOrEqual(shape.body.width)
  })

  it('keeps a hairline range even at a fraction of zero', () => {
    expect(shapeOf(bar, 0).range.width).toBeGreaterThanOrEqual(1)
  })

  it('keeps both rectangles concentric at every width', () => {
    for (const fraction of [0, 0.16, 0.5, 1]) {
      const shape = shapeOf(bar, fraction)
      expect(shape.range.x + shape.range.width / 2).toBeCloseTo(
        shape.body.x + shape.body.width / 2,
        6
      )
    }
  })
})

describe('wickWidthFor', () => {
  it('draws Bollinger bars at the body width, which is what makes them uniform', () => {
    expect(wickWidthFor('bollinger')).toBe(1)
  })

  it('draws a candlestick narrower than its body, but still visible', () => {
    expect(wickWidthFor('candlestick')).toBeLessThan(1)
    expect(wickWidthFor('candlestick')).toBeGreaterThan(0)
  })

  it('resolves to a width that actually produces the intended chart', () => {
    // Ties the setting to the geometry rather than trusting the constants: choosing
    // Bollinger must genuinely equalise the two widths.
    const bar = visible({ open: 0.4, high: 0.9, low: 0.1, close: 0.6 })
    const bollinger = shapeOf(bar, wickWidthFor('bollinger'))
    expect(bollinger.range.width).toBeCloseTo(bollinger.body.width, 6)

    const candlestick = shapeOf(bar, wickWidthFor('candlestick'))
    expect(candlestick.range.width).toBeLessThan(candlestick.body.width)
  })

  it('depends on nothing but the setting, so a mood cannot change the chart type', () => {
    // The visual theme used to carry its own `wickWidthFraction`, read when the setting
    // was `theme`. Both moods chose the same value, so the indirection only ever
    // produced the default — and this is the property that replaced it.
    expect(wickWidthFor.length).toBe(1)
  })
})

describe('candleCentreX', () => {
  it('puts the newest bar under the character', () => {
    expect(candleCentreX(0, 0, layout)).toBeCloseTo(layout.characterX, 6)
  })

  it('slides a bar left by exactly one slot per unit of age', () => {
    expect(candleCentreX(1, 0, layout)).toBeCloseTo(layout.characterX - layout.barWidth, 6)
  })

  it('hands the next bar the slot this one started in', () => {
    // Sub-bar scroll: at the end of a bar's life, age 0 sits where age 1 began.
    expect(candleCentreX(0, 1, layout)).toBeCloseTo(candleCentreX(1, 0, layout), 6)
  })
})

describe('isOnScreen', () => {
  it('drops a bar once it has fully left the left edge', () => {
    const offLeft = candleShapeAt(
      visible({ open: 0.4, high: 0.5, low: 0.3, close: 0.45 }),
      layout,
      0.16,
      -layout.poleWidth
    )
    expect(isOnScreen(offLeft)).toBe(false)
    expect(isOnScreen(shapeOf(visible({ open: 0.4, high: 0.5, low: 0.3, close: 0.45 })))).toBe(true)
  })
})
