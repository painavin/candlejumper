import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import { createMemoryStore } from '@platform/persistence/index.js'
import type { KeyValueStore } from '@platform/persistence/index.js'
import { readStoredConfig, writeStoredConfig } from './configStore.js'

/**
 * The seam between the pure settings shape and the platform store. The parsing itself
 * is covered in `config/storedConfig.test.ts`; what's tested here is that the right
 * key is used, that a first run works, and that a store which loses writes is survivable.
 */

const defaults = defaultConfig()
const options = { defaults, systemReducedMotion: false }

describe('readStoredConfig', () => {
  it('returns defaults on a first run', async () => {
    expect(await readStoredConfig(createMemoryStore(), options)).toEqual(defaults)
  })

  it('round-trips settings', async () => {
    const store = createMemoryStore()
    const config = defaultConfig()
    config.scrollSpeed = 7
    config.audio.musicMuted = true
    config.data = { source: 'downloaded', ticker: 'INTC' }

    await writeStoredConfig(store, config)
    expect(await readStoredConfig(store, options)).toEqual(config)
  })

  it('uses its own key, leaving the save file alone', async () => {
    // Settings and records have different lifecycles and different failure tolerance,
    // and a corrupt one must not take the other down.
    const store = createMemoryStore()
    await store.save('save', { version: 1, personalBests: { abc: 1 } })
    await writeStoredConfig(store, defaults)

    expect(await store.load('save')).toEqual({ version: 1, personalBests: { abc: 1 } })
    expect(await store.load('config')).toBeDefined()
  })

  it('falls back to defaults for a corrupt entry rather than throwing', async () => {
    const store = createMemoryStore()
    await store.save('config', 'not settings')
    expect(await readStoredConfig(store, options)).toEqual(defaults)
  })

  it('resolves reduced motion from the system when nothing was overridden', async () => {
    const store = createMemoryStore()
    await writeStoredConfig(store, defaults)
    const parsed = await readStoredConfig(store, { defaults, systemReducedMotion: true })
    expect(parsed.visuals.reducedMotion).toBe(true)
  })
})

describe('writeStoredConfig', () => {
  it('tolerates a store that silently drops writes', async () => {
    // Private browsing, or a full quota. Unlike a dataset, a lost preference must not
    // stop the player leaving the settings screen.
    const inner = createMemoryStore()
    const lossy: KeyValueStore = {
      load: (key) => inner.load(key),
      async save() {
        // Swallowed, exactly as createLocalStorageStore does.
      },
      remove: (key) => inner.remove(key),
    }
    await expect(writeStoredConfig(lossy, defaults)).resolves.toBeUndefined()
    expect(await readStoredConfig(lossy, options)).toEqual(defaults)
  })
})
