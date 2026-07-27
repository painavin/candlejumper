import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '@platform/persistence/index.js'
import type { KeyValueStore } from '@platform/persistence/index.js'
import { createDatasetCache } from './datasetCache.js'

/**
 * The seam between `data/`'s cache port and the platform's key-value store. Its one
 * non-obvious job is refusing to pretend a write happened — see the read-back note in
 * datasetCache.ts.
 */

const entry = (symbol: string, bars: number) => ({
  symbol,
  provider: 'yahoo',
  history: '1y',
  downloadedAtMs: 1,
  bars: Array.from({ length: bars }, (_, i) => ({
    o: 10,
    h: 11,
    l: 9,
    c: 10,
    v: 1,
    t: 1_700_000_000 + i * 86_400,
  })),
})

/** A store that accepts nothing, like localStorage at quota — silently, as it does. */
function fullStore(): KeyValueStore {
  const inner = createMemoryStore()
  return {
    load: (key) => inner.load(key),
    async save() {
      // Swallowed, exactly as createLocalStorageStore does.
    },
    remove: (key) => inner.remove(key),
  }
}

describe('createDatasetCache', () => {
  it('round-trips entries', async () => {
    const cache = createDatasetCache(createMemoryStore())
    await cache.save({ AAPL: entry('AAPL', 3) })
    expect(Object.keys(await cache.load())).toEqual(['AAPL'])
  })

  it('starts empty rather than throwing on a first run', async () => {
    expect(await createDatasetCache(createMemoryStore()).load()).toEqual({})
  })

  it('returns an empty record for stored junk', async () => {
    const store = createMemoryStore()
    await store.save('datasets', 'not a record')
    expect(await createDatasetCache(store).load()).toEqual({})
  })

  it('is one central library, so a symbol written twice is replaced', async () => {
    // A symbol names a series. Re-obtaining it — from any provider, or from a file —
    // replaces it, and the run fingerprint keeps the records apart by bar count.
    const store = createMemoryStore()
    await createDatasetCache(store).save({ AAPL: entry('AAPL', 3) })
    await createDatasetCache(store).save({ AAPL: entry('AAPL', 9) })

    const stored = await createDatasetCache(store).load()
    expect(Object.keys(stored)).toEqual(['AAPL'])
    expect((stored.AAPL as { bars: unknown[] }).bars).toHaveLength(9)
  })

  it('throws when the write did not stick', async () => {
    // The whole reason this adapter exists rather than passing the store through.
    const cache = createDatasetCache(fullStore())
    await expect(cache.save({ AAPL: entry('AAPL', 3) })).rejects.toThrow(/storage is full/i)
  })

  it('names a size in the quota message, so it is actionable', async () => {
    const cache = createDatasetCache(fullStore())
    await expect(cache.save({ AAPL: entry('AAPL', 1_000) })).rejects.toThrow(/kB of datasets/)
  })

  it('detects a rejected refresh, where the key count is unchanged', async () => {
    // The case a key-count check would miss: same symbols, stale bars.
    const inner = createMemoryStore()
    let accepting = true
    const store: KeyValueStore = {
      load: (key) => inner.load(key),
      async save(key, value) {
        if (accepting) await inner.save(key, value)
      },
      remove: (key) => inner.remove(key),
    }
    const cache = createDatasetCache(store)
    await cache.save({ AAPL: entry('AAPL', 3) })

    accepting = false
    await expect(cache.save({ AAPL: entry('AAPL', 4) })).rejects.toThrow(/storage is full/i)
  })
})
