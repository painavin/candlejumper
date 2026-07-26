/**
 * Bar timing.
 *
 * `scrollSpeed` is in bars per second, so one bar occupies `1 / scrollSpeed`
 * seconds and everything else — pixel velocity, bounce cadence, growth
 * duration — derives from that rather than being configured separately.
 *
 * The three stall rules here are the reason this is its own file. A time-based
 * loop that faithfully resolves every owed bar after a stall is a silent P&L
 * corruption: background a tab for 10 seconds at 2 bars/sec and 20 bars resolve
 * in one frame, applying buffered presses to bars they were never aimed at. See
 * docs/game-design.md#scroll-speed-timing-and-pole-geometry.
 */

export interface RunClock {
  /**
   * Advance by elapsed wall-clock seconds.
   *
   * @returns how many bars completed this frame — 0 or 1, never more
   */
  advance(dt: number): number
  /** 0..1 through the current bar. Drives scroll offset and growth. */
  readonly phase: number
  /** How far the newest bar has grown toward its close height, 0..1. */
  readonly growth: number
  /** Seconds one bar occupies. */
  readonly barDuration: number
  reset(): void
  /** Bars dropped by the catch-up clamp, for reporting rather than silence. */
  readonly droppedBars: number
}

export interface RunClockOptions {
  /** Bars per second. */
  scrollSpeed: number
  /** Fraction of a bar's duration the newest bar spends growing. */
  growthFraction: number
}

export function createRunClock({ scrollSpeed, growthFraction }: RunClockOptions): RunClock {
  const barDuration = 1 / scrollSpeed
  /**
   * Sixty frames of `1/60` sum to 0.9999999999999999, so an exact `>=` defers a
   * bar by a whole frame at every integer-second boundary. The tolerance is
   * nine orders of magnitude below a bar, far too small to shift timing, and it
   * removes a class of "why did that bar take two frames" jitter.
   */
  const epsilon = barDuration * 1e-9
  let accumulator = 0
  let dropped = 0

  return {
    barDuration,

    advance(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return 0

      accumulator += dt

      // Rule 2: clamp the accumulator to one bar's worth. A GC hitch or a
      // window resize then slows the scroll imperceptibly instead of banking
      // bars for a burst later.
      if (accumulator > barDuration * 2) {
        dropped += Math.floor(accumulator / barDuration) - 1
        accumulator = barDuration + (accumulator % barDuration)
      }

      // Rule 1: at most one bar per frame. Safe unconditionally, since
      // scrollSpeed tops out at 10 bars/sec against a >=60Hz display.
      if (accumulator >= barDuration - epsilon) {
        accumulator = Math.max(0, accumulator - barDuration)
        return 1
      }
      return 0
    },

    get phase() {
      return accumulator / barDuration
    },

    get growth() {
      return growthFraction <= 0 ? 1 : Math.min(1, this.phase / growthFraction)
    },

    get droppedBars() {
      return dropped
    },

    reset() {
      accumulator = 0
      dropped = 0
    },
  }
}
