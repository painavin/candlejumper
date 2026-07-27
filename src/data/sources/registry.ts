import type { DatasetCache, HttpTransport, PriceSeriesSource } from '@shared/contracts/index.js'
import { createBundledSource } from './bundled.js'
import { createSyntheticSource } from './synthetic.js'
import { createLibrarySource } from './library.js'
import type { PriceProvider } from './providers/index.js'

/**
 * Sources are switchable at runtime, not a build-time choice — the interface
 * costs nothing extra to make dynamic, and it keeps a live API source from
 * becoming a fork of the app later.
 *
 * Three sources: the bundled files, the synthetic series, and the **library** of
 * whatever the player has downloaded or imported. Which *provider* a download comes
 * from is a choice inside the library, made per download, rather than a fourth and
 * fifth source that would behave identically once the data was cached.
 */
export interface SourceRegistryOptions {
  /**
   * What the library needs: a transport, and somewhere to cache.
   *
   * Optional because a headless caller — a test, or any environment with no storage —
   * should still get the bundled and synthetic sources rather than a registry that
   * refuses to be built. When it's absent, the library isn't registered, and
   * `validateConfig` then rejects a config that asks for it by name.
   */
  downloads?: {
    transport: HttpTransport
    cache: DatasetCache
    /** Per-provider base URL overrides, keyed by provider id. Used by the dev proxy. */
    baseUrls?: Readonly<Record<string, string>>
    now?: () => number
    /** Defaults to the shipped list. */
    providers?: readonly PriceProvider[]
  }
}

export function createSourceRegistry({
  downloads,
}: SourceRegistryOptions = {}): Map<string, PriceSeriesSource> {
  const registry = new Map<string, PriceSeriesSource>()
  const sources = [
    createBundledSource(),
    createSyntheticSource(),
    ...(downloads ? [createLibrarySource(downloads)] : []),
  ]
  for (const source of sources) {
    registry.set(source.id, source)
  }
  return registry
}
