import type { OhlcvBar } from '@shared/contracts/index.js'
import type { Direction } from '../position/position.js'

/**
 * The engine's semantic event vocabulary.
 *
 * Events are keyed to what happened to the **position**, never to which button
 * was pressed. This is load-bearing rather than stylistic: when short, the
 * *closing* action is `buy`, so anything bound to a button name misfires on
 * every short exit — playing an exit sound on entry and vice versa. `audio/`,
 * `render/juice/`, and `render/character/` may only import this folder, so there
 * is no `sell` for them to bind to.
 *
 * See docs/audio.md#channel-3--event-stingers-one-shots.
 */

export type DeniedReason =
  | 'shorting-disabled'
  | 'no-buying-power'
  | 'nothing-to-close'
  | 'input-ignored'

export type PositionEvent =
  | { kind: 'positionOpened'; direction: 'long' | 'short'; price: number; shares: number }
  | { kind: 'positionIncreased'; direction: 'long' | 'short'; price: number; shares: number }
  | {
      kind: 'positionClosed'
      /** Which way the *closed* position was facing, not which button did it. */
      direction: 'long' | 'short'
      price: number
      realized: number
      profitable: boolean
      unitsClosed: number
      /** Closed every unit at once, so it's one event rather than N. */
      viaFlatten: boolean
      wentFlat: boolean
    }
  | { kind: 'stoppedOut'; direction: 'long' | 'short'; price: number; level: number; stopId: string }
  | { kind: 'advisoryBreached'; stopId: string; level: number; price: number }
  | { kind: 'forceClosed'; reason: 'end-of-data' | 'ended-early'; price: number }
  | { kind: 'actionDenied'; reason: DeniedReason }

/**
 * The stinger/animation key for an event, as the audio and character docs name
 * them. Derived here so the mapping exists once — `positionClosed.profit` is a
 * key in a theme bundle, not a second event type.
 */
export function eventKey(event: PositionEvent): string {
  if (event.kind === 'positionClosed') {
    return event.profitable ? 'positionClosed.profit' : 'positionClosed.loss'
  }
  return event.kind
}

/** Everything that happened on one bar, in the order the pipeline produced it. */
export interface BarOutcome {
  bar: OhlcvBar
  index: number
  events: readonly PositionEvent[]
  direction: Direction
}
