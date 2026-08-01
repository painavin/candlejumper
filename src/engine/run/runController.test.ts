import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { DEFAULT_INDICATOR_COLOUR } from '@shared/palette/index.js'
import type { IndicatorFeed, IndicatorSeries } from '../indicators/feed.js'
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

const controllerOf = (bars: readonly OhlcvBar[], showVolume = true, indicators?: IndicatorFeed) =>
  createRunController({
    bars,
    config: defaultConfig(),
    visibleBarCount: 5,
    showVolume,
    maxSubPanes: 3,
    indicators,
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

  /**
   * A feed with one two-output instance: one continuous level and one sparse mark.
   *
   * Hand-written rather than driven through the plugin host, because what's under test
   * is the *resolution* of a plugin's style against the player's colour, and a fake
   * makes the two inputs explicit.
   */
  const styledFeed = (styles: IndicatorSeries['styles']): IndicatorFeed => {
    const series: IndicatorSeries = {
      instanceId: 'i1',
      displayName: 'FAKE 3',
      colour: 0x112233,
      paneKind: 'overlay',
      outputs: ['level', 'mark'],
      styles,
      history: { level: [], mark: [] },
    }
    return {
      observeBar(candle) {
        series.history.level?.push(candle.c)
        series.history.mark?.push(Number.NaN)
      },
      reset() {},
      series: [series],
    }
  }

  it('draws every output as a line, in the instance colour, when the plugin says nothing', () => {
    const controller = controllerOf([bar(100, 110)], false, styledFeed(undefined))
    controller.advance(0)
    for (const line of controller.frame.overlays) {
      expect(line.draw).toBe('line')
      expect(line.colour).toBe(0x112233)
    }
  })

  it('takes the draw mode and colour a plugin declares, per output', () => {
    const controller = controllerOf(
      [bar(100, 110)],
      false,
      styledFeed({ mark: { draw: 'dots', colour: 0x4fd6c8 } })
    )
    controller.advance(0)
    const lines = controller.frame.overlays
    const level = lines.find((line) => line.output === 'level')
    const mark = lines.find((line) => line.output === 'mark')

    expect(mark?.draw).toBe('dots')
    expect(mark?.colour).toBe(0x4fd6c8)
    // The output the plugin left alone keeps the player's colour, which is what stops
    // the picker becoming decoration on a multi-output indicator.
    expect(level?.draw).toBe('line')
    expect(level?.colour).toBe(0x112233)
  })

  it('applies the same resolution inside a pane', () => {
    // One place resolves it, so an overlay and a pane cannot disagree about how the
    // same output is drawn.
    const feed = styledFeed({ mark: { draw: 'dots', colour: 0x4fd6c8 } })
    feed.series[0]!.paneKind = 'oscillator'
    const controller = controllerOf([bar(100, 110)], false, feed)
    controller.advance(0)
    const pane = controller.frame.subPanes.find((candidate) => candidate.instanceId === 'i1')
    expect(pane?.series.find((entry) => entry.output === 'mark')?.draw).toBe('dots')
    expect(pane?.series.find((entry) => entry.output === 'level')?.draw).toBe('line')
  })

  it('drops an output the player set to none, including from the legend', () => {
    // Not drawn as an invisible line: it would still occupy a legend row, which is the
    // one place the player looks to find out what is on the chart.
    const controller = controllerOf([bar(100, 110)], false, styledFeed({ level: { draw: 'none' } }))
    controller.advance(0)
    expect(controller.frame.overlays.map((line) => line.output)).toEqual(['mark'])
  })

  it('keeps a hidden output out of a pane\'s own scale', () => {
    // An invisible outlier stretching the pane would squash everything else into a
    // band, which is worse than drawing it.
    const feed = styledFeed({ level: { draw: 'none' } })
    feed.series[0]!.paneKind = 'oscillator'
    // `level` tracks the close at 110; `mark` is all NaN, so with `level` dropped there
    // is nothing finite left and the pane falls back to its 0–1 default.
    const controller = controllerOf([bar(100, 110)], false, feed)
    controller.advance(0)
    const pane = controller.frame.subPanes.find((candidate) => candidate.instanceId === 'i1')
    expect(pane?.series.map((entry) => entry.output)).toEqual(['mark'])
    expect(pane?.max).toBe(1)
  })

  it('carries a plugin\'s pixel offset through to the renderer', () => {
    const controller = controllerOf(
      [bar(100, 110)],
      false,
      styledFeed({ mark: { draw: 'dots', offsetPx: 10 } })
    )
    controller.advance(0)
    expect(controller.frame.overlays.find((line) => line.output === 'mark')?.offsetPx).toBe(10)
  })
})
