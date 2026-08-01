import type { OhlcvBar, ParamSpec, PluginDescriptor } from '@shared/contracts/index.js'
import { instanceLabel } from '@shared/contracts/index.js'
import { DEFAULT_INDICATOR_COLOUR } from '@shared/palette/index.js'
import type { IndicatorFeed, IndicatorSeries } from '@engine/indicators/feed.js'
import type { PluginWorkerClient } from './workerClient.js'
import type { DisplayedIndicatorSpec } from './indicatorFeed.js'
import { resolveOutputStyles } from './indicatorFeed.js'

/**
 * Displayed indicators from sandboxed plugins.
 *
 * Same asynchrony problem as `workerStopHost.ts`, different answer — because the
 * consequences differ. A stop needs its number *before* the next bar can be judged,
 * so it rides the bar-N/bar-N+1 gap. An indicator only needs to be drawn, and a
 * chart line that fills in one frame late is invisible.
 *
 * So each bar pushes `NaN` into the history immediately and **patches that slot when
 * the reply lands**. The array is the same object the renderer holds, so the value
 * appears on the next draw with no notification. `NaN` is already the warm-up
 * convention every renderer skips, which is why the placeholder needs no special
 * case anywhere downstream.
 *
 * A reply that never arrives leaves a permanent gap in the line. Correct: a
 * displayed indicator that fails should draw nothing and stay quiet, unlike a stop,
 * which must be announced. See docs/stops.md#sandboxing-and-hosting for why that
 * asymmetry is deliberate.
 */

export interface WorkerIndicatorFeedOptions {
  active: readonly DisplayedIndicatorSpec[]
  descriptors: ReadonlyMap<string, PluginDescriptor>
  client: PluginWorkerClient
}

interface Slot {
  series: IndicatorSeries
  workerInstanceId: number
  outputs: string[]
}

export async function createWorkerIndicatorFeed({
  active,
  descriptors,
  client,
}: WorkerIndicatorFeedOptions): Promise<IndicatorFeed> {
  const slots: Slot[] = []

  for (const spec of active) {
    const descriptor = descriptors.get(spec.typeId)
    if (!descriptor || descriptor.kind !== 'indicator') continue

    const created = await client.send({
      type: 'create',
      pluginId: spec.typeId,
      params: spec.params,
    })
    // A displayed indicator that can't even be created is dropped silently, and the
    // run proceeds. That is the documented asymmetry: no line is a cosmetic loss.
    if (created.type !== 'created') continue

    const outputs = descriptor.outputs ?? []
    slots.push({
      workerInstanceId: created.instanceId,
      outputs,
      series: {
        instanceId: spec.instanceId,
        // Per instance, from the plugin's own params — the same label the built-in
        // feed produces, so a sandboxed indicator names itself identically.
        displayName: instanceLabel(
          {
            displayName: descriptor.displayName,
            abbreviation: descriptor.abbreviation,
            params: descriptor.params as ParamSpec[],
            labelParams: descriptor.labelParams,
          },
          spec.params
        ),
        colour: spec.colour ?? DEFAULT_INDICATOR_COLOUR,
        paneKind: spec.paneKind ?? descriptor.paneKind ?? 'overlay',
        outputs,
        styles: resolveOutputStyles(outputs, descriptor.outputStyles, spec.outputs),
        fixedRange: descriptor.fixedRange,
        history: Object.fromEntries(outputs.map((output) => [output, [] as number[]])),
      },
    })
  }

  return {
    observeBar(bar: OhlcvBar, isLastBar: boolean) {
      for (const slot of slots) {
        // Reserve the slot now so history length always equals bars played, whatever
        // the worker does or doesn't manage to return.
        const index = (slot.series.history[slot.outputs[0] as string] ?? []).length
        for (const output of slot.outputs) {
          slot.series.history[output]?.push(Number.NaN)
        }

        void client
          .send({
            type: 'indicatorBar',
            instanceId: slot.workerInstanceId,
            bar,
            isLastBar,
            // Empty: a sandboxed indicator's own dependencies aren't resolved yet,
            // the same gap sandboxed stops have. A composite loaded from a file
            // therefore draws nothing rather than wrong numbers, because a missing
            // dependency reads as NaN — see docs/indicators.md#composing-indicators.
            indicators: {},
          })
          .then((response) => {
            if (response.type !== 'outputs') return
            for (const output of slot.outputs) {
              const history = slot.series.history[output]
              const value = response.outputs[output]
              if (history && typeof value === 'number') history[index] = value
            }
          })
      }
    },

    reset() {
      for (const slot of slots) {
        for (const output of slot.outputs) slot.series.history[output] = []
        void client.send({ type: 'reset', instanceId: slot.workerInstanceId })
      }
    },

    get series(): readonly IndicatorSeries[] {
      return slots.map((slot) => slot.series)
    },
  }
}
