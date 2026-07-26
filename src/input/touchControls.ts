import type { TouchHandlers } from '@shared/contracts/index.js'
import type { TradeAction } from '@engine/pipeline/inputBuffer.js'
import { createHoldGesture } from './holdGesture.js'

/**
 * Touch controls, as handlers rather than listeners.
 *
 * The thumb buttons themselves are DOM (`ui/mobile/`), because they're static for
 * the whole run and touch handling is what DOM is good at — see
 * docs/code-structure.md#the-hud-renders-in-pixijs-not-svelte for why that
 * exception is safe while a DOM *HUD* wouldn't be.
 *
 * What stays here is the **mapping from gesture to `TradeAction`**, so `input/`
 * remains the last place button names exist. A component that called
 * `press('flatten')` itself would fork the tap-versus-hold rule across two zones,
 * and the rule is subtle enough (docs/controls.md#tap-vs-hold-disambiguation) that
 * one implementation is the point.
 *
 * Deliberately **not** whole-screen region tapping. The chart occupies the screen
 * and a misplaced tap would open a position the player didn't want; discrete
 * buttons in the corners are what docs/controls.md specifies, and they also keep a
 * thumb off the poles being read.
 */

export interface TouchControlOptions {
  press(action: TradeAction): void
  flattenHoldMs: number
  isInputBlocked(): boolean
  onPause(): void
}

/** The shape `ui/mobile/` binds to, defined in `shared/` so neither zone imports the other. */
export type TouchControls = TouchHandlers

export function createTouchControls({
  press,
  flattenHoldMs,
  isInputBlocked,
  onPause,
}: TouchControlOptions): TouchControls {
  const push = (action: TradeAction): void => {
    if (isInputBlocked()) return
    press(action)
  }

  const exitGesture = createHoldGesture({
    holdMs: flattenHoldMs,
    onTap: () => push('sell'),
    onHold: () => push('flatten'),
  })

  return {
    buy: () => push('buy'),
    exitDown: () => exitGesture.down(),
    exitUp: () => exitGesture.up(),
    cancel: () => exitGesture.cancel(),
    pause: onPause,
  }
}
