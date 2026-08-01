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
 * The load-bearing rule is that **no bar after the cursor is ever in a frame**. That
 * makes the no-lookahead constraint structural rather than dependent on an opacity
 * gradient — there is nothing to leak, so nothing to verify visually and nothing
 * to regress. See docs/game-design.md#pole-generation--scroll.
 *
 * Bars *before* the cursor may include preloaded ones the player never traded, when
 * `startIndex` is non-zero. They are history, so drawing them leaks nothing — and it is
 * what lets a warm indicator actually be seen at the start of a run.
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
  /**
   * The first bar the player plays. Everything before it was consumed to warm
   * indicators — see `RunConfig.preloadBars`.
   *
   * Those bars **do** appear on the chart, to the left of the cursor. That's what makes
   * the feature visible: the run opens on a full window of history with the indicators
   * already drawn across it, rather than on one bar and a line that grows in over the
   * following minute. It falls out of the window being derived from the cursor, so it
   * costs nothing.
   *
   * It does not weaken the no-lookahead rule, which is about the *future*: nothing after
   * the cursor is ever in a frame. What is on screen at the start is history the player
   * didn't trade, which is what a chart looks like when you start watching one.
   */
  startIndex?: number
}

export function createPlayback({
  bars,
  config,
  visibleBarCount,
  startIndex = 0,
}: PlaybackOptions): Playback {
  const clock: RunClock = createRunClock({
    scrollSpeed: config.scrollSpeed,
    growthFraction: LAYOUT.barGrowthFraction,
  })
  /**
   * Clamped, so a start index past the end can't produce a run with no bars in it.
   * Pre-run validation refuses that case with a message naming both numbers; this is the
   * backstop for a caller that skipped it.
   */
  const first = Math.min(Math.max(0, Math.floor(startIndex)), Math.max(0, bars.length - 1))
  const normalizer: Normalizer = createNormalizer(config)
  // Anchored on the first *played* bar, not the first loaded one: a relative mode
  // measured from a preloaded bar would report a return the player never had a chance
  // to trade.
  normalizer.reset(bars[first])

  const listeners: ((bar: OhlcvBar, index: number) => void)[] = []
  /** Index of the bar currently under the character. Starts on the first played bar. */
  let cursor = first
  let paused = false
  let phase: RunPhase = bars.length === 0 ? 'waiting-for-data' : 'playing'
  let snapshot: ChartFrame = buildFrame(0)

  function visibleWindow(index: number): OhlcvBar[] {
    // Reaches back past `first` on purpose — preloaded bars are drawn as history. The
    // clamp that matters is the other end: `index + 1` never exposes an unplayed bar.
    const from = Math.max(0, index - visibleBarCount + 1)
    return bars.slice(from, index + 1)
  }

  function buildFrame(dt: number): ChartFrame {
    const window = visibleWindow(cursor)
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
        openUnit: normalizer.unit(bar.o),
        highUnit: normalizer.unit(bar.h),
        lowUnit: normalizer.unit(bar.l),
        // From the raw prices, so a bar clamped against the top of the chart is still
        // reported as rising. See `BarDirection`.
        direction: bar.c > bar.o ? 'up' : bar.c < bar.o ? 'down' : 'flat',
        // Only the newest bar is still forming.
        growth: age === 0 ? growth : 1,
        preloaded: index < first,
      }
    })

    // Reaches into a preloaded bar quite happily: with history on screen, the previous
    // close is a bar the player can see, which is the whole point of the marker.
    const previous = bars[cursor - 1]

    return {
      phase,
      bars: visible,
      bounds,
      barPhase: clock.phase,
      currentBar: bars[cursor],
      currentIndex: cursor,
      firstIndex: first,
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
