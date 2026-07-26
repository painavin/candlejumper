import { describe, expect, it, vi } from 'vitest'
import { createHoldGesture } from './holdGesture.js'

/** A controllable clock, so the gesture is tested without real timers. */
function fakeTimers() {
  let next = 1
  const pending = new Map<number, { callback: () => void; at: number }>()
  let now = 0
  return {
    setTimer: (callback: () => void, ms: number) => {
      const handle = next++
      pending.set(handle, { callback, at: now + ms })
      return handle
    },
    clearTimer: (handle: number) => {
      pending.delete(handle)
    },
    advance(ms: number) {
      now += ms
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(handle)
          timer.callback()
        }
      }
    },
  }
}

function gesture(holdMs = 400) {
  const timers = fakeTimers()
  const onTap = vi.fn()
  const onHold = vi.fn()
  const g = createHoldGesture({
    holdMs,
    onTap,
    onHold,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  return { g, timers, onTap, onHold }
}

describe('createHoldGesture', () => {
  it('fires a tap on a quick release', () => {
    const { g, timers, onTap, onHold } = gesture()
    g.down()
    timers.advance(100)
    g.up()
    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onHold).not.toHaveBeenCalled()
  })

  it('fires the hold as soon as the threshold is reached, without waiting for release', () => {
    // Flatten must feel immediate under pressure, not deferred to key-up.
    const { g, timers, onHold } = gesture()
    g.down()
    timers.advance(400)
    expect(onHold).toHaveBeenCalledTimes(1)
    expect(g.isDown).toBe(true)
  })

  it('swallows the release after a hold, so one gesture is not two actions', () => {
    const { g, timers, onTap, onHold } = gesture()
    g.down()
    timers.advance(500)
    g.up()
    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('ignores auto-repeat rather than restarting the timer', () => {
    // Holding a key must fire the hold exactly once. Restarting the timer on every
    // repeat event would mean flatten never fires.
    const { g, timers, onHold } = gesture()
    g.down()
    timers.advance(200)
    g.down()
    g.down()
    timers.advance(200)
    expect(onHold).toHaveBeenCalledTimes(1)
  })

  it('supports rapid taps for scaling out', () => {
    // "Exit twice quickly" is a legitimate thing a player does — which is why the
    // gesture is hold, not double-tap.
    const { g, timers, onTap, onHold } = gesture()
    for (let i = 0; i < 4; i++) {
      g.down()
      timers.advance(60)
      g.up()
    }
    expect(onTap).toHaveBeenCalledTimes(4)
    expect(onHold).not.toHaveBeenCalled()
  })

  it('cancels cleanly when focus is lost mid-hold', () => {
    const { g, timers, onTap, onHold } = gesture()
    g.down()
    timers.advance(100)
    g.cancel()
    timers.advance(1000)
    expect(onTap).not.toHaveBeenCalled()
    expect(onHold).not.toHaveBeenCalled()
    expect(g.isDown).toBe(false)
  })

  it('ignores a release that had no press', () => {
    const { g, onTap } = gesture()
    g.up()
    expect(onTap).not.toHaveBeenCalled()
  })
})
