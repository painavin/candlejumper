/**
 * The bundled OHLCV datasets.
 *
 * They live under `src/data/datasets/` rather than at the repo root so that nothing
 * in the project ever reaches outside `src/`. That removes the one documented
 * exemption the import-zone rules used to carry, which is worth more than keeping
 * the data visually separate from the code.
 *
 * Loaded lazily via glob, so each dataset becomes its own chunk (~33–39 kB) instead
 * of ~110 kB of JSON in the main bundle. That also matches the async
 * `PriceSeriesSource.loadSeries` contract rather than fighting it.
 */

/** Raw JSON module shape — validated before it's trusted as `OhlcvBar[]`. */
type RawDataset = { default: unknown }

const modules = import.meta.glob<RawDataset>('./datasets/*.Daily.json')

/** `./datasets/AAPL.Daily.json` → `AAPL` */
function symbolOf(path: string): string {
  return path.split('/').pop()?.split('.')[0] ?? path
}

export function bundledSymbols(): string[] {
  return Object.keys(modules).map(symbolOf).sort()
}

export async function loadBundledJson(symbol: string): Promise<unknown> {
  const entry = Object.entries(modules).find(([path]) => symbolOf(path) === symbol)
  if (!entry) {
    throw new Error(
      `No bundled dataset for "${symbol}". Available: ${bundledSymbols().join(', ')}`
    )
  }
  const loaded = await entry[1]()
  return loaded.default
}
