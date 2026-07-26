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
export const FINGERPRINT_VERSION = 1

export interface FingerprintInputs {
  /**
   * The bar count actually in force, resolved once from orientation at run
   * start. Passed in rather than read off config because the config holds one
   * value per orientation and only the resolved one describes the challenge.
   */
  visibleBarCount: number
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

    // Reaction time available, and how much history is readable when deciding.
    scrollSpeed: config.scrollSpeed,
    visibleBarCount: inputs.visibleBarCount,

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
