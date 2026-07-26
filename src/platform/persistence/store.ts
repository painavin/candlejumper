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

/** Browser and both native shells' web views. Desktop/mobile adapters slot in here. */
export function createLocalStorageStore(namespace = 'candlerunner'): KeyValueStore {
  const scoped = (key: string): string => `${namespace}:${key}`

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
