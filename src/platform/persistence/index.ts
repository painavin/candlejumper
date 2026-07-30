export {
  createLocalStorageStore,
  createMemoryStore,
  STORAGE_NAMESPACE,
  LEGACY_NAMESPACES,
} from './store.js'
export type { KeyValueStore } from './store.js'
export {
  loadSave,
  writeSave,
  recordRun,
  emptySave,
  PERSISTENCE_VERSION,
} from './save.js'
export type { SaveData, PersonalBest, LifetimeStats } from './save.js'
