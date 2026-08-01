import type { IndicatorOutputStyle, IndicatorPlugin, OhlcvBar } from '@shared/contracts/index.js'
import { instanceLabel } from '@shared/contracts/index.js'
import { DEFAULT_INDICATOR_COLOUR } from '@shared/palette/index.js'
import type { IndicatorFeed, IndicatorSeries, ResolvedOutputStyle } from '@engine/indicators/feed.js'
import { feedIndicatorNode, resetIndicatorNode, resolveIndicatorTree } from './indicatorTree.js'

/**
 * The host-side implementation of the displayed-indicator port.
 *
 * These instances exist **only** to be drawn. Any indicator a stop asked for is a
 * separate instance owned by the stop host — two instances of SMA(20) computing the
 * same numbers, deliberately. That costs a few arithmetic ops per bar and buys two
 * things worth far more: toggling a pane can never change risk management, and the
 * run fingerprint stays honest, since `indicators.*` is excluded from it while
 * `stops.active` is included.
 *
 * A displayed indicator may itself be built from others via `requires()`, so each
 * slot is a *tree* resolved by `indicatorTree.ts`. Only the root's outputs are
 * drawn: a composite's inputs are its own business, and drawing them would put lines
 * on the chart the player never asked for.
 */

export interface DisplayedIndicatorSpec {
  instanceId: string
  typeId: string
  params: Record<string, number>
  /** Player-chosen base colour. Optional so a caller without one still works. */
  colour?: number
  /** Player's pane override. Unset falls back to the plugin's own `paneKind`. */
  paneKind?: 'overlay' | 'oscillator'
  /** Player's per-output overrides, layered over the plugin's own defaults. */
  outputs?: Readonly<Record<string, IndicatorOutputStyle>>
}

export interface IndicatorFeedOptions {
  active: readonly DisplayedIndicatorSpec[]
  registry: ReadonlyMap<string, IndicatorPlugin>
}

/**
 * The style each output is actually drawn with: player override, then the plugin's
 * suggestion, then a plain line in the instance's colour.
 *
 * Resolved once here, where both halves are in scope, rather than at the renderer —
 * `render/` may not reach the plugin registry, and resolving it twice is how an
 * overlay and a legend end up disagreeing. `colour` stays possibly-undefined because
 * "the instance's colour" is a real answer that only the engine can apply, once it
 * knows which instance the series belongs to.
 */
export function resolveOutputStyles(
  outputs: readonly string[],
  plugin: Readonly<Record<string, IndicatorOutputStyle>> | undefined,
  player: Readonly<Record<string, IndicatorOutputStyle>> | undefined
): Record<string, ResolvedOutputStyle> {
  const resolved: Record<string, ResolvedOutputStyle> = {}
  for (const output of outputs) {
    const declared = plugin?.[output]
    const chosen = player?.[output]
    resolved[output] = {
      draw: chosen?.draw ?? declared?.draw ?? 'line',
      colour: chosen?.colour ?? declared?.colour,
      // Not overridable: an offset is the plugin saying "this mark flags a bar rather
      // than naming a price", which is a fact about the output, not a preference.
      offsetPx: declared?.offsetPx,
    }
  }
  return resolved
}

export function createIndicatorFeed({ active, registry }: IndicatorFeedOptions): IndicatorFeed {
  const slots = active.map((spec) => {
    const plugin = registry.get(spec.typeId)
    if (!plugin) {
      throw new Error(`No indicator plugin registered with id "${spec.typeId}"`)
    }
    const series: IndicatorSeries = {
      instanceId: spec.instanceId,
      // Per *instance*, not per plugin: with SMA 20, 50, and 200 active at once, a
      // shared "Simple Moving Average" would leave the three lines unidentifiable.
      displayName: instanceLabel(plugin, spec.params),
      colour: spec.colour ?? DEFAULT_INDICATOR_COLOUR,
      // The player's choice wins, falling back to the plugin's suggestion.
      paneKind: spec.paneKind ?? plugin.paneKind,
      outputs: plugin.outputs,
      styles: resolveOutputStyles(plugin.outputs, plugin.outputStyles, spec.outputs),
      fixedRange: plugin.fixedRange,
      history: Object.fromEntries(plugin.outputs.map((output) => [output, [] as number[]])),
    }
    const node = resolveIndicatorTree({ indicatorId: spec.typeId, params: spec.params }, registry)
    return { spec, plugin, node, series }
  })

  return {
    observeBar(bar: OhlcvBar, isLastBar: boolean) {
      for (const slot of slots) {
        // Incremental, one value per bar, rather than a full recompute of the series
        // every frame — that's what keeps cost bounded as a run gets longer.
        const outputs = feedIndicatorNode(slot.node, bar, isLastBar)
        for (const output of slot.plugin.outputs) {
          // `feedIndicatorNode` has already substituted NaN for anything the plugin
          // didn't return, which reads as "warming up" downstream rather than as zero.
          slot.series.history[output]?.push(outputs[output] ?? Number.NaN)
        }
      }
    },

    reset() {
      for (const slot of slots) {
        resetIndicatorNode(slot.node)
        for (const output of slot.plugin.outputs) slot.series.history[output] = []
      }
    },

    get series() {
      return slots.map((slot) => slot.series)
    },
  }
}
