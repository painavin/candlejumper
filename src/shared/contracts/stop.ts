import type { OhlcvBar } from './bar.js'
import type { IndicatorRequest, IndicatorValues } from './indicator.js'
import type { ParamSpec, ParamValues } from './params.js'

/**
 * `IndicatorRequest` and `IndicatorValues` live with the indicators now that both
 * kinds of plugin declare `requires()`. Re-exported here because they were a stop
 * concept first and `stops.md` documents them as part of this contract.
 */
export type { IndicatorRequest, IndicatorValues }

/**
 * A stop strategy. Handed the position state after each bar closes, it returns
 * the level to enforce on the NEXT bar — see
 * docs/stops.md#causality-and-timing for why that off-by-one is the whole
 * design rather than an implementation detail.
 */
export interface StopPlugin {
  id: string
  displayName: string
  /** Same ParamSpec as indicators; drives the settings UI. */
  params: ParamSpec[]
  /**
   * Indicators this stop needs, derived from its own params — so an
   * `atrLength` param can size the ATR the stop asks for. Omit if none.
   *
   * The host resolves this once at run start and feeds the resulting
   * instances every bar from the first bar of the run, not just while a
   * position is open. See docs/stops.md#using-indicators-inside-a-stop-plugin.
   */
  requires?(params: ParamValues): IndicatorRequest[]
  createInstance(params: ParamValues): StopInstance
}

/**
 * One configured stop instance, as plain data.
 *
 * Lives here rather than in `config/` because the plugin host needs it and the
 * host may not import the config tree — it has no business knowing what else is
 * in a run's configuration. `config`'s `StopInstanceConfig` is this type.
 */
export interface StopInstanceSpec {
  typeId: string
  params: ParamValues
  /** Display the level without enforcing it; the player must honour it. */
  advisory: boolean
}

export interface StopInstance {
  /**
   * Called on entry. Does NOT reset the stop's indicators — those are owned by
   * the host and warmed from the first bar of the run, so a 14-bar ATR stop
   * doesn't restart warm-up on every trade.
   */
  reset(): void
  /**
   * Called once after each bar closes, while a position is open. Returns the
   * absolute price level to enforce on the NEXT bar, or null for "no stop
   * active this bar".
   *
   * Must return null while any indicator it depends on is still NaN: every
   * comparison against NaN is false, so a NaN level is a stop the HUD shows as
   * active that can never fire. The engine coerces non-finite levels to null
   * regardless, as belt and braces.
   */
  onBar(bar: OhlcvBar, position: PositionState, indicators: IndicatorValues): number | null
}

/** What a stop plugin knows about the open position. */
export interface PositionState {
  /** Signed: >0 long, <0 short. */
  size: number
  avgCost: number
  barsHeld: number
  /** Most favourable close since entry, direction-aware. */
  bestPrice: number
  /** Least favourable close since entry, direction-aware. */
  worstPrice: number
  entryBarIndex: number
}
