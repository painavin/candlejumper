import type { RunConfig } from '@config/index.js'
import type { OhlcvBar, PositionState } from '@shared/contracts/index.js'
import type { PositionEvent } from '../output/events.js'
import type { Position } from '../position/position.js'
import {
  directionOf,
  flatten,
  isFlat,
  markBar,
  openOrAdd,
  reduceOneUnit,
} from '../position/position.js'
import type { StopEngine } from '../stops/port.js'
import type { StatsState } from '../scoring/stats.js'
import { applyEvents } from '../scoring/stats.js'
import type { StreakState } from '../scoring/streak.js'
import { applyStreak } from '../scoring/streak.js'
import type { TradeAction } from './inputBuffer.js'

/**
 * The ordered per-bar tick.
 *
 * Specifying this order is what makes same-bar interactions deterministic rather
 * than emergent. Two consequences are the whole reason it's fixed:
 *
 *   - **Inputs are applied before stops are evaluated** (step 3 before step 5).
 *     A manual exit on the same bar a stop would have fired wins, and the stop
 *     finds a flat position. Manual action always overrides an enforcing stop.
 *   - **A stop level computed at bar N is enforced against bar N+1.** Computing a
 *     level from bar N and also triggering it on bar N would be retroactive.
 *     Consequence worth stating: a stop can never fire on the bar the position
 *     was opened on.
 *
 * Steps 1 (growth completes) and 8 (advance) belong to playback; this covers 2–7.
 * See docs/game-design.md#tick-pipeline.
 */

export interface TickState {
  position: Position
  stats: StatsState
  streak: StreakState
  /** Is the position past an advisory level right now? Per-bar, not a latch. */
  inBreach: boolean
  /** Bars the current position has been open. */
  barsHeld: number
}

export interface TickInput {
  bar: OhlcvBar
  index: number
  /** Buffered presses, in press order. */
  actions: readonly TradeAction[]
  /**
   * Close any open position at this bar's close, reported distinctly.
   *
   * `end-of-data` is the series running out; `ended-early` is the pause menu's
   * "end run". Neither is a player decision *about the trade*, so both are
   * reported separately rather than counted as normal exits — otherwise they
   * quietly distort win-rate stats.
   */
  forceClose?: 'end-of-data' | 'ended-early'
}

export interface TickDeps {
  config: RunConfig
  stops: StopEngine
}

export interface TickResult {
  state: TickState
  events: readonly PositionEvent[]
}

/** The slice of position state a stop plugin sees. */
export function stopView(position: Position, barsHeld: number): PositionState {
  return {
    size: position.shares,
    avgCost: position.avgCost,
    barsHeld,
    bestPrice: position.bestPrice,
    worstPrice: position.worstPrice,
    entryBarIndex: position.entryBarIndex,
  }
}

export function tickBar(
  state: TickState,
  { bar, index, actions, forceClose }: TickInput,
  { config, stops }: TickDeps
): TickResult {
  const events: PositionEvent[] = []
  const fill = bar.c
  let position = state.position
  let barsHeld = isFlat(position) ? 0 : state.barsHeld + 1

  // Stop-owned indicators are fed every bar from the first bar of the run,
  // whether or not a position is open — otherwise a 14-bar ATR stop restarts
  // warm-up on every entry.
  stops.observeBar(bar)

  // ── Step 3: apply orders, in press order, at this bar's close ─────────────
  for (const action of actions) {
    const direction = directionOf(position)

    if (action === 'flatten') {
      if (direction === 'flat') break // silent no-op; punishing a "make sure I'm out" reflex would be wrong
      const result = flatten(position, fill)
      position = result.position
      events.push({
        kind: 'positionClosed',
        direction: direction === 'long' ? 'long' : 'short',
        price: fill,
        realized: result.realized,
        profitable: result.realized > 0,
        unitsClosed: result.unitsClosed,
        viaFlatten: true,
        wentFlat: result.wentFlat,
      })
      barsHeld = 0
      stops.onExit()
      continue
    }

    // Whether a press grows or shrinks the position depends on which way it's
    // facing — the counterintuitive cell is `buy` on a short, which is an exit.
    const grows =
      direction === 'flat' ? true : (action === 'buy') === (direction === 'long')

    if (grows) {
      if (direction === 'flat' && action === 'sell' && !config.allowShorting) {
        events.push({ kind: 'actionDenied', reason: 'shorting-disabled' })
        continue
      }
      const wanted: 'long' | 'short' =
        direction === 'flat' ? (action === 'buy' ? 'long' : 'short') : direction

      const result = openOrAdd(position, wanted, fill, config, index)
      if ('denied' in result) {
        events.push({ kind: 'actionDenied', reason: result.denied })
        continue
      }
      position = result.position
      if (result.opened) {
        barsHeld = 0
        stops.onEntry()
        events.push({
          kind: 'positionOpened',
          direction: wanted,
          price: fill,
          shares: result.sharesAdded,
        })
      } else {
        events.push({
          kind: 'positionIncreased',
          direction: wanted,
          price: fill,
          shares: result.sharesAdded,
        })
      }
      continue
    }

    // Shrinks: an exit press. Governed by the unit rule, never by `entrySize` —
    // N entries take exactly N exits.
    const closing = direction === 'long' ? 'long' : 'short'
    const result = reduceOneUnit(position, fill)
    position = result.position
    events.push({
      kind: 'positionClosed',
      direction: closing,
      price: fill,
      realized: result.realized,
      profitable: result.realized > 0,
      unitsClosed: result.unitsClosed,
      viaFlatten: false,
      wentFlat: result.wentFlat,
    })
    if (result.wentFlat) {
      barsHeld = 0
      stops.onExit()
    }
  }

  // ── Step 4: track the extremes the position has reached ───────────────────
  position = markBar(position, fill)

  // ── Step 5: evaluate levels computed at bar N−1 against this bar's close ──
  let inBreach = false
  if (!isFlat(position)) {
    const evaluation = stops.evaluate(fill, stopView(position, barsHeld))

    for (const breach of evaluation.breaches) {
      events.push({
        kind: 'advisoryBreached',
        stopId: breach.stopId,
        level: breach.level,
        price: fill,
      })
    }
    inBreach = evaluation.breaches.length > 0

    if (evaluation.triggered) {
      const direction = directionOf(position) === 'long' ? 'long' : 'short'
      // A triggered stop closes the entire position, not a fraction — a partial
      // stop-out would blur the "you got taken out" signal.
      const closed = flatten(position, fill)
      position = closed.position
      events.push({
        kind: 'stoppedOut',
        direction,
        price: fill,
        level: evaluation.triggered.level,
        stopId: evaluation.triggered.stopId,
      })
      events.push({
        kind: 'positionClosed',
        direction,
        price: fill,
        realized: closed.realized,
        profitable: closed.realized > 0,
        unitsClosed: closed.unitsClosed,
        viaFlatten: false,
        wentFlat: true,
      })
      barsHeld = 0
      stops.onExit()
    }
  }

  // Force-close with a position still open, at this bar's close.
  if (forceClose && !isFlat(position)) {
    const direction = directionOf(position) === 'long' ? 'long' : 'short'
    const closed = flatten(position, fill)
    position = closed.position
    events.push({ kind: 'forceClosed', reason: forceClose, price: fill })
    events.push({
      kind: 'positionClosed',
      direction,
      price: fill,
      realized: closed.realized,
      profitable: closed.realized > 0,
      unitsClosed: closed.unitsClosed,
      viaFlatten: false,
      wentFlat: true,
    })
    barsHeld = 0
    stops.onExit()
  }

  // ── Step 6: ask for the level to enforce on bar N+1 ──────────────────────
  if (!isFlat(position)) {
    stops.computeLevels(bar, stopView(position, barsHeld))
  }

  // ── Step 7: statistics and the discipline streak ─────────────────────────
  const stats = applyEvents(state.stats, events, index)
  const streak = applyStreak(state.streak, events, { config, inBreach })

  return {
    state: { position, stats, streak, inBreach, barsHeld },
    events,
  }
}
