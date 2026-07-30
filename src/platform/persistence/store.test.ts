import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEGACY_NAMESPACES,
  STORAGE_NAMESPACE,
  createLocalStorageStore,
  createMemoryStore,
} from './store.js'

/**
 * The namespace sweep, which is the one part of the Candle Runner → Candle Jumper
 * rename that can destroy data. Every key is prefixed with the namespace, so a
 * rename with no migration silently orphans personal bests, settings, imported
 * plugins, and the whole downloaded price library.
 */

const [LEGACY] = LEGACY_NAMESPACES

/** A minimal localStorage: real enough for `length`/`key(i)` iteration. */
function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    snapshot: () => Object.fromEntries(values),
  }
}

function install(storage: ReturnType<typeof fakeStorage>): void {
  vi.stubGlobal('localStorage', storage)
}

beforeEach(() => {
  install(fakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the legacy namespace sweep', () => {
  it('moves every old key across, whatever it is called', () => {
    // Prefix-driven rather than a hardcoded list of four, so a key added later
    // doesn't get left behind by a migration nobody remembered to update.
    const storage = fakeStorage({
      [`${LEGACY}:save`]: '{"version":1}',
      [`${LEGACY}:config`]: '{"scrollSpeed":7}',
      [`${LEGACY}:plugins`]: '[]',
      [`${LEGACY}:datasets`]: '{"INTC":{}}',
      'unrelated:thing': 'someone else',
    })
    install(storage)

    createLocalStorageStore()

    expect(storage.snapshot()).toEqual({
      [`${STORAGE_NAMESPACE}:save`]: '{"version":1}',
      [`${STORAGE_NAMESPACE}:config`]: '{"scrollSpeed":7}',
      [`${STORAGE_NAMESPACE}:plugins`]: '[]',
      [`${STORAGE_NAMESPACE}:datasets`]: '{"INTC":{}}',
      'unrelated:thing': 'someone else',
    })
  })

  it('makes migrated data readable through the store', async () => {
    install(fakeStorage({ [`${LEGACY}:datasets`]: '{"INTC":{"symbol":"INTC"}}' }))
    const store = createLocalStorageStore()
    expect(await store.load('datasets')).toEqual({ INTC: { symbol: 'INTC' } })
  })

  it('keeps newer data when both namespaces hold the same key', async () => {
    // Load-bearing: a player who has already played since the rename must not have
    // their current save replaced by whatever was left over from before it.
    const storage = fakeStorage({
      [`${LEGACY}:save`]: '{"stale":true}',
      [`${STORAGE_NAMESPACE}:save`]: '{"current":true}',
    })
    install(storage)

    const store = createLocalStorageStore()

    expect(await store.load('save')).toEqual({ current: true })
    // And the loser is cleared out rather than left to be re-examined every boot.
    expect(storage.getItem(`${LEGACY}:save`)).toBeNull()
  })

  it('is idempotent, and a second construction finds nothing to do', async () => {
    const storage = fakeStorage({ [`${LEGACY}:config`]: '{"scrollSpeed":7}' })
    install(storage)

    createLocalStorageStore()
    const store = createLocalStorageStore()

    expect(await store.load('config')).toEqual({ scrollSpeed: 7 })
    expect(storage.snapshot()).toEqual({ [`${STORAGE_NAMESPACE}:config`]: '{"scrollSpeed":7}' })
  })

  it('does nothing when the namespace asked for is the legacy one', async () => {
    // An explicit namespace is a caller saying what it wants; migrating a store
    // onto itself would delete the very keys it was opened to read.
    const storage = fakeStorage({ [`${LEGACY}:save`]: '{"version":1}' })
    install(storage)

    const store = createLocalStorageStore(LEGACY)
    expect(await store.load('save')).toEqual({ version: 1 })
  })

  it('survives storage that throws on every access', () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('storage disabled')
      },
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })

    // Private browsing or a blocked origin. Losing history is bad; refusing to
    // boot over it is worse.
    expect(() => createLocalStorageStore()).not.toThrow()
  })

  it('survives no storage at all', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => createLocalStorageStore()).not.toThrow()
  })
})

describe('createLocalStorageStore', () => {
  it('scopes keys under the current namespace', async () => {
    const storage = fakeStorage()
    install(storage)

    await createLocalStorageStore().save('config', { scrollSpeed: 7 })
    expect(storage.getItem(`${STORAGE_NAMESPACE}:config`)).toBe('{"scrollSpeed":7}')
  })

  it('reads a corrupt entry as absent rather than throwing', async () => {
    install(fakeStorage({ [`${STORAGE_NAMESPACE}:save`]: 'not json{' }))
    expect(await createLocalStorageStore().load('save')).toBeUndefined()
  })

  it('removes what it wrote', async () => {
    const storage = fakeStorage()
    install(storage)

    const store = createLocalStorageStore()
    await store.save('config', { a: 1 })
    await store.remove('config')

    expect(storage.snapshot()).toEqual({})
  })
})

describe('createMemoryStore', () => {
  it('round-trips and forgets, with no namespace involved', async () => {
    const store = createMemoryStore()
    expect(await store.load('config')).toBeUndefined()

    await store.save('config', { scrollSpeed: 7 })
    expect(await store.load('config')).toEqual({ scrollSpeed: 7 })

    await store.remove('config')
    expect(await store.load('config')).toBeUndefined()
  })
})
