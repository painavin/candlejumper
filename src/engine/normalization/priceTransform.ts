import type { PriceTransform } from '@config/index.js'

/**
 * `priceTransform` is applied to price *before* normalization, and composes
 * with any mode rather than replacing one — "log price, then visible-window
 * min/max" is a legitimate setting that a single enum couldn't express.
 *
 * It's causal in its own right: a per-bar function with no dependence on other
 * bars, so it inherits the legality of whichever mode it composes with.
 */
export function applyPriceTransform(price: number, transform: PriceTransform): number {
  return transform === 'log10' ? Math.log10(price) : price
}

/** Inverse, for turning an axis position back into a price for labelling. */
export function invertPriceTransform(value: number, transform: PriceTransform): number {
  return transform === 'log10' ? Math.pow(10, value) : value
}
