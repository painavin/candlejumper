import type { BarInterval, OhlcvBar, TextFile } from '@shared/contracts/index.js'
import { inferInterval, isBarInterval } from '@shared/contracts/index.js'

/**
 * Reading a price series out of a file — one entry point for CSV and JSON.
 *
 * One import button, two formats, because the distinction is the file's business
 * rather than the player's: they have "the data for AAPL", and being asked which
 * *encoding* that is before the app will look at it is a question with no interesting
 * answer. The format is sniffed from the content, not the extension, so a `.txt` that
 * happens to be CSV works and a mislabelled file fails with a message about what was
 * actually in it.
 *
 * `parseCsvBars` is also what the Stooq provider uses. Two CSV parsers in one codebase
 * would drift, and this one already handles everything that endpoint returns.
 */

/** Columns this understands, in the spellings real exports actually use. */
const DATE_NAMES = ['date', 'datetime', 'time', 'timestamp', 't']
const ADJ_CLOSE_NAMES = ['adj close', 'adjclose', 'adj_close', 'adjusted close']
const VOLUME_NAMES = ['volume', 'vol', 'v']

export interface ParsedSeries {
  /** From the file's own contents, when it says. The caller falls back to the name. */
  symbol?: string
  /**
   * Whether these prices are split/dividend adjusted.
   *
   * Only ever `true` when the file *said* so — an adjusted-close column that was
   * applied, a wrapped JSON dataset that claims it, or a recognised provider response
   * whose provider adjusts. A bare list of prices is reported as unadjusted, because
   * guessing in the other direction is what puts an invented crash on the chart.
   */
  adjusted: boolean
  bars: OhlcvBar[]
  /** Set only when a provider's own response format was recognised. */
  provider?: string
  /**
   * How much time one bar covers.
   *
   * From the payload when it says so, otherwise inferred from the gaps between
   * timestamps. It matters more than it looks: the interval sets the split tolerance, so
   * a monthly file read as daily is rejected for moves that are ordinary at a month.
   */
  interval?: BarInterval
}

/**
 * A provider's own response body, as something the importer can fall back to.
 *
 * Structural rather than an import of `PriceProvider`: this module is the *general*
 * one — the Stooq adapter already depends on `parseCsvBars` — and depending back on
 * the providers would close that loop.
 */
export interface NativeFormat {
  /** Recorded as the dataset's provider when this format matches. */
  id: string
  adjusted: boolean
  /** See `PriceProvider.recognise`. `undefined` means "not mine". */
  recognise(text: string): { symbol?: string; interval?: BarInterval } | undefined
  parse(text: string, symbol: string, interval?: BarInterval): OhlcvBar[]
}

export interface ParseSeriesOptions {
  /**
   * Formats to try when the file isn't one of ours.
   *
   * This is what lets someone paste a provider URL into a browser, save what comes
   * back, and import it — the only way to obtain data from a built bundle with no
   * proxy and no CORS extension, since CORS withholds responses from *script* but
   * has nothing to say about a tab a person opened.
   */
  nativeFormats?: readonly NativeFormat[]
}

/**
 * `AAPL.Daily.csv` → `AAPL`. Everything from the first dot is dropped, which handles
 * both the extension and the `.Daily` the bundled files carry.
 */
export function symbolFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  return (base.split('.')[0] ?? base).trim().toUpperCase()
}

/** CSV or JSON, sniffed from the content, then any provider's own response format. */
export function parseSeriesFile(file: TextFile, options: ParseSeriesOptions = {}): ParsedSeries {
  const fromName = symbolFromFilename(file.name)
  const trimmed = file.text.trimStart()
  let parsed: ParsedSeries
  try {
    parsed = trimmed.startsWith('{') || trimmed.startsWith('[')
      ? parseJsonSeries(trimmed, file.name)
      : parseCsvBars(file.text, file.name)
  } catch (cause) {
    parsed = parseNativeFormat(file, fromName, options.nativeFormats ?? [], cause)
  }
  // `symbol` and `interval` last. Spreading `parsed` after them puts an explicit
  // `undefined` back over the fallback, which is a quiet way to lose both.
  return {
    ...parsed,
    symbol: parsed.symbol ?? fromName,
    // Inferred only when the file didn't say. A bare CSV or JSON array never says.
    interval: parsed.interval ?? inferInterval(parsed.bars.map((bar) => bar.t)),
  }
}

/**
 * The file wasn't one of ours — is it a provider's raw response?
 *
 * Recognition and parsing are separate steps on purpose. Once a format claims the
 * payload its own parse error is allowed through, because "Yahoo says: No data found for
 * MSFT" is worth reading and "is JSON, but not a series" is not. Only an unrecognised
 * payload falls through to the next format, and if none claim it the original failure is
 * what the player sees — they were far more likely to be importing a broken CSV than a
 * provider response.
 */
function parseNativeFormat(
  file: TextFile,
  fromName: string,
  formats: readonly NativeFormat[],
  cause: unknown
): ParsedSeries {
  for (const format of formats) {
    const claim = format.recognise(file.text)
    if (claim === undefined) continue
    const symbol = claim.symbol ?? fromName
    return {
      symbol,
      adjusted: format.adjusted,
      // The interval the payload declared, so the parser can refuse a response that
      // turns out to be something else — the check is the point of passing it.
      bars: format.parse(file.text, symbol, claim.interval),
      provider: format.id,
      interval: claim.interval,
    }
  }
  throw cause instanceof Error ? cause : new Error(String(cause))
}

/**
 * Our own JSON shape, in either of the two forms it exists in.
 *
 * A bare array is what the bundled datasets are, so one of those imports unchanged. A
 * wrapped object is what the library stores, so a dataset exported from one machine and
 * imported on another keeps its symbol and its adjustment claim instead of arriving
 * anonymous.
 */
function parseJsonSeries(text: string, label: string): ParsedSeries {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch (cause) {
    throw new Error(`${label} isn't valid JSON: ${(cause as Error).message}`, { cause })
  }
  if (Array.isArray(payload)) {
    return { adjusted: false, bars: payload as OhlcvBar[] }
  }
  if (typeof payload === 'object' && payload !== null) {
    const wrapped = payload as {
      symbol?: unknown
      adjusted?: unknown
      bars?: unknown
      interval?: unknown
    }
    if (Array.isArray(wrapped.bars)) {
      return {
        symbol: typeof wrapped.symbol === 'string' ? wrapped.symbol.toUpperCase() : undefined,
        adjusted: wrapped.adjusted === true,
        bars: wrapped.bars as OhlcvBar[],
        // A dataset moved between machines keeps its interval rather than having one
        // guessed back out of its timestamps.
        interval: isBarInterval(wrapped.interval) ? wrapped.interval : undefined,
      }
    }
  }
  throw new Error(
    `${label} is JSON, but not a series: expected an array of bars, or an object with a "bars" array.`
  )
}

/**
 * A delimited table of bars.
 *
 * **Header-driven**: column order and casing come from the file's own first line, and
 * only date plus the four prices are required. Position-based parsing would have been
 * shorter and its failure mode is silently swapping high for low, which looks like
 * plausible price data — the worst kind of wrong for a chart someone is learning to
 * read.
 */
export function parseCsvBars(text: string, label: string): ParsedSeries {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const header = lines[0]?.toLowerCase().split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
  const column = (names: readonly string[]): number =>
    header ? header.findIndex((cell) => names.includes(cell)) : -1

  const date = column(DATE_NAMES)
  const open = column(['open', 'o'])
  const high = column(['high', 'h'])
  const low = column(['low', 'l'])
  const close = column(['close', 'c'])
  if (!header || date === -1 || open === -1 || high === -1 || low === -1 || close === -1) {
    /**
     * Not a table of bars. This is also how Stooq reports its own refusals — an
     * exceeded rate limit and an unknown symbol both come back as a short line of prose
     * with a 200 — so the body is described rather than replaced with a guess about
     * what went wrong.
     */
    throw new Error(`${label} isn't a series of daily bars: ${preview(text)}`)
  }

  /**
   * An adjusted-close column, applied the same way the Yahoo adapter applies it.
   *
   * Load-bearing for the most likely import there is: a CSV exported from Yahoo's own
   * site carries both `Close` and `Adj Close`. Reading only `Close` would import
   * unadjusted prices, which either trips the split check or — worse — passes it while
   * teaching a move that never happened.
   */
  const adjClose = column(ADJ_CLOSE_NAMES)
  const volume = column(VOLUME_NAMES)

  const bars: OhlcvBar[] = []
  for (const line of lines.slice(1)) {
    const row = line.split(',')
    const t = parseTime(cell(row, date))
    const o = parseNumber(cell(row, open))
    const h = parseNumber(cell(row, high))
    const l = parseNumber(cell(row, low))
    const c = parseNumber(cell(row, close))
    if (t === undefined || o === undefined || h === undefined || l === undefined) continue
    if (c === undefined || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue

    const adj = adjClose === -1 ? undefined : parseNumber(cell(row, adjClose))
    const ratio = adj !== undefined && adj > 0 ? adj / c : 1
    const v = volume === -1 ? undefined : parseNumber(cell(row, volume))

    bars.push({
      o: round(o * ratio),
      h: round(h * ratio),
      l: round(l * ratio),
      c: round(adj ?? c),
      // Post-split share counts are larger by the same ratio, so dividing keeps the
      // volume pane continuous across a split. A missing volume keeps the bar: the
      // prices are the point.
      v: v !== undefined && v >= 0 ? Math.round(v / ratio) : 0,
      t,
    })
  }

  /**
   * Sorted and de-duplicated rather than trusted to arrive in order. The
   * strict-monotonic requirement downstream is worth one sort to guarantee here, and it
   * removes an assumption about the file that nothing else could check.
   */
  bars.sort((a, b) => a.t - b.t)
  const ordered = bars.filter((bar, index) => index === 0 || bar.t > bars[index - 1]!.t)
  if (ordered.length === 0) {
    throw new Error(`${label} has a header but no usable rows: ${preview(text)}`)
  }
  // Adjusted only if the file carried the column that says so.
  return { adjusted: adjClose !== -1, bars: ordered }
}

const cell = (row: readonly string[], index: number): string => row[index] ?? ''

const round = (value: number): number => Math.round(value * 1e6) / 1e6

function parseNumber(value: string): number | undefined {
  const parsed = Number(value.trim().replace(/^"|"$/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * A date cell → epoch **seconds**, which is what `OhlcvBar.t` is throughout.
 *
 * Three forms, because exports differ: an ISO date, an ISO date-time, and a bare epoch
 * number. The seconds-or-milliseconds test is by magnitude — anything past ~5138 as
 * seconds is milliseconds, and no daily price series is dated in the year 5138.
 */
function parseTime(value: string): number | undefined {
  const raw = value.trim().replace(/^"|"$/g, '')
  if (raw === '') return undefined

  if (/^\d+$/.test(raw)) {
    const number = Number(raw)
    if (!Number.isFinite(number) || number <= 0) return undefined
    return Math.floor(number > 1e11 ? number / 1000 : number)
  }

  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw)
  if (!match) return undefined
  const [, year, month, day] = match
  // UTC rather than local: a series must not shift by a day when it crosses a machine
  // in a different timezone.
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day))
  return Number.isFinite(ms) ? ms / 1000 : undefined
}

/**
 * Enough of an unexpected body to identify it, without pasting a whole file.
 *
 * A **web page is summarised rather than quoted**: a hundred characters of
 * `<!DOCTYPE html><head><meta…` in a settings panel tells the reader nothing except
 * that something went wrong noisily. A short line of prose is worth reading verbatim.
 */
export function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return '(empty)'
  if (/^\s*(<!doctype|<html|<\?xml)/i.test(flat)) {
    return 'it is a web page, not data — usually a rate limit, a login wall, or a changed URL.'
  }
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
}
