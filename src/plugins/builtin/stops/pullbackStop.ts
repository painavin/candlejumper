import type {
  IndicatorRequest,
  ParamSpec,
  ParamValues,
  StopInstance,
  StopPlugin,
} from '@shared/contracts/index.js'

/**
 * `pullback-stop` — the stop level the gap-up breakout pullback signal already draws.
 *
 * The first stop built on a **composite** indicator, and the case that decided the
 * design of the whole port. The signal computes a ratcheting level from a breakout, an
 * ATR and its own trade state; a player looking at that level on the chart and running
 * a stop that recomputed it here would eventually be looking at two different numbers
 * with the same name. So this asks for the indicator and reports what it says.
 *
 * ## Why this is a separate plugin rather than part of the indicator
 *
 * Indicators describe, stops enforce, and the engine only lets the second close a
 * position. Keeping them apart is also what makes the indicator usable *without*
 * automatic exits — a player who wants to see the level and honour it by hand simply
 * doesn't add this, or adds it as advisory. See docs/stops.md.
 *
 * ## Params are the indicator's, deliberately duplicated
 *
 * Five params, matching the indicator's, because `requires()` is resolved from a
 * plugin's **own** params and its instance is its own — it cannot read the settings
 * of a chart overlay, by design, or hiding an overlay could move a live stop. The cost
 * is that a player running both has to keep two sets of numbers in step; the
 * alternative is a stop whose level changes when a chart is toggled, which the docs
 * call the worst outcome available.
 */

const BREAKOUT_LENGTH: ParamSpec = {
  key: 'breakoutLength',
  displayName: 'Breakout window',
  type: 'int',
  default: 20,
  min: 2,
  max: 250,
  step: 1,
  unit: 'bars',
}

const GAPUP_PERCENT: ParamSpec = {
  key: 'gapupPercent',
  displayName: 'Gap-up size',
  type: 'percent',
  default: 4,
  min: 0.1,
  max: 50,
  step: 0.1,
  unit: '%',
}

const ATR_LENGTH: ParamSpec = {
  key: 'atrLength',
  displayName: 'ATR length',
  type: 'int',
  default: 7,
  min: 2,
  max: 100,
  step: 1,
  unit: 'bars',
}

const ATR_FACTOR: ParamSpec = {
  key: 'atrFactor',
  displayName: 'ATR factor',
  type: 'float',
  default: 2,
  min: 0.5,
  max: 10,
  step: 0.1,
  unit: '×',
}

const ATR_TOLERANCE_PERCENT: ParamSpec = {
  key: 'atrTolerancePercent',
  displayName: 'Retrace tolerance',
  type: 'percent',
  default: 5,
  min: 0,
  max: 100,
  step: 1,
  unit: '% of ATR',
}

export const pullbackStop: StopPlugin = {
  id: 'pullback-stop',
  displayName: 'Gap-up breakout pullback stop',
  params: [BREAKOUT_LENGTH, GAPUP_PERCENT, ATR_LENGTH, ATR_FACTOR, ATR_TOLERANCE_PERCENT],

  requires(params: ParamValues): IndicatorRequest[] {
    return [
      {
        key: 'signal',
        indicatorId: 'gapup-breakout-atr-pullback',
        // Passed through whole: this stop has no opinion about any of them, and
        // filtering to "the ones that matter" would silently pin the rest to the
        // indicator's defaults the day one of them starts mattering.
        params: { ...params },
      },
    ]
  },

  createInstance(): StopInstance {
    return {
      reset() {
        // Nothing per-trade. Deliberately does not reset the indicator — the host owns
        // it and keeps it warm across trades, which for this signal matters more than
        // most: its trade state is what produces the level at all, and restarting it on
        // entry would mean no level until the *next* breakout.
      },

      onBar(_bar, position, indicators) {
        if (position.size === 0) return null

        const level = indicators.signal?.stop
        // Absent whenever the signal has no open trade of its own, which is most bars.
        // Returning null then is correct rather than a failure: the player entered
        // somewhere this signal wasn't watching, and a stop that invented a level for
        // that case would enforce a rule nothing computed.
        if (level === undefined || !Number.isFinite(level)) return null

        // Longs only, honestly. The level sits below price by construction — a
        // breakout pullback is a long idea — so handing it to a short would place the
        // stop on the profitable side and fire it immediately. A short position gets
        // no level rather than a harmful one.
        return position.size > 0 ? level : null
      },
    }
  },
}
