# Data Sources

The game loop never depends on a concrete source — only on the
`PriceSeriesSource` interface — so sources can be added over time without
reworking pole/rendering logic.

## Interface shape (conceptual)

A `PriceSeriesSource` produces an ordered list of bars for a given
ticker/date range. The game loop only ever consumes this normalized
shape, never a source-specific format.

**Each bar must carry full OHLCV (open/high/low/close/volume), not just
close.** Pole height and fills only use close, but
[indicators.md](./indicators.md) and the volume sub-pane need the rest.
Get this shape right from the very first bundled dataset (roadmap step 1)
so it doesn't require a data-layer rework once indicators land.

## Decisions

- **Ship with the bundled source first** (`data.source: bundled`): a few
  tickers' daily OHLCV bars as static CSV/JSON files. Offline, no API keys,
  no rate limits, and fully reproducible runs — which matters more than it
  first appears, since personal-best comparison and the seeded "daily
  ticker" idea in [game-feel.md](./game-feel.md) both need the same ticker
  to play identically every time.
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
