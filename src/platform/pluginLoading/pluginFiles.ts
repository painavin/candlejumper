/**
 * Getting plugin *source text* into the app.
 *
 * Deliberately the only thing this folder does. It reads bytes and remembers them;
 * it never evaluates anything. Evaluation happens inside the Web Worker, which is
 * the trust boundary — see `plugins/worker/pluginWorker.ts`. Splitting "obtain" from
 * "execute" is what lets the loading surface differ per platform without
 * multiplying the number of places untrusted code can run.
 *
 * docs/indicators.md#plugin-loading--sandboxing describes two surfaces: a watched
 * folder on desktop (Tauri) and an in-app import flow on mobile (Capacitor). Since
 * neither shell is packaged yet (roadmap step 11), what ships is the **web** import
 * flow, which is also the one Capacitor will use. The Tauri folder watcher slots in
 * as a second function here and nothing downstream changes.
 */

import { pickTextFiles } from '../fileImport/files.js'
import type { KeyValueStore } from '../persistence/store.js'

export interface PluginFile {
  /** Stable identity for the imported file — the filename, deduped on import. */
  name: string
  kind: 'stop' | 'indicator'
  /** Module source. Never evaluated in this zone. */
  source: string
}

const KEY = 'plugins'

/**
 * Open a file picker and read what the player chose.
 *
 * The picker itself lives in `../fileImport/`, because price-data import needs exactly
 * the same thing and the fiddly parts — a cancelled picker fires no `change` event in
 * most browsers — are worth having once.
 */
export async function importPluginFiles(kind: 'stop' | 'indicator'): Promise<PluginFile[]> {
  const files = await pickTextFiles('.js,.mjs,text/javascript')
  return files.map((file) => ({ name: file.name, kind, source: file.text }))
}

/**
 * Plugins persisted from a previous session.
 *
 * Source text is stored rather than a path, because a browser cannot re-read a file
 * the player picked last week — and on mobile there is no stable path to re-read
 * anyway. The cost is honest: editing the file on disk means re-importing it.
 */
export async function loadStoredPlugins(store: KeyValueStore): Promise<PluginFile[]> {
  const raw = await store.load(KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter(isPluginFile)
}

export async function storePlugins(store: KeyValueStore, files: PluginFile[]): Promise<void> {
  await store.save(KEY, files)
}

/** Add imports to the stored set, replacing any with the same name. */
export function mergePlugins(existing: PluginFile[], added: PluginFile[]): PluginFile[] {
  const byName = new Map(existing.map((file) => [file.name, file]))
  for (const file of added) byName.set(file.name, file)
  return [...byName.values()]
}

function isPluginFile(value: unknown): value is PluginFile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PluginFile>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.source === 'string' &&
    (candidate.kind === 'stop' || candidate.kind === 'indicator')
  )
}
