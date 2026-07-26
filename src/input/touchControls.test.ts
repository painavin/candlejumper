import { describe, expect, it, vi } from 'vitest'
import { createTouchControls } from './touchControls.js'

/**
 * Touch failures are invisible until someone plays on a phone, so these pin the two
 * that would hurt: a hold that keeps running after the thumb leaves the button (which
 * flattens a position the player didn't mean to close), and a press that queues
 * instead of dropping while input is blocked.
 */

describe('createTouchControls', () => {
  const setup = (blocked = false) => {
    const press = vi.fn()
    const onPause = vi.fn()
    const controls = createTouchControls({
      press,
      flattenHoldMs: 400,
      isInputBlocked: () => blocked,
      onPause,
    })
    return { controls, press, onPause }
  }

  it('buys once per press', () => {
    const { controls, press } = setup()
    controls.buy()
    expect(press).toHaveBeenCalledExactlyOnceWith('buy')
  })

  it('taps to sell one unit', () => {
    vi.useFakeTimers()
    const { controls, press } = setup()
    controls.exitDown()
    vi.advanceTimersByTime(100)
    controls.exitUp()
    expect(press).toHaveBeenCalledExactlyOnceWith('sell')
    vi.useRealTimers()
  })

  it('holds to flatten, and the release does not also sell', () => {
    vi.useFakeTimers()
    const { controls, press } = setup()
    controls.exitDown()
    vi.advanceTimersByTime(450)
    controls.exitUp()
    expect(press).toHaveBeenCalledExactlyOnceWith('flatten')
    vi.useRealTimers()
  })

  it('cancels cleanly when a thumb slides off the button', () => {
    // The failure this prevents: `pointerup` fires outside the element, so without a
    // cancel path the hold timer keeps running and flattens the position after the
    // player has already let go.
    vi.useFakeTimers()
    const { controls, press } = setup()
    controls.exitDown()
    controls.cancel()
    vi.advanceTimersByTime(1000)
    expect(press).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('drops presses while input is blocked rather than queuing them', () => {
    // Same rule as the keyboard: a panicked double-tap during the stopped-out
    // transient must not re-enter the position the player was just taken out of.
    const { controls, press } = setup(true)
    controls.buy()
    controls.exitDown()
    controls.exitUp()
    expect(press).not.toHaveBeenCalled()
  })

  it('routes pause straight through', () => {
    const { controls, onPause } = setup()
    controls.pause()
    expect(onPause).toHaveBeenCalledTimes(1)
  })
})
