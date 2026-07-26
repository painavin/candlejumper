import type { TradeAction } from '@engine/pipeline/inputBuffer.js'
import { createHoldGesture } from './holdGesture.js'

/**
 * Device listeners.
 *
 * This is the last place button names exist. Everything downstream sees a
 * `TradeAction` — `buy` / `sell` / `flatten` — and the engine's own output is
 * keyed to semantic position events, so nothing can accidentally bind a cue to
 * "the sell button" and misfire on every short exit.
 *
 * Up-is-buy is deliberate: it matches the character jumping *up* onto poles for a
 * long and going under for a short, so control direction, price direction, and
 * the character's position all agree. Arrows and WASD are both live so either
 * hand works.
 */

const BUY_KEYS = new Set(['ArrowUp', 'KeyW'])
const SELL_KEYS = new Set(['ArrowDown', 'KeyS'])
const PAUSE_KEYS = new Set(['Escape', 'KeyP'])

export interface KeyboardOptions {
  /** Where a resolved action goes. The run controller decides whether to keep it. */
  press(action: TradeAction): void
  flattenHoldMs: number
  onPause(): void
  /** Presses are dropped, not queued, while this returns true. */
  isInputBlocked(): boolean
  target?: EventTarget
}

export interface InputBinding {
  detach(): void
}

export function attachKeyboard({
  press,
  flattenHoldMs,
  onPause,
  isInputBlocked,
  target = globalThis.window,
}: KeyboardOptions): InputBinding {
  const push = (action: TradeAction): void => {
    // Presses are dropped, not queued, while blocked — so a panicked double-tap
    // during the stopped-out transient doesn't re-enter the position the player
    // was just taken out of.
    if (isInputBlocked()) return
    press(action)
  }

  const exitGesture = createHoldGesture({
    holdMs: flattenHoldMs,
    onTap: () => push('sell'),
    onHold: () => push('flatten'),
  })

  const onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent
    // One action per press, no auto-repeat: holding a key must never drain buying
    // power by repeating an entry. Position sizing should not be a function of how
    // long a finger rested on a button.
    if (key.repeat) return

    if (BUY_KEYS.has(key.code)) {
      key.preventDefault()
      push('buy')
      return
    }
    if (SELL_KEYS.has(key.code)) {
      key.preventDefault()
      exitGesture.down()
      return
    }
    if (PAUSE_KEYS.has(key.code)) {
      key.preventDefault()
      onPause()
    }
  }

  const onKeyUp = (event: Event): void => {
    const key = event as KeyboardEvent
    if (SELL_KEYS.has(key.code)) exitGesture.up()
  }

  /** A key held while the window loses focus would otherwise stay "down" forever. */
  const onBlur = (): void => exitGesture.cancel()

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  return {
    detach() {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
      exitGesture.cancel()
    },
  }
}
