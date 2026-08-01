// Relative, not aliased: shared/ imports nothing at all, including itself through
// its own alias — that's what makes it the base of the dependency graph.
import type { OhlcvBar } from './bar.js'
import type { IndicatorInstance, IndicatorOutputStyle, IndicatorPlugin } from './indicator.js'
import type { PositionState, StopInstance, StopPlugin } from './stop.js'

/**
 * The wire protocol between the host and the plugin worker.
 *
 * Lives in `shared/` because both sides need it and `plugins/worker/` may import
 * **nothing but `shared/`** — that restriction is the trust boundary, and a shared
 * protocol type is the only thing that can legitimately cross it.
 */

export type WorkerRequest =
  | { type: 'load'; id: number; kind: 'stop' | 'indicator'; source: string }
  | { type: 'create'; id: number; pluginId: string; params: Record<string, number> }
  | { type: 'requires'; id: number; pluginId: string; params: Record<string, number> }
  | { type: 'reset'; id: number; instanceId: number }
  | {
      type: 'stopBar'
      id: number
      instanceId: number
      bar: OhlcvBar
      position: PositionState
      indicators: Record<string, Record<string, number>>
    }
  | {
      type: 'indicatorBar'
      id: number
      instanceId: number
      bar: OhlcvBar
      isLastBar: boolean
      /**
       * This bar's values from whatever the indicator's `requires()` asked for.
       *
       * Carried even though both current hosts send `{}` — the in-process feed
       * resolves its own trees and never reaches the worker, and a sandboxed
       * indicator's dependencies aren't resolved yet, exactly as a sandboxed *stop*'s
       * aren't (see `workerStopHost.ts`). The field is here so the worker's call
       * matches the contract rather than dropping the argument, which would make a
       * composite silently read `undefined` the day that resolution lands.
       */
      indicators: Record<string, Record<string, number>>
    }

export type WorkerResponse =
  | { type: 'loaded'; id: number; descriptor: PluginDescriptor }
  | { type: 'created'; id: number; instanceId: number }
  | { type: 'requires'; id: number; requests: { key: string; indicatorId: string; params: Record<string, number> }[] }
  | { type: 'level'; id: number; level: number | null }
  | { type: 'outputs'; id: number; outputs: Record<string, number> }
  | { type: 'ok'; id: number }
  | { type: 'failed'; id: number; message: string }

/**
 * What the host learns about a loaded plugin. Deliberately data-only: the functions
 * stay inside the worker, which is what keeps the boundary meaningful.
 */
export interface PluginDescriptor {
  kind: 'stop' | 'indicator'
  id: string
  displayName: string
  /** Short form for chart legends. Indicators only. */
  abbreviation?: string
  /** Which params appear in the legend label. Indicators only; unset means all. */
  labelParams?: string[]
  params: unknown[]
  paneKind?: 'overlay' | 'oscillator'
  outputs?: string[]
  /** Per-output draw style. Indicators only. */
  outputStyles?: Record<string, IndicatorOutputStyle>
  fixedRange?: [number, number]
  declaresRequires: boolean
}

export function describePlugin(
  plugin: StopPlugin | IndicatorPlugin,
  kind: 'stop' | 'indicator'
): PluginDescriptor {
  const indicator = plugin as IndicatorPlugin
  return {
    kind,
    id: plugin.id,
    displayName: plugin.displayName,
    abbreviation: kind === 'indicator' ? indicator.abbreviation : undefined,
    labelParams: kind === 'indicator' ? indicator.labelParams : undefined,
    params: plugin.params,
    paneKind: kind === 'indicator' ? indicator.paneKind : undefined,
    outputs: kind === 'indicator' ? indicator.outputs : undefined,
    outputStyles: kind === 'indicator' ? indicator.outputStyles : undefined,
    fixedRange: kind === 'indicator' ? indicator.fixedRange : undefined,
    // Not gated on kind: indicators declare `requires()` too, and reporting `false`
    // for one that has it would tell the host it needs nothing.
    declaresRequires: typeof (plugin as StopPlugin).requires === 'function',
  }
}

export type AnyInstance = StopInstance | IndicatorInstance
