import type { IndicatorPlugin, StopPlugin } from '@shared/contracts/index.js'
import { builtinIndicators, builtinStops } from '../builtin/index.js'

/**
 * The plugin registries.
 *
 * Built-ins are seeded here; user-loaded plugins join the same maps at the loading
 * surface, having passed contract validation in the worker sandbox first. Nothing
 * downstream can tell the two apart, which is the point.
 */

export function createStopRegistry(extra: readonly StopPlugin[] = []): Map<string, StopPlugin> {
  const registry = new Map<string, StopPlugin>()
  for (const plugin of [...builtinStops, ...extra]) registry.set(plugin.id, plugin)
  return registry
}

export function createIndicatorRegistry(
  extra: readonly IndicatorPlugin[] = []
): Map<string, IndicatorPlugin> {
  const registry = new Map<string, IndicatorPlugin>()
  for (const plugin of [...builtinIndicators, ...extra]) registry.set(plugin.id, plugin)
  return registry
}
