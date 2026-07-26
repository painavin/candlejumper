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

## Bar schema

Each bar carries full OHLCV, using the **single-letter keys of the bundled
files verbatim** (`o`, `h`, `l`, `c`, `v`, `t`) so there's one
representation end to end and no remapping layer. Pole height and fills use
`c` only, but indicators and the volume sub-pane need the rest.

**`t` is epoch seconds, not milliseconds** — see the note in
[indicators.md](./indicators.md#shared-types).

## Bundled dataset

Three tickers ship in [`data/`](../data), each ~2 years of daily bars
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

**On adjustment**: that last check is the practical split test. An
unadjusted 4:1 split would appear as a ~75% single-bar crash, and the game
would teach a pattern that never happened — the largest moves present
(+15.3% on AAPL and +10.1% on MSFT on the same date, a market-wide event;
−15.5% on NKE) are all plausible real moves, so there are no unadjusted
split artifacts in this window. `TickerMeta.adjusted` records the claim
explicitly, and any future source must state it rather than leaving it
implied. Day gaps of 1–4 days are just weekends and market holidays.

## Decisions

- **Ship with the bundled source first** (`data.source: bundled`): the three
  JSON files above, read from disk. Offline, no API keys, no rate limits,
  and fully reproducible runs — which matters more than it first appears,
  since personal-best comparison and the seeded "daily ticker" idea in
  [game-feel.md](./game-feel.md) both need the same ticker to play
  identically every time.
- **Sources are switchable at runtime**, not a build-time choice — the
  interface costs nothing extra to make dynamic, and it keeps a live API
  from becoming a fork of the app later.
- **Ticker selection is a dropdown of whatever the active source offers**,
  not free-text symbol entry. With the bundled source that's the shipped
  list; a future API source can populate the same dropdown from a search.
  Free-text entry against a bundled source would just be a way to
  mistype a ticker that doesn't exist.
- **Playback order is chronological.**
- Date range is optional; unset plays the ticker's whole series.

## Sources beyond bundled (later)

- **Live/fetched API** (e.g. Yahoo Finance, Alpha Vantage) — real data for
  any ticker, but needs API keys, rate limit handling, and network error
  handling. Slots into the same interface.
- **Synthetic random-walk data** — infinite variety, no licensing
  concerns, useful for testing the engine against extreme price paths, but
  loses the "real stock" hook for actual play.

## Sequencing note

Build the interface early with the bundled implementation behind it so
pole generation has something real to consume. Additional sources come
after the core loop, visuals, and audio work — see
[roadmap.md](./roadmap.md).
