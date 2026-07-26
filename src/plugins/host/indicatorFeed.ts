import type { IndicatorPlugin, OhlcvBar } from '@shared/contracts/index.js'
import { instanceLabel } from '@shared/contracts/index.js'
import { DEFAULT_INDICATOR_COLOUR } from '@shared/palette/index.js'
import type { IndicatorFeed, IndicatorSeries } from '@engine/indicators/feed.js'

/**
 * The host-side implementation of the displayed-indicator port.
 *
 * These instances exist **only** to be drawn. Any indicator a stop asked for is a
 * separate instance owned by the stop host — two instances of SMA(20) computing the
 * same numbers, deliberately. That costs a few arithmetic ops per bar and buys two
 * things worth far more: toggling a pane can never change risk management, and the
 * run fingerprint stays honest, since `indicators.*` is excluded from it while
 * `stops.active` is included.
 */

export interface DisplayedIndicatorSpec {
  instanceId: string
  typeId: string
  params: Record<string, number>
  /** Player-chosen line colour. Optional so a caller without one still works. */
  colour?: number
  /** Player's pane override. Unset falls back to the plugin's own `paneKind`. */
  paneKind?: 'overlay' | 'oscillator'
}

export interface IndicatorFeedOptions {
  active: readonly DisplayedIndicatorSpec[]
  registry: ReadonlyMap<string, IndicatorPlugin>
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
      fixedRange: plugin.fixedRange,
      history: Object.fromEntries(plugin.outputs.map((output) => [output, [] as number[]])),
    }
    return { spec, plugin, instance: plugin.createInstance(spec.params), series }
  })

  return {
    observeBar(bar: OhlcvBar, isLastBar: boolean) {
      for (const slot of slots) {
        // Incremental, one value per bar, rather than a full recompute of the series
        // every frame — that's what keeps cost bounded as a run gets longer.
        const outputs = slot.instance.onBar(bar, isLastBar)
        for (const output of slot.plugin.outputs) {
          const value = outputs[output]
          // A plugin returning nothing for a declared output gets NaN, which reads
          // as "warming up" downstream rather than as zero.
          slot.series.history[output]?.push(typeof value === 'number' ? value : Number.NaN)
        }
      }
    },

    reset() {
      for (const slot of slots) {
        slot.instance.reset()
        for (const output of slot.plugin.outputs) slot.series.history[output] = []
      }
    },

    get series() {
      return slots.map((slot) => slot.series)
    },
  }
}
