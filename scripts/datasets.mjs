// @ts-check
import { gunzipSync, gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Rebuilds `public/datasets/manifest.json`, and compresses the datasets beside it.
 *
 * Run it after adding, removing, or refreshing a dataset:
 *
 *     npm run datasets
 *
 * Drop in either `SYMBOL.Interval.json` or an already-compressed `.json.gz`; plain JSON is
 * gzipped and the original removed, so what ships is only ever the compressed form.
 *
 * ## Why a manifest exists at all
 *
 * The bundled source has to answer "what series are available, how many bars, over what
 * dates" before the player picks anything. It used to answer that by **loading every
 * dataset** — fine for three files, fatal for six hundred: the browser downloaded 64 MB
 * before the title screen appeared, and the same code path exhausted a 4 GB Node heap
 * under test. The manifest is that answer precomputed, so the catalogue costs one small
 * request and a dataset is fetched only when it is actually played.
 *
 * ## Why the datasets are stored gzipped
 *
 * For the **deploy**, not the download. Azure Static Web Apps already compresses text
 * responses in flight, so a plain 472 kB dataset was already arriving as ~123 kB; storing
 * it compressed changes what sits on disk, and that is what a static-site size cap
 * measures. 242 MB becomes 63 MB, which turns a deploy sitting exactly on the Free tier's
 * 250 MB ceiling into one with room to grow.
 *
 * It also settled a question that was open: a columnar array-of-arrays record format saves
 * 34% uncompressed and **13 kB of 123** once gzipped, because gzip was already eliminating
 * the repeated key names the format change was for. Not worth migrating the data for.
 *
 * Gzip rather than brotli, which would be another 25% smaller, because `DecompressionStream`
 * — the browser API that inflates these — has no brotli. Brotli would mean either a wasm
 * decoder in the bundle, defeating the point, or a `Content-Encoding` header that cannot be
 * tested before it is deployed and fails as binary garbage.
 *
 * ## Why this is a script and not a build step
 *
 * It reads and reparses every dataset, which is hundreds of megabytes of I/O. The data is
 * static, so paying that on every `vite build` and every CI run would be pure waste. The
 * manifest is committed alongside the data it describes, and `data.test.ts` checks the two
 * agree so a forgotten run fails a test rather than shipping.
 *
 * ## Deliberately dumb
 *
 * It emits file names and counts, nothing interpreted. Which ticker and interval a file
 * name means, and how a missing or malformed entry is handled, live in
 * `src/data/datasets.ts` where they are typed and tested. A script that can't be imported
 * by the app is the wrong place for a rule the app depends on.
 */

const DIR = 'public/datasets'
const MANIFEST = 'manifest.json'

/**
 * Single-bar close move worth a second look, as a fraction.
 *
 * The same 0.5 `maxBarMoveFor` uses for a daily bar, and here for the same reason — an
 * unadjusted 2:1 split reads as a 50% crash — but with a **different consequence**. The
 * loader used to reject a series over this, which cannot work against full market history:
 * Apple really did fall 51.9% on 2000-09-29 and SVXY really did lose 83% on 2018-02-06, and
 * neither is distinguishable by magnitude from a split. So the threshold reports here
 * instead, where a person can tell a crisis rally from a leveraged ETF's reverse split, and
 * the loader keeps only the structural checks. See `src/data/sources/bundled.ts`.
 */
const SPLIT_SUSPICION = 0.5

const files = readdirSync(DIR)
  .filter((name) => name !== MANIFEST && (name.endsWith('.json') || name.endsWith('.json.gz')))
  .sort()

/** @type {{ file: string, barCount: number, firstBarTime: number, lastBarTime: number }[]} */
const entries = []
/** @type {{ file: string, move: number, at: number }[]} */
const outliers = []
let compressed = 0

for (const name of files) {
  const wasPlain = !name.endsWith('.gz')
  const file = wasPlain ? `${name}.gz` : name
  const source = join(DIR, name)
  const target = join(DIR, file)

  const raw = readFileSync(source)
  // Gzip is self-describing, so the extension is a convenience and the magic number is the
  // truth. Read either shape, whatever it happens to be called.
  const json = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
  const bars = JSON.parse(json.toString('utf8'))

  if (!Array.isArray(bars) || bars.length === 0) {
    throw new Error(`${name}: expected a non-empty array of bars`)
  }

  if (wasPlain) {
    // Minified before compressing, and the plain copy removed: shipping both would put
    // 242 MB in the deploy alongside the 63 MB that replaces it.
    writeFileSync(target, gzipSync(Buffer.from(JSON.stringify(bars)), { level: 9 }))
    rmSync(source)
    compressed++
  }

  const first = bars[0]
  const last = bars[bars.length - 1]
  if (typeof first?.t !== 'number' || typeof last?.t !== 'number') {
    throw new Error(`${name}: first and last bars must carry a numeric \`t\``)
  }

  entries.push({
    file,
    barCount: bars.length,
    firstBarTime: first.t,
    lastBarTime: last.t,
  })

  // Largest single-bar close move, for the review step below.
  let largest = 0
  let largestAt = -1
  for (let i = 1; i < bars.length; i++) {
    const previous = bars[i - 1]?.c
    const close = bars[i]?.c
    if (!(previous > 0) || typeof close !== 'number') continue
    const move = Math.abs(close - previous) / previous
    if (move > largest) {
      largest = move
      largestAt = i
    }
  }
  if (largest > SPLIT_SUSPICION) {
    outliers.push({ file: name, move: largest, at: bars[largestAt]?.t ?? 0 })
  }
}

// One entry per line: a 644-entry array on one line is unreviewable, and fully
// pretty-printed it is 3,000 lines of punctuation. This diffs one line per dataset.
const body = entries.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')
writeFileSync(join(DIR, MANIFEST), `[\n${body}\n]\n`)

console.log(`${entries.length} datasets indexed, ${compressed} newly compressed`)

if (outliers.length > 0) {
  outliers.sort((a, b) => b.move - a.move)
  console.log(
    `\n${outliers.length} with a single-bar move over ${SPLIT_SUSPICION * 100}% — review these:`
  )
  for (const { file, move, at } of outliers) {
    const date = new Date(at * 1000).toISOString().slice(0, 10)
    console.log(`  ${(move * 100).toFixed(1).padStart(6)}%  ${date}  ${file}`)
  }
  console.log(
    '\nA real crash and an unadjusted split are the same number, so this list needs eyes,\n' +
      'not a threshold. Leveraged ETFs reverse-split often and are the usual artifacts;\n' +
      'single names at 50–120% are usually real. Drop a file to remove it from the game.'
  )
}
