import type { PriceSeriesSource } from '@shared/contracts/index.js'
import { createBundledSource } from './bundled.js'
import { createSyntheticSource } from './synthetic.js'

/**
 * Sources are switchable at runtime, not a build-time choice — the interface
 * costs nothing extra to make dynamic, and it keeps a live API source from
 * becoming a fork of the app later.
 */
export function createSourceRegistry(): Map<string, PriceSeriesSource> {
  const registry = new Map<string, PriceSeriesSource>()
  for (const source of [createBundledSource(), createSyntheticSource()]) {
    registry.set(source.id, source)
  }
  return registry
}
