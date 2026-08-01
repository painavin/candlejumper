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
/**
 * Left and right change the scroll speed — the one control that isn't a trade.
 *
 * They fall out of up-is-buy: the vertical axis is already the position and the
 * horizontal axis is the one the chart moves along, so left and right meaning "slower"
 * and "faster" reads as pulling the world toward you or pushing it away. Nothing on the
 * horizontal axis was bound, so no existing muscle memory moves.
 */
const SLOWER_KEYS = new Set(['ArrowLeft', 'KeyA'])
const FASTER_KEYS = new Set(['ArrowRight', 'KeyD'])

/**
 * Which way a speed press goes.
 *
 * Declared here rather than imported from `engine/run/speed.ts`, where the ladder lives:
 * this zone may reach `@shared` and `@engine/pipeline` and nothing else, and widening that
 * for one string union would be the wrong trade. The two unions are checked against each
 * other structurally at the wiring site in `app/runSession.ts`, so renaming a direction in
 * the engine fails the build rather than diverging quietly.
 */
export type SpeedDirection = 'faster' | 'slower'

export interface KeyboardOptions {
  /** Where a resolved action goes. The run controller decides whether to keep it. */
  press(action: TradeAction): void
  flattenHoldMs: number
  onPause(): void
  /**
   * One rung faster or slower. Not a `TradeAction`, deliberately: it moves no money, so
   * routing it through the input buffer would put a view control in the queue that decides
   * which bar a fill lands on.
   */
  onSpeed(direction: SpeedDirection): void
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
  onSpeed,
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

    // Speed is handled before the auto-repeat guard and before the block check, because
    // neither reason for those applies to it: it moves no money, so a held key can't drain
    // buying power, and holding it to ramp the speed is the natural gesture. The ladder's
    // ends are the clamp, so a key left down settles at 0.5 or 10 rather than running away.
    if (SLOWER_KEYS.has(key.code)) {
      key.preventDefault()
      onSpeed('slower')
      return
    }
    if (FASTER_KEYS.has(key.code)) {
      key.preventDefault()
      onSpeed('faster')
      return
    }

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
