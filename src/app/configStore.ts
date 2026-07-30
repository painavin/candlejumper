import type { RunConfig } from '@config/index.js'
import { parseStoredConfig, toStoredConfig } from '@config/index.js'
import type { KeyValueStore } from '@platform/persistence/index.js'

/**
 * Settings persistence: the store call, and nothing else.
 *
 * The shape and all the untrusted-read logic live in `config/storedConfig.ts`, which
 * is pure. This exists because `config/` may only import `@shared` and the store is a
 * platform concern — the same seam as `datasetCache.ts`, and for the same reason.
 *
 * ## Its own key, not part of the save file
 *
 * `candlejumper:config`, separate from `candlejumper:save`. Four reasons, and the last
 * is the one that decided it:
 *
 *   - different lifecycles — settings change when the player presses OK, records change
 *     when a run ends;
 *   - different failure tolerance — losing a preference is a shrug, losing a personal
 *     best is not;
 *   - `save` is versioned by `fingerprintVersion`, which has nothing to say about
 *     preferences and would drag them into an unrelated migration;
 *   - one corrupt blob can't take the other down, and "reset my settings" stays
 *     independent of "erase my history".
 *
 * ## Write failures are tolerated here
 *
 * Unlike the dataset cache, this doesn't read back to confirm the write. A dataset is a
 * run's *input* and silently losing one breaks the game; a preference that doesn't
 * survive a reload in private browsing is a minor annoyance, and refusing to leave the
 * settings screen over it would be worse than the problem.
 */

const KEY = 'config'

export interface ConfigStoreOptions {
  defaults: RunConfig
  /** What `prefers-reduced-motion` currently says. */
  systemReducedMotion: boolean
}

/** The stored settings, or defaults. Never throws. */
export async function readStoredConfig(
  store: KeyValueStore,
  options: ConfigStoreOptions
): Promise<RunConfig> {
  return parseStoredConfig(await store.load(KEY), options)
}

export async function writeStoredConfig(store: KeyValueStore, config: RunConfig): Promise<void> {
  await store.save(KEY, toStoredConfig(config))
}
