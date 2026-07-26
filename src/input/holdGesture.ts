/**
 * Tap versus hold.
 *
 * Because holding the exit key now means "flatten", the two gestures need an
 * explicit rule rather than a guess:
 *
 *   - On key/touch down, start a timer. Do nothing yet.
 *   - Released **before** the threshold → a normal single-unit exit press.
 *   - Threshold **reached while still held** → flatten fires immediately, and the
 *     eventual release is swallowed so it doesn't also register a tap.
 *
 * Rejected alternative: double-tap, which can't be distinguished from rapid
 * scaling out — "exit twice quickly" is a legitimate thing a player does, and the
 * engine would have to guess. See docs/controls.md#tap-vs-hold-disambiguation.
 */

export interface HoldGesture {
  down(): void
  up(): void
  cancel(): void
  readonly isDown: boolean
}

export interface HoldGestureOptions {
  holdMs: number
  onTap(): void
  onHold(): void
  /** Injected so the gesture is testable without real timers. */
  setTimer?(callback: () => void, ms: number): number
  clearTimer?(handle: number): void
}

export function createHoldGesture({
  holdMs,
  onTap,
  onHold,
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number,
  clearTimer = (handle) => globalThis.clearTimeout(handle),
}: HoldGestureOptions): HoldGesture {
  let handle: number | undefined
  let down = false
  /** Set once the hold fires, so the release doesn't also read as a tap. */
  let consumed = false

  const stopTimer = (): void => {
    if (handle !== undefined) clearTimer(handle)
    handle = undefined
  }

  return {
    down() {
      // Guards against auto-repeat: holding a key must fire the hold exactly
      // once, not restart the timer on every repeat event.
      if (down) return
      down = true
      consumed = false
      handle = setTimer(() => {
        handle = undefined
        consumed = true
        onHold()
      }, holdMs)
    },

    up() {
      if (!down) return
      down = false
      stopTimer()
      if (!consumed) onTap()
      consumed = false
    },

    cancel() {
      down = false
      consumed = false
      stopTimer()
    },

    get isDown() {
      return down
    },
  }
}
