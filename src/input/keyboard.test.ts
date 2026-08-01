// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { attachKeyboard } from './keyboard.js'

/**
 * The keyboard bindings, and specifically the speed keys.
 *
 * Left and right are the first control here that is **not** a trade, and they deliberately
 * sit outside both guards the trade keys need — auto-repeat and the input block. Those two
 * exemptions are the whole reason this file exists: each is a one-line difference that
 * would be invisible until someone held a key during a stopped-out transient.
 */

function setup(blocked = false) {
  const target = new EventTarget()
  const press = vi.fn()
  const onPause = vi.fn()
  const onSpeed = vi.fn()
  const binding = attachKeyboard({
    press,
    flattenHoldMs: 400,
    onPause,
    onSpeed,
    isInputBlocked: () => blocked,
    target,
  })
  const down = (code: string, repeat = false) =>
    target.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code, repeat }))
  const up = (code: string) =>
    target.dispatchEvent(Object.assign(new Event('keyup', { cancelable: true }), { code }))
  return { binding, press, onPause, onSpeed, down, up }
}

describe('the speed keys', () => {
  it('steps down on left and up on right', () => {
    const { onSpeed, down } = setup()
    down('ArrowLeft')
    down('ArrowRight')
    expect(onSpeed.mock.calls).toEqual([['slower'], ['faster']])
  })

  it('takes the WASD pair as well, like every other control', () => {
    const { onSpeed, down } = setup()
    down('KeyA')
    down('KeyD')
    expect(onSpeed.mock.calls).toEqual([['slower'], ['faster']])
  })

  it('repeats while held, unlike a trade key', () => {
    // Holding right to ramp the speed up is the natural gesture, and there is no economic
    // consequence to repeating it — the ladder's ends are the clamp. The auto-repeat guard
    // exists to stop a held key draining buying power, which does not apply here.
    const { onSpeed, press, down } = setup()
    down('ArrowRight', true)
    down('ArrowUp', true)
    expect(onSpeed).toHaveBeenCalledTimes(1)
    expect(press).not.toHaveBeenCalled()
  })

  it('still works while trade input is blocked', () => {
    // The block exists so a panicked double-tap during the stopped-out transient can't
    // re-enter the position. Slowing down is exactly what a player wants at that moment.
    const { onSpeed, press, down } = setup(true)
    down('ArrowLeft')
    down('ArrowUp')
    expect(onSpeed).toHaveBeenCalledExactlyOnceWith('slower')
    expect(press).not.toHaveBeenCalled()
  })

  it('never reaches the trade path', () => {
    const { press, onPause, down } = setup()
    down('ArrowLeft')
    down('ArrowRight')
    expect(press).not.toHaveBeenCalled()
    expect(onPause).not.toHaveBeenCalled()
  })

  it('claims the key, so the page does not scroll sideways under the canvas', () => {
    const target = new EventTarget()
    attachKeyboard({
      press: vi.fn(),
      flattenHoldMs: 400,
      onPause: vi.fn(),
      onSpeed: vi.fn(),
      isInputBlocked: () => false,
      target,
    })
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      code: 'ArrowRight',
      repeat: false,
    })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('stops firing once detached', () => {
    const { binding, onSpeed, down } = setup()
    binding.detach()
    down('ArrowRight')
    expect(onSpeed).not.toHaveBeenCalled()
  })
})

describe('the trade keys', () => {
  it('still buy, sell, and pause', () => {
    // A regression guard for the branch order: speed is handled first now, so these have to
    // be checked in the same file. Sell is a tap of the hold gesture, hence the release.
    const { press, onPause, down, up } = setup()
    down('ArrowUp')
    down('ArrowDown')
    up('ArrowDown')
    down('Escape')
    expect(press.mock.calls).toEqual([['buy'], ['sell']])
    expect(onPause).toHaveBeenCalledTimes(1)
  })
})
