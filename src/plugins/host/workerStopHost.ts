import type { OhlcvBar, PositionState, StopInstanceSpec } from '@shared/contracts/index.js'
import type { ActiveStopLevel, StopEngine, StopEvaluation, StopTrigger } from '@engine/stops/port.js'
import { usableLevel } from '@engine/stops/port.js'
import type { PluginFile } from '@platform/pluginLoading/index.js'
import type { PluginWorkerClient } from './workerClient.js'

/**
 * The worker-sandboxed stop host: the second implementation of `engine/stops/`'s
 * port, and the one that runs **player-supplied** code.
 *
 * ## How a synchronous port is served by an asynchronous worker
 *
 * This is the whole design problem, and the answer was already in the timing rule.
 * `StopEngine` is synchronous — `evaluate()` must return a verdict inside the tick —
 * while `postMessage` is not. But docs/stops.md#causality-and-timing already commits
 * to **bar N computes, bar N+1 enforces**: the level `evaluate()` needs was requested
 * a whole bar earlier. At the default 2 bars/sec that's 500ms of slack for a round
 * trip that takes well under a millisecond.
 *
 * So `computeLevels()` *posts* and returns immediately; the reply lands long before
 * the level is needed; and `evaluate()` reads the last delivered value synchronously.
 * The bar-N+1 rule isn't being bent to accommodate the worker — it's what makes the
 * worker possible.
 *
 * **If a reply is late, that bar has no level.** Identical to warm-up, and safe in
 * the sense that a missing level can never fire spuriously. It is *not* safe in the
 * sense of protecting the position, so consecutive misses count toward the same
 * disable-and-notify path as a throw. A stop that silently protects nothing is the
 * failure docs/stops.md calls the worst available.
 *
 * `SharedArrayBuffer` + `Atomics.wait` would make the call synchronous, and is
 * rejected: it needs cross-origin isolation headers (which a static host like SWA
 * would have to be configured for), and it blocks the render thread on plugin code —
 * handing an untrusted plugin the ability to freeze the game.
 */

export interface WorkerStopHostOptions {
  active: readonly StopInstanceSpec[]
  client: PluginWorkerClient
  /** Sources to load into the worker before any instance is created. */
  files: readonly PluginFile[]
  /** A stop died. Must reach the player — see docs/stops.md#sandboxing-and-hosting. */
  onDisabled?(stopId: string, reason: string): void
}

interface Slot {
  id: string
  advisory: boolean
  instanceId: number
  level: number | null
  /** Set once the level for the *next* bar has been asked for and not yet answered. */
  awaiting: boolean
  failures: number
  disabled: boolean
}

/**
 * Consecutive failures (throws, crashes, or blown budgets) before a stop is dropped.
 * More than one, because a single hiccup shouldn't cost the player their risk rule;
 * few enough that a broken plugin is gone within a couple of seconds of play.
 */
const FAILURE_LIMIT = 3

export async function createWorkerStopHost({
  active,
  client,
  files,
  onDisabled,
}: WorkerStopHostOptions): Promise<StopEngine> {
  // Load every source first: `create` can only name a plugin the worker has seen.
  for (const file of files.filter((entry) => entry.kind === 'stop')) {
    await client.send({ type: 'load', kind: 'stop', source: file.source })
  }

  const slots: Slot[] = []
  for (const spec of active) {
    const created = await client.send({
      type: 'create',
      pluginId: spec.typeId,
      params: spec.params,
    })
    if (created.type !== 'created') {
      // Refusing to start is right: pre-run validation should have caught an
      // unknown stop, and starting a run whose risk rule silently doesn't exist is
      // exactly the outcome that validation is there to prevent.
      throw new Error(
        `Stop "${spec.typeId}" could not be created in the plugin sandbox: ${
          created.type === 'failed' ? created.message : created.type
        }`
      )
    }
    slots.push({
      id: spec.typeId,
      advisory: spec.advisory,
      instanceId: created.instanceId,
      level: null,
      awaiting: false,
      failures: 0,
      disabled: false,
    })
  }

  const fail = (slot: Slot, reason: string): void => {
    slot.failures++
    slot.level = null
    if (slot.failures < FAILURE_LIMIT || slot.disabled) return
    slot.disabled = true
    onDisabled?.(slot.id, reason)
  }

  const breachedBy = (slot: Slot, close: number, position: PositionState): boolean => {
    if (slot.level === null || slot.disabled) return false
    // Direction inverts for shorts: the level sits above average entry and a
    // trailing stop ratchets downward. Same comparison, sign-flipped.
    return position.size > 0 ? close <= slot.level : close >= slot.level
  }

  const hasAdvisoryRule = slots.some((slot) => slot.advisory)
  const hasAnyRule = slots.length > 0

  return {
    observeBar() {
      // Indicator dependencies of *sandboxed* stops are resolved inside the worker
      // via `requires`, so there is nothing for the host to feed per bar here. The
      // in-process host owns that path; see `stopHost.ts`.
    },

    evaluate(close, position): StopEvaluation {
      const breaches: ActiveStopLevel[] = []
      let triggered: StopTrigger | null = null

      for (const slot of slots) {
        // A level that was asked for and never arrived is a bar this stop did not
        // protect. Counted, not ignored.
        if (slot.awaiting && !slot.disabled) fail(slot, 'did not answer within its time budget')
        if (!breachedBy(slot, close, position)) continue
        const level = slot.level as number

        if (slot.advisory) {
          breaches.push({ stopId: slot.id, level, advisory: true })
          continue
        }
        if (
          triggered === null ||
          (position.size > 0 ? level > triggered.level : level < triggered.level)
        ) {
          triggered = { stopId: slot.id, level }
        }
      }

      return { triggered, breaches }
    },

    computeLevels(bar: OhlcvBar, position: PositionState) {
      for (const slot of slots) {
        if (slot.disabled) continue
        slot.awaiting = true
        void client
          .send({
            type: 'stopBar',
            instanceId: slot.instanceId,
            bar,
            position,
            // Empty: a sandboxed stop's indicators live in the worker with it.
            indicators: {},
          })
          .then((response) => {
            slot.awaiting = false
            if (response.type === 'level') {
              slot.failures = 0
              slot.level = usableLevel(response.level)
              return
            }
            fail(slot, response.type === 'failed' ? response.message : 'unexpected reply')
          })
      }
    },

    get levels(): readonly ActiveStopLevel[] {
      return slots
        .filter((slot) => slot.level !== null && !slot.disabled)
        .map((slot) => ({
          stopId: slot.id,
          level: slot.level as number,
          advisory: slot.advisory,
        }))
    },

    onEntry() {
      for (const slot of slots) {
        if (slot.disabled) continue
        // No level yet: a stop can never fire on the bar the position opened on.
        slot.level = null
        slot.awaiting = false
        void client.send({ type: 'reset', instanceId: slot.instanceId })
      }
    },

    onExit() {
      for (const slot of slots) slot.level = null
    },

    reset() {
      for (const slot of slots) {
        slot.level = null
        slot.awaiting = false
        slot.failures = 0
        if (!slot.disabled) void client.send({ type: 'reset', instanceId: slot.instanceId })
      }
    },

    hasAdvisoryRule,
    hasAnyRule,
  }
}
