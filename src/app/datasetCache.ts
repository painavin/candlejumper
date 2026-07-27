import type { CachedDataset, DatasetCache } from '@shared/contracts/index.js'
import type { KeyValueStore } from '@platform/persistence/index.js'

/**
 * The dataset cache, implemented over whatever key-value store the platform gave us.
 *
 * Lives in `app/` because it's the seam between two zones that may not import each
 * other: `data/` defines what it needs (`DatasetCache`, in `@shared`) and
 * `platform/persistence` provides the storage. Composition is this zone's job.
 *
 * ## One key, not one per symbol
 *
 * `KeyValueStore` cannot enumerate keys, so a symbol-per-key layout would need an
 * index key kept in step with the entries — two writes that can disagree. A single
 * record is one atomic write instead, at the cost of rewriting the whole blob per
 * download, which happens once per explicit button press.
 *
 * ## The read-back
 *
 * `createLocalStorageStore` deliberately swallows write failures: losing a personal
 * best is bad, and failing to start the next run over it would be worse. That trade
 * is wrong for a dataset, which is a run's *input* — a download that silently didn't
 * persist looks like it worked until the next reload, and then the ticker is simply
 * gone. So this checks, and the `DatasetCache` contract requires it to throw. Storage
 * quotas are the expected reason: a few dozen downloaded tickers will reach one.
 */

/**
 * One central library, not one cache per provider: a symbol names a series, and
 * obtaining it again — from anywhere — replaces it. See `DatasetCache`.
 */
const KEY = 'datasets'

export function createDatasetCache(store: KeyValueStore): DatasetCache {
  const key = KEY
  return {
    async load(): Promise<Record<string, unknown>> {
      const raw = await store.load(key)
      // Untrusted on read: the individual entries are validated by the source, but
      // the container has to be a container first.
      return isRecord(raw) ? raw : {}
    },

    async save(entries: Record<string, unknown>): Promise<void> {
      await store.save(key, entries)
      const written = await store.load(key)
      if (!isRecord(written) || !same(written, entries)) {
        throw new Error(
          `Couldn't save the downloaded data — browser storage is full (about ${describeSize(entries)} of ` +
            `datasets). Remove a downloaded ticker, or download a shorter history, and try again.`
        )
      }
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether what came back is what went in.
 *
 * Compared by serialisation rather than by key count, because the failure that
 * matters most is a *refresh* being rejected: same symbols, same number of keys,
 * stale bars. The read side is a `JSON.parse` of the same text this would produce, so
 * insertion order and number formatting both round-trip exactly.
 */
function same(written: Record<string, unknown>, entries: Record<string, unknown>): boolean {
  return JSON.stringify(written) === JSON.stringify(entries)
}

/** Roughly how much is being asked for, so the quota message isn't abstract. */
function describeSize(entries: Record<string, unknown>): string {
  const bars = Object.values(entries).reduce<number>((total, entry) => {
    const dataset = entry as Partial<CachedDataset>
    return total + (Array.isArray(dataset.bars) ? dataset.bars.length : 0)
  }, 0)
  // ~70 bytes of JSON per bar, measured against the bundled files.
  return `${Math.max(1, Math.round((bars * 70) / 1024))} kB`
}
