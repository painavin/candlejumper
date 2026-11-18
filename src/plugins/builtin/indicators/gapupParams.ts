import type { ParamSpec, ParamValues } from '@shared/contracts/index.js'

/**
 * The parameters of the gap-up breakout ATR pullback signal, declared once.
 *
 * The indicator and the `pullback-stop` that enforces its level both list these. They
 * used to each carry a copy, which is how two copies of a *default* drift apart — and a
 * stop whose defaults differ from the overlay the player is looking at is two different
 * numbers with the same name, the thing `pullback-stop` exists to prevent.
 *
 * Defaults are the Paisa breakout scan's (`Scan.cs` → `ScanGapupBreakoutAtrPullback`):
 * a 20-bar breakout, a 10% gap, ATR 7, entry two ATR back with a 20%-of-ATR touch
 * tolerance, one ATR of risk, a two-ATR trail armed at two R, and the trail sitting at
 * the retrace depth (`trailAtRetraceDepth: true`). The scan runs two legs, at 2× and 3×;
 * this runs the first.
 */

export const BREAKOUT_LENGTH: ParamSpec = {
  key: 'breakoutLength',
  displayName: 'Breakout window',
  type: 'int',
  default: 20,
  min: 2,
  max: 250,
  step: 1,
  unit: 'bars',
}

export const GAPUP_PERCENT: ParamSpec = {
  key: 'gapupPercent',
  displayName: 'Gap-up size',
  type: 'percent',
  default: 10,
  min: 0.1,
  max: 50,
  step: 0.1,
  unit: '%',
}

export const ATR_LENGTH: ParamSpec = {
  key: 'atrLength',
  displayName: 'ATR length',
  type: 'int',
  default: 7,
  min: 2,
  max: 100,
  step: 1,
  unit: 'bars',
}

/** Entry depth: `atrFactor1` in the Paisa indicator, the first leg's. */
export const ATR_FACTOR: ParamSpec = {
  key: 'atrFactor',
  displayName: 'Entry depth',
  type: 'float',
  default: 2,
  min: 0.5,
  max: 10,
  step: 0.1,
  unit: '× ATR',
}

export const ATR_TOLERANCE_PERCENT: ParamSpec = {
  key: 'atrTolerancePercent',
  displayName: 'Retrace tolerance',
  type: 'percent',
  default: 20,
  min: 0,
  max: 100,
  step: 1,
  // Percent *of the ATR*, not of price: the thing being tolerated is a near-miss of a
  // level that is itself measured in ATRs, so a fixed price tolerance would mean
  // something different on every ticker.
  unit: '% of ATR',
}

/** Risk per trade, in ATR beyond the entry. One R. */
export const STOP_FACTOR: ParamSpec = {
  key: 'stopFactor',
  displayName: 'Initial stop',
  type: 'float',
  default: 1,
  min: 0.1,
  max: 10,
  step: 0.1,
  unit: '× ATR',
}

/** Trail distance behind the peak close, in ATR off the ATR at entry. */
export const TRAIL_FACTOR: ParamSpec = {
  key: 'trailFactor',
  displayName: 'Trail distance',
  type: 'float',
  default: 2,
  min: 0.1,
  max: 10,
  step: 0.1,
  unit: '× ATR',
}

/** Profit at which the trail arms, in R. Ignored while the trail sits at the retrace depth. */
export const ACTIVATION_R: ParamSpec = {
  key: 'activationR',
  displayName: 'Trail arms at',
  type: 'float',
  default: 2,
  min: 0,
  max: 10,
  step: 0.1,
  unit: 'R',
}

export const TIGHTEN_STOP_WITH_ATR: ParamSpec = {
  key: 'tightenStopWithAtr',
  displayName: 'Tighten stop as ATR contracts',
  type: 'bool',
  default: 0,
}

export const TRAIL_AT_RETRACE_DEPTH: ParamSpec = {
  key: 'trailAtRetraceDepth',
  displayName: 'Trail at the entry depth',
  type: 'bool',
  default: 1,
}

export const GAPUP_PARAMS: readonly ParamSpec[] = [
  BREAKOUT_LENGTH,
  GAPUP_PERCENT,
  ATR_LENGTH,
  ATR_FACTOR,
  ATR_TOLERANCE_PERCENT,
  STOP_FACTOR,
  TRAIL_FACTOR,
  ACTIVATION_R,
  TIGHTEN_STOP_WITH_ATR,
  TRAIL_AT_RETRACE_DEPTH,
]

/** A param's value, falling back to its declared default. */
export function paramOr(params: ParamValues, spec: ParamSpec): number {
  return params[spec.key] ?? (spec.default as number)
}
