import type { RunConfig } from '@config/index.js'
import { LAYOUT } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import type { ChartFrame, RunPhase, VisibleBar } from '../output/frameState.js'
import { createNormalizer } from '../normalization/normalizer.js'
import type { Normalizer } from '../normalization/normalizer.js'
import { createRunClock } from './runClock.js'
import type { RunClock } from './runClock.js'

/**
 * The playback cursor: which bars have been played, and what the current frame
 * looks like.
 *
 * The load-bearing rule is that **a pole only exists once it reaches the
 * character**. Unplayed bars are never in `ChartFrame.bars` at all, which makes
 * the no-lookahead constraint structural rather than dependent on fog opacity —
 * there is nothing to leak, so nothing to verify visually or to regress by
 * tweaking a gradient. See docs/game-design.md#pole-generation--scroll.
 */

export interface Playback {
  /** Advance by elapsed wall-clock seconds and return this frame's snapshot. */
  advance(dt: number): ChartFrame
  /** Price → 0..1 chart height, so stop levels can be drawn on the same scale. */
  unitOf(price: number): number
  /** The current snapshot without advancing — for paused frames. */
  readonly frame: ChartFrame
  /** Fires once per completed bar, after the cursor moves. Step 2 hangs the tick pipeline here. */
  onBarClosed(listener: (bar: OhlcvBar, index: number) => void): void
  pause(): void
  resume(): void
  readonly isPaused: boolean
}

export interface PlaybackOptions {
  bars: readonly OhlcvBar[]
  config: RunConfig
  /** Resolved once at run start from orientation, then frozen. */
  visibleBarCount: number
}

export function createPlayback({ bars, config, visibleBarCount }: PlaybackOptions): Playback {
  const clock: RunClock = createRunClock({
    scrollSpeed: config.scrollSpeed,
    growthFraction: LAYOUT.barGrowthFraction,
  })
  const normalizer: Normalizer = createNormalizer(config)
  normalizer.reset(bars[0])

  const listeners: ((bar: OhlcvBar, index: number) => void)[] = []
  /** Index of the bar currently under the character. Starts on the first bar. */
  let cursor = 0
  let paused = false
  let phase: RunPhase = bars.length === 0 ? 'waiting-for-data' : 'playing'
  let snapshot: ChartFrame = buildFrame(0)

  function playedWindow(index: number): OhlcvBar[] {
    const from = Math.max(0, index - visibleBarCount + 1)
    return bars.slice(from, index + 1)
  }

  function buildFrame(dt: number): ChartFrame {
    const window = playedWindow(cursor)
    const bounds = normalizer.update(window, dt)

    const growth = clock.growth
    const visible: VisibleBar[] = window.map((bar, offset) => {
      const index = cursor - (window.length - 1 - offset)
      const age = cursor - index
      return {
        bar,
        index,
        age,
        unit: normalizer.unit(bar.c),
        // Only the newest bar is still forming.
        growth: age === 0 ? growth : 1,
      }
    })

    const previous = bars[cursor - 1]

    return {
      phase,
      bars: visible,
      bounds,
      barPhase: clock.phase,
      currentBar: bars[cursor],
      currentIndex: cursor,
      totalBars: bars.length,
      previousUnit: previous ? normalizer.unit(previous.c) : undefined,
      droppedBars: clock.droppedBars,
    }
  }

  return {
    advance(dt) {
      if (phase === 'waiting-for-data') {
        snapshot = buildFrame(dt)
        return snapshot
      }
      if (paused || phase === 'finished') {
        // Still rebuild so easing settles and a resize repaints correctly, but
        // don't advance the clock: pause freezes the pipeline entirely.
        snapshot = buildFrame(0)
        return snapshot
      }

      const completed = clock.advance(dt)
      if (completed > 0) {
        const closed = bars[cursor]
        if (closed) for (const listener of listeners) listener(closed, cursor)

        if (cursor + 1 >= bars.length) {
          // Data exhausted. Step 5 turns this into the Results screen; step 3
          // force-closes any open position at this bar's close.
          phase = 'finished'
        } else {
          cursor += 1
        }
      }

      snapshot = buildFrame(dt)
      return snapshot
    },

    get frame() {
      return snapshot
    },

    unitOf: (price) => normalizer.unit(price),

    onBarClosed(listener) {
      listeners.push(listener)
    },

    pause() {
      paused = true
      if (phase === 'playing') phase = 'paused'
    },

    resume() {
      paused = false
      if (phase === 'paused') phase = 'playing'
    },

    get isPaused() {
      return paused
    },
  }
}
