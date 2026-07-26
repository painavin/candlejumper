import type { IndicatorPlugin, StopPlugin } from '@shared/contracts/index.js'
import { atrIndicator, smaIndicator } from './indicators/sma.js'
import { atrStop } from './stops/atrStop.js'
import { fixedPercentStop } from './stops/fixedPercent.js'
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
 * or without an indicator registry. `atr-stop` does, and is the proof that the
 * indicator-consuming mechanism works end to end.
 */
export const builtinStops: readonly StopPlugin[] = [fixedPercentStop, trailingPercentStop, atrStop]

export const builtinIndicators: readonly IndicatorPlugin[] = [smaIndicator, atrIndicator]

export { fixedPercentStop, trailingPercentStop, atrStop, smaIndicator, atrIndicator }
