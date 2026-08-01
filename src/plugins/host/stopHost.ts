import type {
  IndicatorPlugin,
  IndicatorValues,
  OhlcvBar,
  PositionState,
  StopInstance,
  StopInstanceSpec,
  StopPlugin,
} from '@shared/contracts/index.js'
import type { ActiveStopLevel, StopEngine, StopEvaluation, StopTrigger } from '@engine/stops/port.js'
import { usableLevel } from '@engine/stops/port.js'
import type { IndicatorNode } from './indicatorTree.js'
import { feedIndicatorNode, resetIndicatorNode, resolveIndicatorTree } from './indicatorTree.js'

/**
 * The in-process stop host: one of the two implementations of the port
 * `engine/stops/` defines.
 *
 * This one runs plugin code directly, which is fine for the built-ins because
 * they're ours. Roadmap step 8 adds a worker-sandboxed implementation of the same
 * port for *user-supplied* plugins, at which point this survives as a test
 * double. Because the engine only ever sees the port, that's an implementation
 * swap rather than a rewrite of the pipeline's wiring.
 *
 * The engine never learns that stops can consume indicators: dependency
 * resolution and per-bar feeding are host concerns, added here at step 8.
 */

export interface StopHostOptions {
  /** The configured stop instances — `config.stops.active`, passed in by app/. */
  active: readonly StopInstanceSpec[]
  registry: ReadonlyMap<string, StopPlugin>
  /**
   * Indicators a stop may ask for. Separate from anything in
   * `indicators.active`: a stop's instances are its own, so toggling a chart
   * indicator can never change risk management.
   */
  indicators?: ReadonlyMap<string, IndicatorPlugin>
  /**
   * A stop threw and has been disabled for the rest of the run.
   *
   * **This must reach the player**, not a console: a dead stop silently removes risk
   * protection while a position is open, and the failure is invisible otherwise —
   * the chart simply stops drawing a line the player had been relying on. See
   * docs/stops.md#sandboxing-and-hosting.
   */
  onDisabled?(stopId: string, reason: string): void
}

interface Dependency {
  /** The local name this stop reads its values under. */
  key: string
  /**
   * The indicator, plus anything *it* was built from — a stop can now ask for a
   * composite indicator, and the whole branch is fed as one unit.
   */
  node: IndicatorNode
}

interface Slot {
  id: string
  advisory: boolean
  instance: StopInstance
  /** Indicator instances owned by *this stop*, never shared with the chart. */
  dependencies: Dependency[]
  /**
   * The level computed at the *previous* bar's close — the one this bar is
   * evaluated against. Rotated in `computeLevels`, which the pipeline calls at
   * step 6, strictly after `evaluate` at step 5.
   */
  level: number | null
  /**
   * Set once the plugin has thrown. A disabled stop draws no level and can never
   * fire — deliberately *not* treated as "no stop configured", because the streak
   * meter's dormant state means the player chose to have no rule, which isn't what
   * happened here.
   */
  disabled: boolean
}

export function createStopHost({
  active: configured,
  registry,
  indicators = new Map(),
  onDisabled,
}: StopHostOptions): StopEngine {
  const slots: Slot[] = configured.map((active) => {
    const plugin = registry.get(active.typeId)
    if (!plugin) {
      // Unresolvable stops are caught by pre-run validation; reaching here means
      // validation was skipped, and starting a run whose stop silently doesn't
      // exist is exactly the failure worth refusing.
      throw new Error(`No stop plugin registered with id "${active.typeId}"`)
    }
    const params = withDefaults(plugin, active.params)

    // `requires()` is resolved once, at run start, from the params the player
    // committed. Each request gets its **own** instance — if a stop shared one with
    // a displayed indicator, hiding an overlay could alter or kill the stop driving
    // the player's exits, which is the fail-open-on-risk outcome the docs call the
    // worst available. An indicator that requires others resolves recursively, with
    // the cycle and depth guards living in `indicatorTree.ts`.
    const dependencies: Dependency[] = (plugin.requires?.(params) ?? []).map((request) => {
      try {
        return { key: request.key, node: resolveIndicatorTree(request, indicators) }
      } catch (error) {
        // Named for the stop, not just the indicator: "atr is not registered" leaves
        // the player hunting for who wanted it, and the answer is what they'd act on.
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Stop "${plugin.id}" needs indicator "${request.indicatorId}": ${reason}`,
          { cause: error }
        )
      }
    })

    return {
      id: active.typeId,
      advisory: active.advisory,
      instance: plugin.createInstance(params),
      dependencies,
      level: null,
      disabled: false,
    }
  })

  /**
   * Run one plugin call, disabling the stop if it throws.
   *
   * Every entry point into plugin code goes through this. A stop that throws once
   * will almost certainly throw again on the next bar, so retrying it would mean
   * either a per-frame exception storm or a stop that intermittently protects —
   * both worse than being told plainly that it's gone.
   */
  const guard = <T,>(slot: Slot, call: () => T): T | undefined => {
    if (slot.disabled) return undefined
    try {
      return call()
    } catch (error) {
      slot.disabled = true
      slot.level = null
      onDisabled?.(slot.id, error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

  const hasAdvisoryRule = slots.some((slot) => slot.advisory)
  const hasAnyRule = slots.length > 0

  const breachedBy = (slot: Slot, close: number, position: PositionState): boolean => {
    if (slot.level === null || slot.disabled) return false
    // Direction inverts for shorts: the level sits above average entry and a
    // trailing stop ratchets downward. Same comparison, sign-flipped.
    return position.size > 0 ? close <= slot.level : close >= slot.level
  }

  return {
    observeBar(bar: OhlcvBar) {
      // **Fed every bar from the first bar of the run, not just while a position is
      // open.** This is the non-obvious rule: only the *stop's* onBar is gated on
      // having a position. If its indicators were fed only during a position, a
      // 14-bar ATR stop would restart warm-up on every entry and offer no level for
      // the first 14 bars of each trade — precisely the bars where a new position is
      // most exposed.
      for (const slot of slots) {
        for (const dependency of slot.dependencies) {
          guard(slot, () => feedIndicatorNode(dependency.node, bar, false))
        }
      }
    },

    evaluate(close, position): StopEvaluation {
      const breaches: ActiveStopLevel[] = []
      let triggered: StopTrigger | null = null

      for (const slot of slots) {
        if (!breachedBy(slot, close, position)) continue
        const level = slot.level as number

        if (slot.advisory) {
          // Displayed but never enforced: the player has to honour it themselves.
          breaches.push({ stopId: slot.id, level, advisory: true })
          continue
        }

        // With several enforcing stops active, whichever level is hit first —
        // effectively the tightest binding constraint, which is how a trader
        // stacking a hard stop under a trailing stop expects it to behave.
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
        const values: IndicatorValues = {}
        for (const dependency of slot.dependencies) values[dependency.key] = dependency.node.latest
        const returned = guard(slot, () => slot.instance.onBar(bar, position, values))
        if (slot.disabled) continue
        // Belt and braces against NaN during warm-up: a non-finite level is a
        // stop the HUD shows as active that can never fire.
        slot.level = usableLevel(returned ?? null)
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
        // Resets the *stop*, deliberately not its indicators — those are the host's
        // and keep warming across trades.
        guard(slot, () => slot.instance.reset())
        // No level yet: a stop can never fire on the bar the position opened on.
        slot.level = null
      }
    },

    onExit() {
      for (const slot of slots) slot.level = null
    },

    reset() {
      // Run start or ticker change is the only time indicators reset too.
      for (const slot of slots) {
        guard(slot, () => slot.instance.reset())
        slot.level = null
        for (const dependency of slot.dependencies) {
          guard(slot, () => resetIndicatorNode(dependency.node))
        }
      }
    },

    hasAdvisoryRule,
    hasAnyRule,
  }
}

/** Fill any parameter the config didn't set from the plugin's own ParamSpec. */
function withDefaults(plugin: StopPlugin, params: Record<string, number>): Record<string, number> {
  const resolved: Record<string, number> = { ...params }
  for (const spec of plugin.params) {
    if (resolved[spec.key] === undefined && typeof spec.default === 'number') {
      resolved[spec.key] = spec.default
    }
  }
  return resolved
}
