import type {
  IndicatorRequest,
  ParamSpec,
  ParamValues,
  StopInstance,
  StopPlugin,
} from '@shared/contracts/index.js'

/**
 * An ATR (volatility) stop — the first consumer of
 * [indicators in stops](../../../../docs/stops.md).
 *
 * It exists to prove the mechanism end to end: a stop declaring what it needs via
 * `requires()`, sized from its *own* params, with the host owning instantiation and
 * per-bar feeding.
 *
 * Note that this stop legitimately **widens** when volatility rises. Forcing
 * monotonic tightening would break it, which is exactly why the engine records
 * widening rather than forbidding it — see
 * docs/stops.md#no-monotonic-tightening-enforcement.
 */

const ATR_LENGTH: ParamSpec = {
  key: 'atrLength',
  displayName: 'ATR length',
  type: 'int',
  default: 14,
  min: 2,
  max: 100,
  step: 1,
  unit: 'bars',
}

const MULTIPLE: ParamSpec = {
  key: 'multiple',
  displayName: 'ATR multiple',
  type: 'float',
  default: 2.5,
  min: 0.5,
  max: 10,
  step: 0.1,
  unit: '×',
}

export const atrStop: StopPlugin = {
  id: 'atr-stop',
  displayName: 'ATR (volatility) stop',
  params: [ATR_LENGTH, MULTIPLE],

  /**
   * The dependency is derived from this stop's own params, which is why it needs no
   * config key of its own — and why it travels inside `stops.active` for the run
   * fingerprint rather than leaking into `indicators.*`.
   */
  requires(params: ParamValues): IndicatorRequest[] {
    return [
      {
        key: 'atr',
        indicatorId: 'atr',
        params: { length: params.atrLength ?? (ATR_LENGTH.default as number) },
      },
    ]
  },

  createInstance(params: ParamValues): StopInstance {
    const multiple = params.multiple ?? (MULTIPLE.default as number)

    return {
      reset() {
        // Nothing per-trade to remember. Critically, this does NOT reset the ATR
        // instance — the host owns that, and it keeps warming across trades so a
        // 14-bar stop doesn't restart warm-up on every entry.
      },

      onBar(bar, position, indicators) {
        if (position.size === 0) return null

        const atr = indicators.atr?.atr
        // Warm-up must produce null, never a NaN level: every comparison against
        // NaN is false, so a NaN level is a stop the HUD shows as active that can
        // never fire — strictly worse than having no stop.
        if (atr === undefined || !Number.isFinite(atr)) return null

        const distance = atr * multiple
        return position.size > 0 ? bar.c - distance : bar.c + distance
      },
    }
  },
}
