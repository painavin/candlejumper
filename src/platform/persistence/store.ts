/**
 * Persistence.
 *
 * One narrow interface, one implementation per platform, and nothing outside this
 * folder knows which platform it's on. `platform/` is also the only zone allowed
 * to import native bridge APIs, which is why the Tauri and Capacitor
 * implementations will live here rather than beside their callers.
 *
 * Two rules from docs/tech-stack.md#persistence, both load-bearing:
 *
 *   - **Versioned from the first write**, so a later schema change doesn't
 *     silently discard someone's accumulated stats.
 *   - **All persisted data is untrusted on read.** A corrupt or hand-edited file
 *     falls back to defaults rather than crashing the app.
 */

export interface KeyValueStore {
  load(key: string): Promise<unknown>
  save(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export const STORAGE_NAMESPACE = 'candlejumper'

/**
 * Namespaces this app has used before, oldest first. The project was called Candle
 * Runner until the rename, and the namespace prefixes every key — so without this,
 * renaming it would orphan every save: personal bests, lifetime stats, settings,
 * imported plugins, and the whole downloaded price library.
 *
 * Safe to delete once no install can still be carrying the old prefix.
 */
export const LEGACY_NAMESPACES = ['candlerunner']

/**
 * Move any keys left under an old namespace across to the current one, once.
 *
 * Never overwrites an entry that already exists under the current namespace — a
 * player who has already played since the rename has newer data, and a stale
 * pre-rename blob must not clobber it. The old key is removed either way, so this
 * is idempotent and stops finding work after the first run.
 */
function migrateLegacyNamespaces(namespace: string): void {
  const storage = globalThis.localStorage
  if (!storage) return

  for (const legacy of LEGACY_NAMESPACES) {
    if (legacy === namespace) continue
    const prefix = `${legacy}:`

    try {
      // Collected before mutating: removing entries mid-scan shifts the indices.
      const stale: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith(prefix)) stale.push(key)
      }

      for (const key of stale) {
        const current = `${namespace}:${key.slice(prefix.length)}`
        const value = storage.getItem(key)
        if (value !== null && storage.getItem(current) === null) {
          storage.setItem(current, value)
        }
        storage.removeItem(key)
      }
    } catch {
      // Private browsing, a full quota, or storage blocked outright. The player
      // loses history they'd have lost anyway; starting the app matters more.
    }
  }
}

/** Browser and both native shells' web views. Desktop/mobile adapters slot in here. */
export function createLocalStorageStore(namespace = STORAGE_NAMESPACE): KeyValueStore {
  const scoped = (key: string): string => `${namespace}:${key}`

  migrateLegacyNamespaces(namespace)

  return {
    async load(key) {
      try {
        const raw = globalThis.localStorage?.getItem(scoped(key))
        return raw === null || raw === undefined ? undefined : JSON.parse(raw)
      } catch {
        // Untrusted on read: a corrupt entry must not take the app down.
        return undefined
      }
    },

    async save(key, value) {
      try {
        globalThis.localStorage?.setItem(scoped(key), JSON.stringify(value))
      } catch {
        // Private browsing or a full quota. Losing a personal best is bad; failing
        // to start the next run over it would be worse.
      }
    },

    async remove(key) {
      try {
        globalThis.localStorage?.removeItem(scoped(key))
      } catch {
        // Same reasoning as save().
      }
    },
  }
}

/** An in-memory store, for tests and for a platform with no storage at all. */
export function createMemoryStore(): KeyValueStore {
  const values = new Map<string, string>()
  return {
    async load(key) {
      const raw = values.get(key)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
    async save(key, value) {
      values.set(key, JSON.stringify(value))
    },
    async remove(key) {
      values.delete(key)
    },
  }
}
