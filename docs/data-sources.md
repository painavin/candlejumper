# Data Sources

The game loop never depends on a concrete source — only on the
`PriceSeriesSource` interface — so sources can be added over time without
reworking pole/rendering logic.

## Interface

```ts
interface TickerMeta {
  symbol: string           // 'AAPL'
  displayName: string
  barCount: number
  firstBarTime: number     // epoch seconds
  lastBarTime: number
  adjusted: boolean        // split/dividend adjusted?
}

interface PriceSeriesSource {
  id: string
  /** Tickers this source can offer; populates the settings dropdown. */
  listTickers(): Promise<TickerMeta[]>
  /**
   * Ordered bars, oldest first. Optional range filter is inclusive,
   * in epoch seconds.
   */
  loadSeries(symbol: string, range?: { from: number; to: number }): Promise<OhlcvBar[]>
}
```

Both methods are **async** even for the bundled source, so a network-backed
source slots in later without changing any call site. `OhlcvBar` is defined
once in [indicators.md](./indicators.md#shared-types) — the same type the
indicator and stop plugins consume.

The game loop only ever sees this normalized shape, never a source-specific
format.

A source whose catalogue the player fills themselves implements one more interface on
top:

```ts
interface DownloadableSource extends PriceSeriesSource {
  readonly providers: readonly { id: string; displayName: string }[]
  download(request: { symbol: string; providerId: string }): Promise<TickerMeta>
  importFile(file: { name: string; text: string }): Promise<TickerMeta>
  forget(symbol: string): Promise<void>
}
```

Deliberately **separate** rather than optional methods on the base interface.
The bundled and synthetic sources have fixed catalogues, and giving them a
`download` they must refuse is worse than letting the settings screen
feature-detect the capability with `isDownloadable`. The split also states the
property that matters: `loadSeries` reads the cache, `download` reads the
network, and nothing does both.

`download` names its provider rather than choosing one, and `importFile` writes to the
same library it does — see [Downloading and importing](#downloading-and-importing).

## Bar schema

Each bar carries full OHLCV, using the **single-letter keys of the bundled
files verbatim** (`o`, `h`, `l`, `c`, `v`, `t`) so there's one
representation end to end and no remapping layer. Pole height and fills use
`c` only, but indicators and the volume sub-pane need the rest.

**`t` is epoch seconds, not milliseconds** — see the note in
[indicators.md](./indicators.md#shared-types).

## Bundled dataset

Three tickers ship in [`src/data/datasets/`](../src/data/datasets), each ~2 years of daily bars
(2024-08 → 2026-07). They were chosen — and verified — to cover **three
genuinely different market regimes**, so the starter set teaches distinct
pattern-recognition lessons rather than three variations of one shape:

| File | Bars | Net | Close range | Regime |
|---|---|---|---|---|
| `AAPL.Daily.json` | 478 | **+41.6%** | 172.42 – 333.74 | Uptrend with a deep mid-run drawdown and recovery — teaches holding through noise |
| `MSFT.Daily.json` | 480 | **−8.2%** | 352.83 – 542.07 | Choppy and range-bound with a wide swing — teaches that a flat net result can hide large moves |
| `NKE.Daily.json` | 480 | **−50.9%** | 40.75 – 89.44 | Sustained downtrend — teaches not averaging into a falling knife, and is the natural short-side series |

Verified properties of all three: timestamps strictly monotonic, no null or
zero prices, `h >= l` on every bar, and no single-bar move beyond ~15.5%.
`src/data/validate.ts` restates every one of them as code, so a *downloaded*
series is held to exactly the same standard.

**Where they live**: under `src/data/datasets/`, not at the repo root. Keeping
them outside `src/` would leave one file permanently exempt from the
import-zone rules — see
[code-structure.md](./code-structure.md#top-level).

**On adjustment**: that last check is the practical split test. An
unadjusted 4:1 split would appear as a ~75% single-bar crash, and the game
would teach a pattern that never happened — the largest moves present
(+15.3% on AAPL and +10.1% on MSFT on the same date, a market-wide event;
−15.5% on NKE) are all plausible real moves, so there are no unadjusted
split artifacts in this window. `TickerMeta.adjusted` records the claim
explicitly, and any future source must state it rather than leaving it
implied. Day gaps of 1–4 days are just weekends and market holidays.

## Downloading and importing

`data.source: downloaded` is **the library**: every series the player has obtained,
however they obtained it. It is one source with two ways to fill it — download from a
provider, or import a file — and no API key either way.

### One library, keyed by symbol

A symbol names a series. Downloading `AAPL` from any provider, or importing a file
called `AAPL.csv`, writes the same entry, and the newest write wins. One central cache
under one key, `datasets`.

Two earlier designs were wrong here and are worth recording so they don't come back:

- **A cache per provider**, so `AAPL` could exist several times over. That turned one
  question — "what do I have?" — into one per provider, with nothing on screen
  explaining why the same ticker appeared twice.
- **A source per provider**, which made two entries in the Source dropdown that behaved
  identically for playback and differed only in what pressing Download did.

Replacement is safe because the dataset's bar count and last bar time are part of the
**run fingerprint** ([config/fingerprint.ts](../src/config/fingerprint.ts)). A replaced
`AAPL` starts its own personal-best bucket rather than inheriting records set on data
that no longer exists.

### The player chooses the provider

The download row carries a provider picker, and `download` is *told* which to use.

| Provider | Endpoint | Symbol form | Adjusted |
|---|---|---|---|
| Yahoo Finance | `v8/finance/chart` JSON | `INTC` | yes, close only — ratio applied to O/H/L in the adapter |
| Stooq | `q/d/l` CSV | `intc.us` | yes, as delivered |

An earlier version tried each provider in turn and kept whichever answered first. That
decided on the player's behalf where their data came from, and meant two downloads of
one symbol could hold data from different endpoints depending on which was up that day.

Selection also makes a throttled provider **actionable** rather than magic: Yahoo's 429
message says to pick the other provider, which is something a player can do. Nothing
falls back.

Adding a third provider is a file in
[`providers/`](../src/data/sources/providers/) and one entry in `PRICE_PROVIDERS`.

### Importing a file

One button for CSV and JSON. The format is **sniffed from the content**, not the
extension, because which encoding a file uses is the file's business rather than
something worth asking the player about.

- **CSV** — header-driven: column order and casing come from the file's own first line,
  and only a date plus the four prices are required. `Date`/`Timestamp`/`t` and
  `Open`/`o` spellings all work; volume is optional. Dates may be ISO, ISO date-time,
  or an epoch number (seconds and milliseconds told apart by magnitude).
- **JSON** — either a bare array of bars, which is what the bundled datasets are, or an
  object with a `bars` array, which is what the library itself stores. The wrapped form
  carries its symbol and adjustment claim, so a dataset moved between machines doesn't
  arrive anonymous.
- **`Adj Close` is honoured.** A CSV exported from Yahoo's own site is the most likely
  import there is, and it carries both `Close` and `Adj Close`. Reading only `Close`
  would import unadjusted prices, which either trips the split check or — worse —
  passes while teaching a move that never happened. The ratio is applied to open, high,
  low, and volume, exactly as the Yahoo adapter does.
- **The symbol** comes from the file's own contents when it says, otherwise from the
  filename up to the first dot — so `MSFT.Daily.json` and `nke.csv` both work.
- **An import is unadjusted unless the file said otherwise**, and imports are validated
  by the same `parseBars` a download is. A file is not more trusted for having been
  chosen by hand.

Header-driven parsing rather than positional is the one decision worth defending: it's
four lines longer, and the failure mode it removes is silently swapping high for low,
which looks like plausible price data — the worst kind of wrong on a chart someone is
learning to read.

### Download everything, keep everything

A download fetches the provider's **whole daily history** and stores every bar of it.
There is no span to choose and nothing is discarded after the fact.

This replaced a `1y`/`2y`/`5y`/`10y`/`max` selector plus a post-parse trim, and the
reasoning is worth keeping: every bar a provider offers is a bar worth having, and a
source that dropped some would be deciding how much of a stock's life the player may
see. The trim was also subtly wrong — it ran *before* validation in one revision and
*after* in another, and in the after-order a clean one-year download could fail over a
suspicious bar from 2003 that was about to be thrown away.

Narrowing what gets **played** is `data.dateRange`, applied at playback. That's the
better home for it: reversible without re-downloading, and already in the fingerprint.

The cost is storage, and it's real. Yahoo's whole history for a long-listed stock is
around 11,000 bars — roughly 800 kB cached — against a browser quota of about 5 MB. A
handful of tickers is fine; a few dozen is not, and the quota failure is reported rather
than silent. If that becomes the binding constraint, the fix is a better store
(IndexedDB or the native filesystem), not a smaller download.

### Obtain once, then play from the cache

`loadSeries` never touches the network. This is not caching as an
optimisation — it's the property personal-best comparison rests on. A source
that re-fetched at run start would hand the same configuration a slightly
different series every day, silently, and every record it set would be
incomparable. So refreshing is a button, not a policy.

`FINGERPRINT_VERSION` went to 2 when the bar count and last bar time joined the
payload, which discards existing buckets — lifetime totals survive, since they aren't
keyed by challenge.

### CORS is the whole difficulty

Yahoo's endpoint sends no `Access-Control-Allow-Origin` header — measured, not
assumed — so **a browser will not hand its response to page JavaScript**. The
request is sent, the server answers, and the browser withholds the body. This is
enforced by the browser on the user's behalf — it protects the *user's* ambient
credentials, not the API's data, which is why `curl` gets the same URL with no
complaint — and there is no developer switch that turns it off for a page.

Stooq's header has **not** been checked; the proxy covers it either way, so the
setup below is correct whichever answer it gives. If it turns out to send a
permissive header, the built bundle could reach it without an extension —
`curl -sI "https://stooq.com/q/d/l/?s=intc.us&i=d" | grep -i access-control`
settles it.

Three configurations therefore exist, and the first is the only one that needs
nothing installed:

| Where | How the request is made | Works? |
|---|---|---|
| `npm run dev` | Vite proxies `/yahoo` and `/stooq` → the providers, from Node | **Yes**, out of the box |
| Built bundle in a browser | `fetch` from the page | Only with a CORS extension |
| Tauri / Capacitor | native HTTP, outside the browser engine | Yes, once wired — see below |

The dev proxy table lives in [vite.config.ts](../vite.config.ts); `DEV_PROXY_PATHS`
in `app/shell.ts` points each provider at its proxied path when
`import.meta.env.DEV`. Those two lists are the same fact stated twice and have to
agree.

**If you use an extension**, scope it to `query1.finance.yahoo.com` and
`stooq.com`, and keep it off a browser profile you bank in. An extension that
strips CORS headers for all sites removes a real protection from every site in
that profile — which is a worse trade than it sounds, and unnecessary here, since
two hosts are all this needs.

**Wrapping the app in Tauri does not switch CORS off.** The webview enforces the
same rule; what's exempt is the *native transport*
(`@tauri-apps/plugin-http`, or Capacitor's `CapacitorHttp`), which performs the
request outside the browser engine. That's what `platform/http/` exists for: the
transport is a port with one browser implementation today and room for two native
ones beside it. `src-tauri/tauri.conf.json` also needs the provider host in
`connect-src` — see [packaging.md](./packaging.md).

### What the Yahoo adapter has to get right

[`src/data/sources/providers/yahoo.ts`](../src/data/sources/providers/yahoo.ts)
is pure — a URL builder and a parser — and tested against a **recorded** response.
Three cases carry the weight:

- **Adjustment.** Yahoo adjusts only the close, so the `adjclose / close` ratio
  is applied to the open, high, and low too. Skip it and a 4:1 split reads as a
  75% single-bar crash, which `validateBars` correctly refuses. Volume is
  *divided* by the same ratio, since post-split share counts are four times
  pre-split ones and leaving it raw puts a step change in the volume pane on a
  day when nothing happened.
- **The live partial bar.** A response taken during or just after a session ends
  with a row whose open, high, and low are real and whose close is `null`. It's
  dropped rather than repaired from `meta.regularMarketPrice`: caching a
  half-formed day as though it had closed is worse than being one bar short.
  The recorded fixture contains exactly this row.
- **Rows with no usable price**, from halted days, and repeated timestamps. Both
  dropped, because neither carries a trading day the chart can draw.

Prices are rounded to six decimals on the way in. Storage is what limits how
many tickers can be cached, and a raw `287.3999938964844` costs 18 characters.

### What the Stooq adapter has to get right

[`stooq.ts`](../src/data/sources/providers/stooq.ts) is simpler — the series
arrives adjusted, so there is no ratio — with one deliberate difference in
approach: **it reads the CSV header rather than assuming a column order.**

That's not defensive habit. This adapter was written without a captured response
to hand, because the environment it was written in couldn't reach the host, so a
positional parser would have been a guess about layout with no way to check it —
and the failure mode of guessing wrong is silently swapping high for low, which
looks like plausible price data. Reading the header costs four lines and removes
the guess. Casing, column order, and a missing volume column are all tolerated;
tests bend each one.

Its errors quote the response body, because that endpoint reports an exceeded
rate limit and an unknown symbol the same way: HTTP 200 with a short line of
prose. Replacing that with our own guess would discard the only explanation
available.

**Known gap:** the Stooq tests run against hand-written CSV, unlike Yahoo's, which
run against a recording. Capturing a real response and adding it as a fixture is
worth doing the next time the host is reachable.

### Storage

Cached datasets live in one `localStorage` key as a symbol-keyed record, written
through `DatasetCache` — a port in `@shared`, implemented in
[`app/datasetCache.ts`](../src/app/datasetCache.ts) because `data/` may not
import `platform/`. Measured: **~110 kB for 5 years of daily bars**, so a ~5 MB
quota holds roughly 45 tickers at that span.

The write is **read back and compared**. `createLocalStorageStore` deliberately
swallows write failures — losing a personal best is bad, failing to start the
next run over it would be worse — but that trade is wrong for a dataset, which is
a run's *input*. A download that silently didn't persist looks like it worked
until the next reload, and then the ticker is simply gone.

## Decisions

- **Ship with the bundled source first** (`data.source: bundled`): the three
  JSON files above, read from disk. Offline, no API keys, no rate limits,
  and fully reproducible runs — which matters more than it first appears,
  since personal-best comparison and the seeded "daily ticker" idea in
  [game-feel.md](./game-feel.md) both need the same ticker to play
  identically every time. Still the default.
- **Sources are switchable at runtime**, not a build-time choice — the
  interface costs nothing extra to make dynamic, and it keeps a live API
  from becoming a fork of the app later.
- **Ticker selection is a dropdown of whatever the active source offers.**
  Downloading *adds* a free-text field beside that dropdown rather than
  replacing it: the list is still the set of series that exist, and the field
  is how a new one is created. This supersedes the original decision to have no
  free-text entry at all, whose reasoning — that typing a symbol at a fixed
  catalogue is only a way to mistype — doesn't apply to a source whose catalogue
  is whatever you ask for.
- **Playback order is chronological.**
- Date range is optional; unset plays the ticker's whole series. A fresh
  download clears it, since a range chosen against the old dataset means
  nothing against the new one.

## Sources beyond bundled

- **The library** (`data.source: downloaded`) — *built*, fed by Yahoo Finance, Stooq,
  or an imported file. See above. The costs are worth stating plainly: both endpoints are
  **undocumented and unofficial**, either can change or start refusing traffic
  without notice, and in a browser both need the dev proxy or an extension. Rate
  limiting arrives as HTTP 429 (Yahoo) or a 200 with a line of prose (Stooq), and both
  are reported as what they are. Having two is what makes a throttled provider a
  choice rather than a wait.
- **Synthetic random-walk data** — *built*, as `data.source: synthetic`. Three
  seeded series (steady uptrend, high-volatility chop, sustained decline) from a
  log-normal random walk with normal shocks, so they have realistic tails rather
  than a hard cap on daily moves. Useful for testing the engine against extreme
  price paths the three curated real datasets deliberately don't contain. Seeded
  per symbol, because a source that generated something different every load
  would break personal-best comparison. Not the default: it loses the "real
  stock" hook for actual play.
- **A third provider** — a file and a list entry: a URL builder and a parser beside
  the existing two, which the registry turns into another selectable source. The
  transport returns text rather than JSON precisely so a CSV provider needed no second
  entry point, which Stooq then didn't.
- **Export**, the other half of import — not built. The library already stores the
  wrapped JSON shape that `importFile` reads back, so this is a serialiser and a
  download link rather than a format decision.

## Sequencing note

Build the interface early with the bundled implementation behind it so
pole generation has something real to consume. Additional sources come
after the core loop, visuals, and audio work — see
[roadmap.md](./roadmap.md).
