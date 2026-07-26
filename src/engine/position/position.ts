import type { RunConfig } from '@config/index.js'
import { FLAT_THRESHOLD_SHARES, MIN_FUNDABLE_ENTRY_FRACTION } from '@config/index.js'

/**
 * Signed position sizing, cost basis, and capital.
 *
 * Signed from day one even though `allowShorting` ships off: retrofitting sign
 * into a scalar position later would touch cost basis, P&L, stops, and rendering
 * at once. Positive is long, negative is short, zero is flat.
 *
 * Everything here is a pure function over numbers with exactly known expected
 * values, which is the point — this is where a subtle sign error silently
 * produces wrong scores forever.
 */

export interface Position {
  /** Signed, fractional shares. >0 long, <0 short, 0 flat. */
  shares: number
  /** Weighted average entry price. Meaningless when flat. */
  avgCost: number
  /** Open entry presses — exactly how many exit presses remain to reach flat. */
  unitCount: number
  /** Realized P&L for the run so far. */
  realizedPnl: number
  /** Bar index of the entry that left flat, for `barsHeld`. */
  entryBarIndex: number
  /** Most favourable close since entry, direction-aware. */
  bestPrice: number
  /** Least favourable close since entry, direction-aware. */
  worstPrice: number
}

export function flatPosition(): Position {
  return {
    shares: 0,
    avgCost: 0,
    unitCount: 0,
    realizedPnl: 0,
    entryBarIndex: -1,
    bestPrice: 0,
    worstPrice: 0,
  }
}

export type Direction = 'long' | 'short' | 'flat'

export function directionOf(position: Position): Direction {
  if (isFlat(position)) return 'flat'
  return position.shares > 0 ? 'long' : 'short'
}

/**
 * Any absolute size below the flat threshold is exactly flat. Unit-symmetric
 * exits should land on zero exactly, so this is a floating-point guard rather
 * than the primary mechanism.
 */
export function isFlat(position: Position): boolean {
  return Math.abs(position.shares) < FLAT_THRESHOLD_SHARES
}

/** Starting capital plus everything realized. Rises on wins, falls on losses. */
export function cashBalance(position: Position, config: RunConfig): number {
  return config.startingCapital + position.realizedPnl
}

/** Capital committed at cost. Short proceeds are locked collateral, not credit. */
export function deployedAtCost(position: Position): number {
  return Math.abs(position.shares) * position.avgCost
}

/**
 * Buying power for a new entry.
 *
 * Both halves of the `min` are load-bearing and pull in opposite directions:
 *
 *   - Capping at `startingCapital` stops profits compounding, so `entrySize`
 *     keeps meaning "one fifth of a full deployment" and unit counts stay
 *     comparable between runs.
 *   - Taking `cashBalance` when it's lower stops the player trading money they
 *     have already lost. Without it, someone down 90% could still deploy five
 *     units of capital that no longer exists, and percent return could pass
 *     −100% in a cash account with no leverage.
 *
 * See docs/game-design.md#short-account-model.
 */
export function buyingPower(position: Position, config: RunConfig): number {
  const ceiling = Math.min(cashBalance(position, config), config.startingCapital)
  return Math.max(0, ceiling - deployedAtCost(position))
}

/** Cash one entry press wants to deploy, before any clamp. */
export function entryCash(config: RunConfig): number {
  return config.startingCapital * config.entrySize
}

/** Mark-to-market on the open position. Signed, so it works both directions. */
export function unrealizedPnl(position: Position, markPrice: number): number {
  if (isFlat(position)) return 0
  return position.shares * (markPrice - position.avgCost)
}

export function totalPnl(position: Position, markPrice: number): number {
  return position.realizedPnl + unrealizedPnl(position, markPrice)
}

/** Percent return on starting capital — what makes scores comparable across tickers. */
export function percentReturn(position: Position, config: RunConfig, markPrice: number): number {
  return (totalPnl(position, markPrice) / config.startingCapital) * 100
}

export interface EntryResult {
  position: Position
  /** Cash actually deployed, after clamping to buying power. */
  deployed: number
  sharesAdded: number
  /** True when this press opened from flat rather than adding. */
  opened: boolean
}

/**
 * Deploy one unit of cash in `direction`, clamped to available buying power.
 *
 * A clamped entry still counts as one unit: exits divide *shares*, not cash, so
 * N presses still take N presses to unwind even when the last unit is a runt.
 * That's why there is no `startingCapital / entrySize` unit ceiling — buying
 * power is the only bound.
 */
export function openOrAdd(
  position: Position,
  direction: 'long' | 'short',
  price: number,
  config: RunConfig,
  barIndex: number
): EntryResult | { denied: 'no-buying-power' } {
  const available = buyingPower(position, config)
  const wanted = entryCash(config)
  const deployed = Math.min(wanted, available)

  // Dust guard: without it, a player at full deployment can inflate unitCount
  // with meaningless presses and dilute every subsequent exit.
  if (deployed < wanted * MIN_FUNDABLE_ENTRY_FRACTION) return { denied: 'no-buying-power' }

  const sign = direction === 'long' ? 1 : -1
  const sharesAdded = (deployed / price) * sign
  const wasFlat = isFlat(position)
  const shares = wasFlat ? sharesAdded : position.shares + sharesAdded

  // Weighted-average cost: each entry blends into a single average price
  // weighted by size.
  const avgCost = wasFlat
    ? price
    : (position.avgCost * Math.abs(position.shares) + price * Math.abs(sharesAdded)) /
      Math.abs(shares)

  return {
    position: {
      ...position,
      shares,
      avgCost,
      unitCount: position.unitCount + 1,
      entryBarIndex: wasFlat ? barIndex : position.entryBarIndex,
      bestPrice: wasFlat ? price : position.bestPrice,
      worstPrice: wasFlat ? price : position.worstPrice,
    },
    deployed,
    sharesAdded,
    opened: wasFlat,
  }
}

export interface ExitResult {
  position: Position
  /** Signed shares closed, carrying the position's sign. */
  closedShares: number
  realized: number
  /** True when this press returned the position to flat. */
  wentFlat: boolean
  /** Units closed — 1 for a press, all of them for a flatten. */
  unitsClosed: number
}

/**
 * Close one unit: `shares / unitCount`, an equal share of what remains.
 *
 * With 5 units open, successive exits close 1/5, then 1/4 of the remainder, then
 * 1/3, 1/2, 1/1 — reaching exactly flat on the fifth press. A naive "close 25%
 * of the remaining position" decays geometrically and never closes: 49 presses
 * to reach the flat threshold.
 */
export function reduceOneUnit(position: Position, price: number): ExitResult {
  const units = Math.max(1, position.unitCount)
  const closedShares = position.shares / units
  return closeShares(position, closedShares, price, 1)
}

/** Close every open unit in a single action — one exit event, not N. */
export function flatten(position: Position, price: number): ExitResult {
  return closeShares(position, position.shares, price, Math.max(1, position.unitCount))
}

function closeShares(
  position: Position,
  closedShares: number,
  price: number,
  unitsClosed: number
): ExitResult {
  // closedShares carries the position's sign, so a short closed below its
  // average entry yields a positive result without a separate formula.
  const realized = closedShares * (price - position.avgCost)
  const remaining = position.shares - closedShares
  const unitCount = Math.max(0, position.unitCount - unitsClosed)

  const wentFlat = unitCount === 0 || Math.abs(remaining) < FLAT_THRESHOLD_SHARES
  const next: Position = wentFlat
    ? {
        ...flatPosition(),
        realizedPnl: position.realizedPnl + realized,
      }
    : {
        ...position,
        shares: remaining,
        unitCount,
        realizedPnl: position.realizedPnl + realized,
      }

  return { position: next, closedShares, realized, wentFlat, unitsClosed }
}

/**
 * Track the extremes since entry, direction-aware. Called once per bar close
 * while a position is open; trailing stops read `bestPrice`.
 */
export function markBar(position: Position, close: number): Position {
  if (isFlat(position)) return position
  const long = position.shares > 0
  return {
    ...position,
    bestPrice: long ? Math.max(position.bestPrice, close) : Math.min(position.bestPrice, close),
    worstPrice: long ? Math.min(position.worstPrice, close) : Math.max(position.worstPrice, close),
  }
}
