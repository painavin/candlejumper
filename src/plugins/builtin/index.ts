import type { IndicatorPlugin, StopPlugin } from '@shared/contracts/index.js'
import { breakoutIndicator } from './indicators/breakout.js'
import { gapupBreakoutAtrPullbackIndicator } from './indicators/gapupBreakoutAtrPullback.js'
import { atrIndicator, smaIndicator } from './indicators/sma.js'
import { atrStop } from './stops/atrStop.js'
import { fixedPercentStop } from './stops/fixedPercent.js'
import { pullbackStop } from './stops/pullbackStop.js'
import { trailingPercentStop } from './stops/trailingPercent.js'

/**
 * The shipped plugins.
 *
 * Built-ins and user plugins conform to the exact same contract and run through the
 * same host, so there is no "official plugin" code path to special-case once
 * loaded. See docs/indicators.md#goal.
 */

/**
 * `fixed-percent` and `trailing-percent` declare no `requires()`, so they work with
 * or without an indicator registry. `atr-stop` asks for one indicator and
 * `pullback-stop` asks for a *composite* — the deepest dependency chain shipped, and
 * the proof that resolution recurses rather than only going one level.
 */
export const builtinStops: readonly StopPlugin[] = [
  fixedPercentStop,
  trailingPercentStop,
  atrStop,
  pullbackStop,
]

export const builtinIndicators: readonly IndicatorPlugin[] = [
  smaIndicator,
  atrIndicator,
  breakoutIndicator,
  gapupBreakoutAtrPullbackIndicator,
]

export {
  fixedPercentStop,
  trailingPercentStop,
  atrStop,
  pullbackStop,
  smaIndicator,
  atrIndicator,
  breakoutIndicator,
  gapupBreakoutAtrPullbackIndicator,
}
