import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { DEFAULT_INDICATOR_COLOUR } from '@shared/palette/index.js'
import { createRunController } from './runController.js'

/**
 * Frame assembly, and specifically the volume pane — the one pane whose points
 * correspond one-for-one with price bars, and therefore the one that can be coloured
 * like the candles above it.
 */

const bar = (o: number, c: number, volume = 1_000): OhlcvBar => ({
  o,
  h: Math.max(o, c) + 1,
  l: Math.min(o, c) - 1,
  c,
  v: volume,
  t: 0,
})

const controllerOf = (bars: readonly OhlcvBar[], showVolume = true) =>
  createRunController({
    bars,
    config: defaultConfig(),
    visibleBarCount: 5,
    showVolume,
    maxSubPanes: 3,
  })

/** One bar at the default 2 bars/sec. */
const BAR = 0.5

describe('the volume pane', () => {
  it('reports a direction per point, aligned with the bars', () => {
    // The alignment is what the renderer relies on to colour bar N's volume like bar
    // N's candle: it indexes `directions` by the same offset it uses for x.
    const controller = controllerOf([bar(100, 110), bar(110, 105), bar(105, 105)])
    controller.advance(0)
    controller.advance(BAR)
    controller.advance(BAR)

    const frame = controller.frame
    const pane = frame.subPanes.find((candidate) => candidate.instanceId === 'volume')
    const directions = pane?.series[0]?.directions

    expect(directions).toHaveLength(frame.bars.length)
    expect(directions).toEqual(frame.bars.map((visible) => visible.direction))
    expect(directions).toEqual(['up', 'down', 'flat'])
  })

  it('keeps directions the same length as units as the window slides', () => {
    // Two arrays indexed by the same offset: if they ever differ in length, some bar
    // gets another bar's colour, which is worse than no colour at all.
    const bars = [bar(1, 2), bar(2, 1), bar(1, 3), bar(3, 2), bar(2, 4), bar(4, 3), bar(3, 5)]
    const controller = controllerOf(bars)
    for (let i = 0; i < bars.length; i++) {
      controller.advance(BAR)
      const series = controller.frame.subPanes.find((p) => p.instanceId === 'volume')?.series[0]
      expect(series?.directions).toHaveLength(series?.units.length ?? -1)
    }
  })

  it('still carries a fallback series colour', () => {
    // `directions` wins, but the field has to be a real colour: a series whose points
    // report no direction falls back to it rather than drawing nothing.
    const controller = controllerOf([bar(100, 110)])
    controller.advance(0)
    const series = controller.frame.subPanes.find((p) => p.instanceId === 'volume')?.series[0]
    expect(series?.colour).toBe(DEFAULT_INDICATOR_COLOUR)
  })

  it('is a histogram, which is what selects the per-bar colouring path', () => {
    const controller = controllerOf([bar(100, 110)])
    controller.advance(0)
    expect(controller.frame.subPanes.find((p) => p.instanceId === 'volume')?.histogram).toBe(true)
  })

  it('is absent when volume is off', () => {
    const controller = controllerOf([bar(100, 110)], false)
    controller.advance(0)
    expect(controller.frame.subPanes).toHaveLength(0)
  })
})

describe('overlay lines', () => {
  it('reports no direction, since a level has none to report', () => {
    // Only price-derived series get per-point directions. A moving average is a level;
    // colouring it by "direction" would be inventing a meaning it doesn't have.
    const controller = controllerOf([bar(100, 110)])
    controller.advance(0)
    expect(controller.frame.overlays).toEqual([])
  })
})
