import type {
  IndicatorInstance,
  IndicatorPlugin,
  IndicatorRequest,
  IndicatorValues,
  OhlcvBar,
  ParamValues,
} from '@shared/contracts/index.js'

/**
 * Resolving and feeding a tree of indicators.
 *
 * One place, because both in-process hosts need exactly this and for the same
 * reasons: `stopHost.ts` resolves what a stop's `requires()` asked for, and
 * `indicatorFeed.ts` resolves what a *displayed* indicator's `requires()` asked for.
 * Before indicators could declare dependencies the stop host's flat list was enough;
 * a composite indicator makes it a tree, and a tree is worth writing once.
 *
 * ## Depth-first feeding is the whole contract
 *
 * A dependency is fed before the plugin that asked for it, within the same bar. That
 * ordering is what lets a composite treat its inputs as *this* bar's values rather
 * than last bar's — an off-by-one bar in a breakout signal is not a rounding error,
 * it's a different signal. It also means the whole tree advances exactly once per
 * bar, so the caller can't accidentally double-feed a shared branch: nothing is
 * shared. Every request gets its own instance, matching the rule a stop's ATR already
 * follows — a chart overlay being toggled must never alter a number a stop is using.
 *
 * ## Cycles
 *
 * Extending `requires()` from stops to indicators introduces the one hazard that was
 * previously impossible: stops could only ask for indicators, so the graph was
 * bipartite and acyclic by construction. Indicators asking for indicators can cycle,
 * so resolution carries the trail of ids on the current path and refuses to revisit
 * one. Two branches may both use `atr`; a *path* may not.
 */

/** One resolved indicator, plus everything it was built from. */
export interface IndicatorNode {
  /** The plugin's id, for error messages and the cycle trail. */
  typeId: string
  instance: IndicatorInstance
  outputs: readonly string[]
  dependencies: readonly { key: string; node: IndicatorNode }[]
  /** This bar's outputs, refreshed by `feedIndicatorNode`. */
  latest: Record<string, number>
}

/**
 * How deep a chain of `requires()` may go.
 *
 * A second backstop rather than the primary one — the trail below already makes a
 * cycle impossible — but a 40-deep acyclic chain is 40 plugin calls per bar for one
 * line on the chart, which is a cost worth refusing at resolution time where the
 * message can name the chain, not at frame time where it just feels slow.
 */
export const MAX_INDICATOR_DEPTH = 8

export function resolveIndicatorTree(
  request: { indicatorId: string; params: ParamValues },
  registry: ReadonlyMap<string, IndicatorPlugin>,
  /** Ids on the path from the root to here — the cycle guard. */
  trail: readonly string[] = []
): IndicatorNode {
  const plugin = registry.get(request.indicatorId)
  if (!plugin) {
    const via = trail.length > 0 ? ` (required by ${trail.join(' → ')})` : ''
    throw new Error(`No indicator plugin registered with id "${request.indicatorId}"${via}`)
  }
  if (trail.includes(request.indicatorId)) {
    // Named in full: "sma requires sma" is obvious, but a three-hop cycle through
    // someone else's plugin is not, and the path is the only useful thing to say.
    throw new Error(
      `Indicator dependency cycle: ${[...trail, request.indicatorId].join(' → ')}`
    )
  }
  if (trail.length >= MAX_INDICATOR_DEPTH) {
    throw new Error(
      `Indicator dependencies nest more than ${MAX_INDICATOR_DEPTH} deep: ${[
        ...trail,
        request.indicatorId,
      ].join(' → ')}`
    )
  }

  const params = withIndicatorDefaults(plugin, request.params)
  const nextTrail = [...trail, request.indicatorId]
  const requests: IndicatorRequest[] = plugin.requires?.(params) ?? []

  return {
    typeId: plugin.id,
    // Resolved before the instance is created, so a bad tree fails before any plugin
    // state exists to leak.
    dependencies: requests.map((child) => ({
      key: child.key,
      node: resolveIndicatorTree(child, registry, nextTrail),
    })),
    instance: plugin.createInstance(params),
    outputs: plugin.outputs,
    latest: {},
  }
}

/**
 * Advance one node and everything below it by a bar, returning this bar's outputs.
 *
 * Depth-first: children first, then the parent with their values. A missing declared
 * output becomes NaN, which is the warm-up convention every consumer already handles
 * — a plugin that forgets an output reads as "not ready" rather than as zero.
 */
export function feedIndicatorNode(
  node: IndicatorNode,
  bar: OhlcvBar,
  isLastBar: boolean
): Record<string, number> {
  const values: IndicatorValues = {}
  for (const dependency of node.dependencies) {
    values[dependency.key] = feedIndicatorNode(dependency.node, bar, isLastBar)
  }

  const returned = node.instance.onBar(bar, isLastBar, values)
  const latest: Record<string, number> = {}
  for (const output of node.outputs) {
    const value = returned[output]
    latest[output] = typeof value === 'number' ? value : Number.NaN
  }
  node.latest = latest
  return latest
}

/** Reset a node and everything below it. Run start or ticker change only. */
export function resetIndicatorNode(node: IndicatorNode): void {
  node.instance.reset()
  node.latest = {}
  for (const dependency of node.dependencies) resetIndicatorNode(dependency.node)
}

/**
 * The bars a request needs before its outputs mean anything, across its whole tree.
 *
 * The **maximum** rather than the sum: the tree is fed one bar at a time in parallel,
 * so every branch warms simultaneously — summing would preload three hundred bars for a
 * composite whose deepest input needs two hundred. Plus the root's own requirement,
 * since a composite does arithmetic on top of its inputs.
 *
 * Deliberately **tolerant where `resolveIndicatorTree` is strict**: an unknown id, a
 * cycle, or a chain past the depth limit yields what has been measured so far instead of
 * throwing. This runs while deciding how many bars to preload, which is a convenience;
 * the same tree is resolved a moment later by the strict function, and that is where a
 * broken dependency should stop the run — one error, from the place that owns it, rather
 * than an earlier and stranger one from a setting nobody was thinking about.
 */
export function warmupBarsFor(
  request: { indicatorId: string; params: ParamValues },
  registry: ReadonlyMap<string, IndicatorPlugin>,
  trail: readonly string[] = []
): number {
  const plugin = registry.get(request.indicatorId)
  if (!plugin || trail.includes(request.indicatorId) || trail.length >= MAX_INDICATOR_DEPTH) {
    return 0
  }

  const params = withIndicatorDefaults(plugin, request.params)
  const own = plugin.warmupBars?.(params) ?? 0
  const nextTrail = [...trail, request.indicatorId]
  let deepest = 0
  for (const child of plugin.requires?.(params) ?? []) {
    deepest = Math.max(deepest, warmupBarsFor(child, registry, nextTrail))
  }

  // Non-finite or negative from a plugin is treated as nothing rather than poisoning the
  // maximum: this feeds a bar count, and NaN there would preload the whole series.
  const declared = Number.isFinite(own) && own > 0 ? Math.ceil(own) : 0
  return declared + deepest
}

/**
 * Fill any param a request didn't set from the plugin's own `ParamSpec`.
 *
 * A `requires()` that names only the params it cares about is the common case — an
 * ATR stop asking for `{ length: 14 }` shouldn't have to know what else ATR declares
 * — and `undefined` reaching a plugin's arithmetic produces NaN for the whole run.
 */
function withIndicatorDefaults(plugin: IndicatorPlugin, params: ParamValues): ParamValues {
  const resolved: ParamValues = { ...params }
  for (const spec of plugin.params) {
    if (resolved[spec.key] === undefined && typeof spec.default === 'number') {
      resolved[spec.key] = spec.default
    }
  }
  return resolved
}
