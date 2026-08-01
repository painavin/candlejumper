import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { createPlayback } from './playback.js'

const series = (closes: readonly number[]): OhlcvBar[] =>
  closes.map((c, i) => ({ o: c, h: c, l: c, c, v: 1, t: 1_700_000_000 + i * 86_400 }))

const playback = (closes: readonly number[], visibleBarCount = 5) =>
  createPlayback({ bars: series(closes), config: defaultConfig(), visibleBarCount })

/** One bar at the default 2 bars/sec. */
const BAR = 0.5

describe('createPlayback', () => {
  it('starts with only the first bar on screen', () => {
    const frame = playback([100, 110, 120, 130]).advance(0)
    expect(frame.bars).toHaveLength(1)
    expect(frame.bars[0]?.index).toBe(0)
  })

  it('never includes a bar the cursor has not reached', () => {
    // The no-lookahead constraint, structurally: an unplayed pole is not in the
    // frame at all, so there is no silhouette to leak and nothing to tune.
    const play = playback([100, 200, 300, 400, 500])
    play.advance(BAR)
    const frame = play.frame
    expect(frame.bars.map((b) => b.index)).toEqual([0, 1])
    expect(frame.bars.some((b) => b.bar.c >= 300)).toBe(false)
  })

  it('carries every OHLC height, not just the close', () => {
    // The renderer draws a floating candle, so it needs four heights on one scale.
    // Doing the conversion here rather than in `render/` is what stops a candle
    // drifting out of alignment with the axis that describes it.
    const bars: OhlcvBar[] = [{ o: 100, h: 130, l: 90, c: 120, v: 1, t: 0 }]
    const play = createPlayback({ bars, config: defaultConfig(), visibleBarCount: 5 })
    const visible = play.advance(0).bars[0]

    expect(visible?.lowUnit).toBeLessThan(visible!.openUnit)
    expect(visible?.openUnit).toBeLessThan(visible!.unit)
    expect(visible?.unit).toBeLessThan(visible!.highUnit)
    // And all four are on the chart rather than clamped against its edges.
    expect(visible?.lowUnit).toBeGreaterThan(0)
    expect(visible?.highUnit).toBeLessThan(1)
  })

  it('grows only the newest bar', () => {
    const play = playback([100, 110, 120])
    play.advance(BAR)
    const frame = play.advance(0.05)
    const newest = frame.bars.find((b) => b.age === 0)
    const older = frame.bars.filter((b) => b.age > 0)
    expect(newest!.growth).toBeLessThan(1)
    expect(older.every((b) => b.growth === 1)).toBe(true)
  })

  it('caps the window at the resolved visible bar count', () => {
    const play = playback([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => n * 100), 3)
    for (let i = 0; i < 6; i++) play.advance(BAR)
    expect(play.frame.bars).toHaveLength(3)
  })

  it('drops the oldest bar off the left rather than compressing', () => {
    const play = playback([100, 200, 300, 400, 500], 2)
    play.advance(BAR)
    play.advance(BAR)
    expect(play.frame.bars.map((b) => b.index)).toEqual([1, 2])
  })

  it('notifies once per closed bar, with the bar that closed', () => {
    // Step 2 hangs the tick pipeline here, so "once, in order" is load-bearing.
    const play = playback([100, 110, 120, 130])
    const closed: number[] = []
    play.onBarClosed((_bar, index) => closed.push(index))
    for (let i = 0; i < 3; i++) play.advance(BAR)
    expect(closed).toEqual([0, 1, 2])
  })

  it('does not fire twice for one bar even after a long stall', () => {
    const play = playback([100, 110, 120, 130])
    let fired = 0
    play.onBarClosed(() => fired++)
    play.advance(10)
    expect(fired).toBe(1)
  })

  it('finishes when the data runs out and stays finished', () => {
    const play = playback([100, 110])
    play.advance(BAR)
    play.advance(BAR)
    expect(play.frame.phase).toBe('finished')
    const index = play.frame.currentIndex
    play.advance(BAR * 10)
    expect(play.frame.currentIndex).toBe(index)
  })

  it('reports waiting-for-data for an empty series rather than crashing', () => {
    const frame = playback([]).advance(BAR)
    expect(frame.phase).toBe('waiting-for-data')
    expect(frame.bars).toEqual([])
  })

  describe('a preloaded start', () => {
    const preloaded = (closes: readonly number[], startIndex: number, visibleBarCount = 5) =>
      createPlayback({
        bars: series(closes),
        config: defaultConfig(),
        visibleBarCount,
        startIndex,
      })

    it('opens with the preloaded bars on screen as history', () => {
      // The point of the feature being visible at all: the chart opens looking like a
      // chart, with the indicators already drawn across the bars behind the cursor.
      const frame = preloaded([10, 20, 30, 40, 50, 60], 3).advance(0)
      expect(frame.bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3])
      expect(frame.currentIndex).toBe(3)
      expect(frame.firstIndex).toBe(3)
    })

    it('still never shows a bar past the cursor', () => {
      // The invariant that actually matters is about the *future*. History behind the
      // cursor leaks nothing; a bar ahead of it would leak everything.
      const play = preloaded([10, 20, 30, 40, 50, 60], 3)
      play.advance(0)
      expect(play.frame.bars.every((bar) => bar.index <= 3)).toBe(true)
      play.advance(BAR)
      expect(play.frame.bars.some((bar) => bar.index === 4)).toBe(true)
      expect(play.frame.bars.some((bar) => bar.index === 5)).toBe(false)
    })

    it('drops the oldest preloaded bar once the window is full', () => {
      const play = preloaded([10, 20, 30, 40, 50, 60], 3, 4)
      play.advance(0)
      expect(play.frame.bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3])
      play.advance(BAR)
      expect(play.frame.bars.map((bar) => bar.index)).toEqual([1, 2, 3, 4])
    })

    it('marks which bars were preloaded, so the renderer needn\'t compare indices', () => {
      // Computed once in the engine for the same reason `direction` is: the poles and the
      // volume pane must agree bar for bar, and two consumers deriving it separately are
      // two that can disagree.
      const frame = preloaded([10, 20, 30, 40, 50, 60], 3).advance(0)
      expect(frame.bars.map((bar) => bar.preloaded)).toEqual([true, true, true, false])
    })

    it('marks nothing as preloaded when preload is off', () => {
      const frame = playback([10, 20, 30]).advance(0)
      expect(frame.bars.every((bar) => !bar.preloaded)).toBe(true)
    })

    it('marks the previous close from a preloaded bar, since it is on screen', () => {
      // `previousUnit` is the character's takeoff point. With history drawn, the bar it
      // refers to is one the player can see.
      expect(preloaded([10, 20, 30, 40], 2).advance(0).previousUnit).toBeDefined()
    })

    it('anchors the price scale on the first played bar', () => {
      // A relative mode measured from a preloaded bar would report a return from a price
      // the player never had the chance to trade.
      //
      // Read off the *bounds*, which is where the choice of reference actually shows.
      // With the reference at 100 the window's closes map to themselves (`price / 100 *
      // 100`), so the axis reads 50..101; anchored on the preloaded 50 instead, the same
      // window would read 100..202.
      const config = { ...defaultConfig(), normalizationMode: 'starting-price-relative' as const }
      const play = createPlayback({
        bars: series([50, 60, 100, 101]),
        config,
        visibleBarCount: 5,
        startIndex: 2,
      })
      const frame = play.advance(0)
      expect(frame.bounds.max).toBeGreaterThan(100)
      expect(frame.bounds.max).toBeLessThan(120)
    })

    it('still ends at the last bar of the series', () => {
      const play = preloaded([10, 20, 30, 40], 2)
      play.advance(0)
      play.advance(BAR)
      play.advance(BAR)
      expect(play.frame.phase).toBe('finished')
      expect(play.frame.currentIndex).toBe(3)
    })

    it('clamps a start index past the end rather than emptying the run', () => {
      // Validation refuses this case with a message; the clamp is what stops a caller
      // that skipped validation from producing a run with no bars in it.
      const frame = preloaded([10, 20, 30], 99).advance(0)
      expect(frame.currentIndex).toBe(2)
      expect(frame.firstIndex).toBe(2)
      // Every bar is history in that case, and the run is one bar long — refused by
      // validation with a message; this is only the backstop against a caller that skipped it.
      expect(frame.bars.map((bar) => bar.index)).toEqual([0, 1, 2])
    })
  })

  describe('pause', () => {
    it('advances no bars while paused', () => {
      const play = playback([100, 110, 120, 130])
      play.pause()
      play.advance(BAR * 3)
      expect(play.frame.currentIndex).toBe(0)
      expect(play.frame.phase).toBe('paused')
    })

    it('fires no bar-closed events while paused', () => {
      const play = playback([100, 110, 120])
      let fired = 0
      play.onBarClosed(() => fired++)
      play.pause()
      play.advance(BAR * 3)
      expect(fired).toBe(0)
    })

    it('resumes without having banked the paused time', () => {
      const play = playback([100, 110, 120, 130])
      play.pause()
      play.advance(BAR * 10)
      play.resume()
      expect(play.advance(BAR).currentIndex).toBe(1)
    })
  })

  it('exposes the previous close as a unit, for the hop takeoff', () => {
    const play = playback([100, 200, 300])
    expect(play.frame.previousUnit).toBeUndefined()
    play.advance(BAR)
    expect(play.frame.previousUnit).toBeGreaterThanOrEqual(0)
  })

  it('surfaces dropped bars in the frame rather than swallowing them', () => {
    const play = playback([100, 110, 120, 130])
    play.advance(10)
    expect(play.frame.droppedBars).toBeGreaterThan(0)
  })
})
