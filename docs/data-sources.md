# Data Sources

The game loop never depends on a concrete source — only on the
`PriceSeriesSource` interface — so sources can be added over time without
reworking pole/rendering logic.

## Interface

```ts
interface TickerMeta {
  symbol: string           // the source's id: 'AAPL' bundled, 'AAPL@1d' in the library
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
  loadSeries(ticker: string, range?: { from: number; to: number }): Promise<OhlcvBar[]>
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
  readonly providers: readonly {
    id: string
    displayName: string
    intervals: readonly BarInterval[]   // what this one can actually serve
  }[]
  download(request: {
    symbol: string
    providerId: string
    interval: BarInterval
  }): Promise<TickerMeta>
  importFile(file: { name: string; text: string }): Promise<TickerMeta>
  forget(ticker: string): Promise<void>
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

## Bundled datasets

644 series ship in [`public/datasets/`](../public/datasets) — 643 daily and one
30-minute — each covering that ticker's full available history rather than a
window. They are **gzipped static files served from the site's own origin**,
fetched and inflated at runtime. No API keys, no rate limits, and the same series
every time, which matters more than it first appears: personal-best comparison
needs a ticker to play identically on every run.

### No dataset is special

Every file is offered on identical terms and named from its own file name. There
used to be a curated set of three — AAPL for an uptrend, MSFT for chop, NKE for a
downtrend — with a hand-written regime description each. That was a good idea at
three datasets and became 641 anonymous ones the moment the set grew, so the
descriptions are gone. The three are all still in the set; they are simply no
longer privileged.

### A file name declares its series

`AAPL.Daily.json` is `AAPL@1d`; `UVIX.Mins30.json` is `UVIX@30m`. A symbol and an
interval together name a series — the same composite id the downloaded library
uses — because one ticker can be held at several intervals and they are genuinely
different series.

The interval comes from the **file name**, not from `inferInterval`. The name is a
declaration, and preferring a guess over it would let a mislabelled file play as
something else. A token this build doesn't recognise is dropped from the catalogue
rather than assumed daily: the interval sets the split tolerance, so guessing is how
a monthly series gets rejected for a move that is ordinary over a month.

### The manifest, and why it exists

[`public/datasets/manifest.json`](../public/datasets/manifest.json) lists every file
with its bar count and first and last bar time — about 60 kB, one line per dataset.
`listTickers` reads that and nothing else.

It exists because the catalogue used to be built by **loading every dataset** to
count its bars. At three files that was invisible. At 644 it meant 64 MB downloaded
before the title screen appeared, three and a half million bar objects retained for
the session, and a 4 GB Node heap exhausted by the test that called `listTickers`.

Regenerate it after adding, removing, or refreshing a dataset:

```
npm run datasets
```

That script also compresses. Drop in either `SYMBOL.Interval.json` or an
already-gzipped `.json.gz`; plain JSON is minified, gzipped, and the original
removed, so what ships is only ever the compressed form. It is a script rather than a
build step because the data is static — reparsing 242 MB on every `vite build` and
every CI run would be pure waste — and `data.test.ts` checks the manifest agrees with
the files so a forgotten run fails a test instead of shipping.

### Gzipped for the deploy, not for the download

| | On disk | Per ticker (XOM, 6,886 bars) |
|---|---|---|
| Pretty-printed JSON | 385 MB | 754 kB |
| Minified JSON | 242 MB | 472 kB |
| **Gzipped, as shipped** | **63 MB** | **123 kB** |

The host already compresses text responses in flight, so a plain dataset was arriving
as ~123 kB either way — the browser has always been downloading these zipped. What
changes is **bytes on disk**, and that is what a static-site size cap measures. The
whole deploy goes from 245 MB, sitting exactly on the Azure Free tier's 250 MB
ceiling, to 65 MB with room to grow.

Two things this settled that were open questions:

- **A columnar record format is not worth it.** Array-of-arrays saves 34% uncompressed
  and 13 kB of 123 once gzipped, because gzip was already eliminating the repeated key
  names the format change was for.
- **Brotli is not worth it either**, though it is another 25% smaller.
  `DecompressionStream` has no brotli, so it would mean a wasm decoder in the bundle —
  defeating the point — or a `Content-Encoding` header, which cannot be tested before
  it is deployed and fails as binary garbage.

Inflating happens in `jsonFromBytes`, which **sniffs the gzip magic number rather than
trusting the file extension**. That is the defence that matters: a CDN which recognises
`.gz` and helpfully decodes it, setting `Content-Encoding` so the browser inflates
first, would hand over plain JSON under a `.gz` name — and an unconditional inflate
would then fail on every dataset with an error pointing nowhere near the cause. Gzip is
self-describing, so the bytes get asked. Both paths are tested.

### Why served, not bundled

They used to be imported through a lazy `import.meta.glob`, which did split them into
one chunk each. Serving them instead buys three things:

- **The manifest becomes possible.** A `public/` file has a stable URL; a bundled
  chunk has a hashed name only the bundler knows.
- **The build stops pretending they are code.** 657 chunks became 14, and the build
  went from 1.6s to under 600ms.
- **It costs nothing in bytes.** Rolldown emitted each dataset as `JSON.parse("…")`
  inside a JS module, so a minified `.json` is the same payload without the wrapper —
  471.8 kB against 472 kB for XOM.
- **It makes storing them compressed possible at all.** A bundler will not serve you
  opaque bytes under a name you chose; a static file will.

The cost is that `public/` names are not content-hashed, and a refreshed dataset
reuses its name with different contents. That is a real hazard, not a theoretical
one: the run fingerprint keys on bar count and last bar time taken from the
*manifest*, so a client holding a stale dataset behind a fresh manifest would file
runs under a bucket describing a series it isn't playing. So every dataset request
carries `?v=<lastBarTime>`, which changes whenever the contents do — which in turn is
what makes the year-long `cache-control` in
[`public/staticwebapp.config.json`](../public/staticwebapp.config.json) safe. The
manifest itself gets five minutes and `must-revalidate`, because it is the index and
has to reflect an added ticker.

### On adjustment, and the check that had to go

Every bundled export is adjusted, and `TickerMeta.adjusted` records that claim
explicitly rather than leaving it implied.

The **split heuristic does not run on this source.** It exists to catch unverified
data — a hand-fetched URL, an imported CSV — where an unadjusted 4:1 split appears as
a 75% single-bar crash and the game would teach a pattern that never happened. It
cannot survive contact with full market history, because the quantity it measures
does not separate the two cases:

| Dataset | Largest single-bar move | Date | What it is |
|---|---|---|---|
| `SVXY` | −83.0% | 2018-02-06 | Volmageddon. Real, and one of the most instructive bars in the set |
| `MS` | +87.0% | 2008-10-13 | Morgan Stanley's crisis rally. Real |
| `INSM` | +119.6% | 2017-09-05 | Biotech trial result. Real |
| `AAPL` | −51.9% | 2000-09-29 | Apple's earnings warning. Real |
| `DFEN` | +184.5% | 2024-06-04 | Leveraged ETF reverse split. An artifact |

An unadjusted 2:1 split is 50%. Apple's real crash is 51.9%. One number, two
meanings. Applied at the daily threshold, **66 of the 644 datasets** would be listed
and then refuse to load — a ticker you can pick and cannot play, which is worse than
either alternative.

So the threshold moved from load time to index time. `npm run datasets` prints every
dataset whose largest single-bar move exceeds it, and that list gets reviewed by
someone who can tell a crisis rally from a reverse split; dropping a file removes it
from the game. Leveraged ETFs reverse-split often and are the usual artifacts, while
single names at 50–120% are usually real.

Every **structural** check still runs on load: strictly increasing timestamps,
positive prices, `h >= l` on every bar. Those catch corruption, and corruption is
what a load-time check can actually decide. `src/data/validate.ts` restates them as
code, and a *downloaded* series is still held to the split test as well — it has not
been reviewed by anyone.

## Downloading and importing

### Intervals

A bar is not necessarily a day. The picker offers `1m`, `2m`, `5m`, `15m`, `30m`, `1h`,
`1d`, `1wk`, `1mo` and `3mo` — Yahoo's own ids, so a response can be checked against
what was asked for without a translation table in between.

**Per provider, not global.** Yahoo serves all ten. Stooq serves `1d` and only `1d`
here: it documents `i=w`, `i=m` and `i=q`, and none have been *observed* to answer. That
distinction already cost a debugging round on this endpoint — an unverified `&d1=`
parameter returned an HTML page with a 200 — so the others arrive when someone has run
the request and seen the answer. The picker filters to what the selected provider lists,
because an option that returns an error body is worse than one that was never there.

**Range is not a free choice.** Yahoo caps history by interval — roughly 7 days at `1m`,
60 days from `2m` to `30m`, 730 days at `1h` — and `range` is an enumeration rather than
a duration: the recorded fixture reports `1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd,
max`. Each interval therefore asks for the largest *valid* range under its cap: `5d`,
`1mo`, `2y`, and `max` for daily and coarser. The enumeration is measured; the caps are
Yahoo's documented limits and are **not** verified here, so a wrong one shows up as an
error body reported verbatim rather than as silence.

**Three things scale with the interval**, and each was a latent bug before:

- **The split tolerance.** `maxBarMoveFor` widens from 0.5 at a day to 2.5 at a quarter.
  The check exists to catch an unadjusted split, which is ~50% for 2:1 at any interval,
  but what the market really does in one bar depends on how long the bar is. Measured:
  INTC's quarterly series contains a genuine +151% move with adjusted and unadjusted
  closes agreeing exactly. At a quarter the check is frankly weak — it can no longer
  separate a split from a real move — and that is an acceptable trade only because both
  providers adjust their own data, making this a safety net rather than the defence.
- **The identity of a series.** See the keying section below.
- **What "the whole history" means.** A download still takes everything the provider
  offers and discards nothing; how much that is now depends on the interval and not on
  us.

`data.source: downloaded` is **the library**: every series the player has obtained,
however they obtained it. It is one source with two ways to fill it — download from a
provider, or import a file — and no API key either way.

### One library, keyed by symbol and interval

A symbol **and an interval** together name a series — `INTC@1d` and `INTC@1wk` coexist,
because they are different bars of different length and a different game to play.
Downloading `AAPL` daily from any provider, or importing a file called `AAPL.csv`, writes
the same `AAPL@1d` entry, and the newest write wins. One central cache under one key,
`datasets`.

That composite id is what `config.data.ticker` stores and what `loadSeries` receives, so
the interval reaches the run fingerprint for free — a weekly AAPL never pools personal
bests with a daily one. `@` is the separator because no symbol contains one: Yahoo's
carry `-` and `.` (`BRK-B`, `RELIANCE.NS`) and Stooq's carry `.` (`intc.us`). Daily is
not special-cased to a bare `INTC`, tempting as that is, because then one series would
have two spellings and every comparison would have to normalise.

**Entries written before intervals existed** are keyed by a bare symbol with no interval
field. They read as daily — which is what they are, since daily was all there was — and
are re-filed under the composite key on the next save. The key *is* the migration: no
version field, nothing to run once. A stored `config.data.ticker` of `INTC` also still
resolves, for the same reason, and the settings screen maps it to `INTC@1d` rather than
letting the selection jump to whatever sorts first.

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
- **A provider's own response body** is recognised as a fourth format, which is what
  makes "fetch it yourself and import it" work — see
  [CORS is the whole difficulty](#cors-is-the-whole-difficulty). Yahoo's chart JSON is
  a columnar envelope that matches neither of our JSON shapes, so without this the link
  in the error message would hand the player a file the app rejects. A provider opts in
  with `PriceProvider.recognise`; Stooq needs none, since its response is already CSV
  that `parseCsvBars` reads.
- **The symbol** comes from the file's own contents when it says, otherwise from the
  filename up to the first dot — so `MSFT.Daily.json` and `nke.csv` both work. A
  recognised provider response is read for its symbol first, because browsers name a
  saved API response after the URL or after nothing useful, and an import filed under
  the wrong ticker is silent.
- **The interval** comes from the payload when it declares one — a recognised provider
  response, or a wrapped dataset carrying the field — and is otherwise **inferred from
  the gaps between bars**. The *median* gap, because a daily series is full of 3-day
  weekend gaps by design, matched by closest ratio so that being out by an hour matters
  at `1m` and not at `3mo`. Fewer than three gaps yields no opinion at all and the import
  falls back to daily, since one gap could be anything and the interval decides the split
  tolerance.
- **An import is unadjusted unless the file said otherwise**, and imports are validated
  by the same `parseBars` a download is. A file is not more trusted for having been
  chosen by hand. A recognised provider response is the one case that inherits an
  adjustment claim from something other than the file's own contents — its provider's —
  which is the whole reason recognising it beats treating it as anonymous JSON: filing
  adjusted prices as unadjusted is wrong in the direction nothing downstream can detect.
  Such an entry is credited to that provider rather than to `imported`, because that's
  where it came from.

Recognition and parsing are deliberately separate steps. Once a format claims a payload
its own error is allowed through — "Yahoo says: No data found for MSFT" is worth reading
and "is JSON, but not a series" is not — while an unrecognised payload falls through to
the next format, and if none claim it the *original* failure is what the player sees.
They were far more likely to be importing a broken CSV than a provider response.

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

There is a fourth route that needs nothing at all, and it falls out of what CORS
actually restricts: **the player fetches the URL themselves.** CORS withholds a
response from *script*; it has nothing to say about a tab a person navigated to. So
opening the provider URL in a new tab returns the data, and saving that file and
importing it is a complete path to real prices from a built bundle with no proxy,
no extension, and no native shell.

The download failure message offers that link for every failure except a 404, which is
the one case where the endpoint refused *the symbol* rather than *this request* — there
is nothing at that URL, so opening it by hand finds nothing either. Everything else is
worth a try, including a rate limit: the window is time-based and may have passed by the
time the link is clicked, and a request a person makes from a tab carries different
headers and cookies from the one `fetch` made. The link is always the provider's real
URL, never the dev proxy path, since a same-origin path means nothing in a new tab.

For that round trip to close, the importer has to recognise what comes back — see
[importing a file](#importing-a-file).

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
Four cases carry the weight:

- **The interval the response actually is.** `interval` looks optional on this endpoint
  and isn't: omit it and Yahoo picks a granularity to suit the range, which for
  `range=max` is *three-month* bars. So a hand-fetched URL missing `interval=1d` returns
  168 quarters instead of 11,000 days — data that parses perfectly and is wrong. The
  parser checks `meta.dataGranularity` and refuses anything but `1d`, before it looks at
  a single bar, because the downstream failure actively misleads: quarterly moves
  routinely exceed 50%, so `validateBars` reports a wall of "likely an unadjusted split"
  for a series whose adjustment is fine and whose real problem is its interval. One
  sentence naming the granularity beats eight confident diagnoses of the wrong thing. A
  response that omits the field is judged on its bars, as before — absence is not a
  claim to the contrary.
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
