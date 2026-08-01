import { describe, expect, it } from 'vitest'
import { createRunClock } from './runClock.js'

const clock = (scrollSpeed = 2, growthFraction = 0.25) =>
  createRunClock({ scrollSpeed, growthFraction })

describe('createRunClock', () => {
  it('derives bar duration from bars per second', () => {
    expect(clock(2).barDuration).toBe(0.5)
    expect(clock(10).barDuration).toBeCloseTo(0.1, 9)
  })

  it('completes a bar exactly once per bar duration', () => {
    const c = clock(2)
    let completed = 0
    // 60 frames at 1/60s = 1 second = 2 bars at 2 bars/sec.
    for (let i = 0; i < 60; i++) completed += c.advance(1 / 60)
    expect(completed).toBe(2)
  })

  it('runs at the same speed regardless of frame rate', () => {
    const barsIn = (fps: number): number => {
      const c = clock(2)
      let completed = 0
      for (let i = 0; i < fps * 3; i++) completed += c.advance(1 / fps)
      return completed
    }
    expect(barsIn(60)).toBe(6)
    expect(barsIn(120)).toBe(6)
    expect(barsIn(30)).toBe(6)
  })

  it('reports phase progressing through the bar', () => {
    const c = clock(2)
    c.advance(0.25)
    expect(c.phase).toBeCloseTo(0.5, 6)
  })

  describe('stall rules', () => {
    it('advances exactly one bar for a ten-bar frame gap, not ten', () => {
      // The whole reason this file exists. Resolving all ten would apply buffered
      // presses to bars they were never aimed at — P&L that is subtly wrong after
      // a tab switch, invisible by playing.
      const c = clock(2)
      expect(c.advance(5)).toBe(1)
    })

    it('never returns more than one bar per frame, however long the frame', () => {
      const c = clock(10)
      for (const dt of [1, 10, 100, 3600]) {
        expect(c.advance(dt)).toBeLessThanOrEqual(1)
      }
    })

    it('reports the bars it dropped rather than hiding the gap', () => {
      const c = clock(2)
      c.advance(5) // 10 bars' worth of time
      expect(c.droppedBars).toBeGreaterThan(0)
    })

    it('does not drop anything during normal frame jitter', () => {
      const c = clock(2)
      for (const dt of [1 / 60, 1 / 55, 1 / 61, 1 / 30]) c.advance(dt)
      expect(c.droppedBars).toBe(0)
    })

    it('ignores a non-positive or non-finite delta', () => {
      const c = clock(2)
      expect(c.advance(0)).toBe(0)
      expect(c.advance(-1)).toBe(0)
      expect(c.advance(Number.NaN)).toBe(0)
      expect(c.phase).toBe(0)
    })
  })

  describe('growth', () => {
    it('reaches full height a quarter of the way through the bar', () => {
      const c = clock(2, 0.25) // bar is 0.5s, so growth completes at 0.125s
      c.advance(0.0625)
      expect(c.growth).toBeCloseTo(0.5, 6)
      c.advance(0.0625)
      expect(c.growth).toBeCloseTo(1, 6)
    })

    it('stays at full height for the rest of the bar', () => {
      const c = clock(2, 0.25)
      c.advance(0.4)
      expect(c.growth).toBe(1)
    })

    it('treats a zero growth fraction as instant rather than dividing by zero', () => {
      const c = clock(2, 0)
      expect(c.growth).toBe(1)
    })
  })

  it('resets its accumulator and its dropped count', () => {
    const c = clock(2)
    c.advance(5)
    c.reset()
    expect(c.phase).toBe(0)
    expect(c.droppedBars).toBe(0)
  })

  describe('retiming mid-run', () => {
    it('retimes the bars that follow', () => {
      const c = clock(2)
      c.setScrollSpeed(4)
      expect(c.scrollSpeed).toBe(4)
      expect(c.barDuration).toBeCloseTo(0.25, 9)
    })

    it('preserves the phase, so the bar in progress does not jump', () => {
      // The property that matters: the growing bar and the character's hop are both driven
      // by phase, so a bar 60% formed has to stay 60% formed. Keeping the *accumulator*
      // instead would make the same elapsed seconds mean a different fraction of a bar.
      const c = clock(2)
      c.advance(0.3)
      expect(c.phase).toBeCloseTo(0.6, 6)
      c.setScrollSpeed(8)
      expect(c.phase).toBeCloseTo(0.6, 6)
    })

    it('does not resolve a bar just because the speed went up', () => {
      // With the accumulator kept as-is, 0.3s at 8 bars/sec is past two whole bars, so
      // speeding up mid-bar would complete one instantly and apply buffered presses to it.
      const c = clock(2)
      c.advance(0.3)
      c.setScrollSpeed(8)
      expect(c.advance(0.001)).toBe(0)
    })

    it('completes the next bar on the new timing, not the old', () => {
      const c = clock(2)
      c.setScrollSpeed(4)
      let completed = 0
      for (let i = 0; i < 60; i++) completed += c.advance(1 / 60)
      expect(completed).toBe(4)
    })

    it('keeps the epsilon proportional, so a slow speed still lands on time', () => {
      // The tolerance is a fraction of a bar; left at the old bar's size it would be
      // meaningless after a large change. 30 frames at 1/60 is exactly one bar at 2/sec.
      const c = clock(10)
      c.setScrollSpeed(2)
      let completed = 0
      for (let i = 0; i < 30; i++) completed += c.advance(1 / 60)
      expect(completed).toBe(1)
    })

    it('ignores a speed that is not a usable number', () => {
      // The only caller steps through `SPEED_STEPS`, which is already the clamp, so
      // anything else is a bug — and quietly rounding it would hide the bug.
      const c = clock(2)
      for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
        c.setScrollSpeed(bad)
        expect(c.scrollSpeed).toBe(2)
      }
    })
  })
})
