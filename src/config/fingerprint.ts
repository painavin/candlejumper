import { stableHash } from '@shared/math/index.js'
import type { Hashable } from '@shared/math/index.js'
import type { RunConfig } from './types.js'

/**
 * The run fingerprint: a stable hash of exactly the config that changes the
 * *challenge*.
 *
 * Two runs share a personal-best bucket only if their fingerprints match.
 * Percent return makes scores comparable across tickers, but not across
 * difficulty — the same series at 0.5 bars/sec with shorting on is a different
 * game from 8 bars/sec long-only, and pooling them makes the record
 * meaningless.
 *
 * Cosmetic and accessibility settings are deliberately excluded, so nobody is
 * penalised for making the game comfortable. See
 * docs/game-feel.md#new-session-structure-the-highest-leverage-item-here.
 */

/** Bump when the *set* of included keys changes; old buckets then migrate. */
export const FINGERPRINT_VERSION = 2

export interface FingerprintInputs {
  /**
   * The bar count actually in force, resolved once from orientation at run
   * start. Passed in rather than read off config because the config holds one
   * value per orientation and only the resolved one describes the challenge.
   */
  visibleBarCount: number
  /**
   * Bars consumed before play began, resolved once at run start — `'auto'` is a number
   * by the time it gets here, for the same reason `visibleBarCount` is.
   *
   * Part of the challenge: preloading 200 bars means playing a shorter series that
   * starts 200 bars later, with indicators already warm. Pooling that with a full run
   * would compare two different games and flatter whichever is easier.
   */
  preloadBars: number
  /**
   * What the chosen source currently holds for this ticker.
   *
   * `source` and `ticker` alone stopped identifying a price path once tickers became
   * downloadable: re-downloading AAPL tomorrow yields the same source, the same
   * symbol, and one more bar. Without this, a refreshed dataset would keep competing
   * against records set on the old one — silently, and in the direction that flatters
   * whichever was easier.
   *
   * Taken from `TickerMeta` — the source's view of the whole series — rather than from
   * the bars a run was handed, so the value is the same before the run and after it.
   * `dateRange` already covers playing a slice of it.
   */
  series: {
    barCount: number
    /** Epoch seconds. */
    lastBarTime: number
  }
}

export function fingerprintPayload(config: RunConfig, inputs: FingerprintInputs): Hashable {
  return {
    v: FINGERPRINT_VERSION,

    // Different price path entirely.
    source: config.data.source,
    ticker: config.data.ticker,
    dateRange: config.data.dateRange
      ? { from: config.data.dateRange.from, to: config.data.dateRange.to }
      : null,
    // The dataset behind that ticker, which a download can change under it.
    series: { barCount: inputs.series.barCount, lastBarTime: inputs.series.lastBarTime },

    // Reaction time available, and how much history is readable when deciding.
    scrollSpeed: config.scrollSpeed,
    visibleBarCount: inputs.visibleBarCount,
    /**
     * Present only when preload is actually in use.
     *
     * `canonicalize` drops `undefined` keys, so a run without preload hashes exactly as
     * it did before this key existed — which is what lets the feature ship without a
     * `FINGERPRINT_VERSION` bump, and a bump would have emptied every player's
     * personal-best bucket.
     */
    preload: inputs.preloadBars > 0 ? inputs.preloadBars : undefined,

    // Available strategies, and position granularity.
    allowShorting: config.allowShorting,
    startingCapital: config.startingCapital,
    entrySize: config.entrySize,

    // Materially changes achievable outcomes — and whether the discipline
    // streak can be lost at all. A stop's indicator dependencies travel inside
    // its own params, which is why `indicators.*` can stay excluded.
    stops: config.stops.active
      .map((stop) => ({
        typeId: stop.typeId,
        advisory: stop.advisory,
        params: stop.params as Record<string, number>,
      }))
      // Order in the list is not part of the challenge.
      .sort((a, b) => (a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0)),

    // Changes the achievable arcadeScore for the same trading.
    streakEnabled: config.scoring.streakEnabled,
    maxMultiplier: config.scoring.maxMultiplier,

    // Change what patterns are legible on screen.
    priceTransform: config.priceTransform,
    normalizationMode: config.normalizationMode,
  }
}

export function runFingerprint(config: RunConfig, inputs: FingerprintInputs): string {
  return stableHash(fingerprintPayload(config, inputs))
}
