import type { OhlcvBar } from './bar.js'
import type { ParamSpec, ParamValues } from './params.js'

/**
 * An indicator plugin. Built-ins and user plugins are both just objects
 * matching this shape — there is no separate "official indicator" code path.
 *
 * See docs/indicators.md#typescript-indicator-contract.
 */
export interface IndicatorPlugin {
  id: string
  displayName: string
  /**
   * Short form for chart legends and pane titles, e.g. `SMA`.
   *
   * Needed because several instances of one indicator can be active at once, and a
   * legend reading "Simple Moving Average 20 / Simple Moving Average 50 / Simple
   * Moving Average 200" is unreadable at the size a legend has to be. Optional:
   * `displayName` is the fallback, so an existing plugin keeps working.
   */
  abbreviation?: string
  /**
   * A rendering hint only. An indicator must be usable with no pane at all,
   * because stop plugins consume indicators as numbers — see
   * docs/indicators.md#two-consumers-the-chart-and-stop-plugins.
   */
  paneKind: 'overlay' | 'oscillator'
  /** Named output series, e.g. ['macd', 'signal', 'histogram']. */
  outputs: string[]
  /**
   * How each output wants to be drawn, keyed by output name. Omit for one plain line
   * per output, which is what a moving average or an oscillator wants.
   *
   * A **default**, not a decision: the settings screen lists every output with its
   * style and colour, and a player's choice wins. What the plugin knows and the player
   * doesn't is which of its outputs is a continuous level and which is an event on a
   * scattered handful of bars — joining four marks out of two hundred with a line
   * draws three long diagonals through unrelated price action and reads as a trend
   * nothing measured.
   */
  outputStyles?: Record<string, IndicatorOutputStyle>
  params: ParamSpec[]
  /**
   * Which param keys appear in an instance's label. Unset means all of them.
   *
   * For an indicator with more than three or four, appending every value produces a
   * row of digits rather than a legend. See `instanceLabel`.
   */
  labelParams?: string[]
  /**
   * Other indicators this one is built from, derived from its own params — so an
   * `atrLength` param can size the ATR it asks for. Omit if none.
   *
   * **The same mechanism stops already use**, deliberately: a composite indicator
   * (a breakout-and-pullback signal built from ATR and a rolling high) would
   * otherwise have to re-implement its parts inline, and every later indicator that
   * wanted the same parts would copy them again. Sharing is already the repo's
   * precedent for bar-level maths, and the one genuine hazard of extending
   * `requires()` from stops to indicators — a dependency cycle, impossible while only
   * stops could declare it — is caught by the host at resolution time.
   *
   * The host resolves this once, before the first bar, and feeds the resulting
   * instances depth-first: every dependency sees a bar before the indicator that
   * asked for it does, so its outputs are this bar's, never last bar's. An
   * instance is owned by whoever asked for it and never shared, for the same
   * reason a stop's ATR is its own — see docs/indicators.md#composing-indicators.
   */
  requires?(params: ParamValues): IndicatorRequest[]
  /**
   * How many bars this needs before its outputs mean anything, from its own params.
   *
   * Declared rather than guessed, and used by one thing: the **preload** setting's
   * automatic mode, which starts playback that many bars in so the line is already
   * drawn when the run begins. A moving average that only appears after you've played
   * two hundred bars is no use for the decisions taken in the first minute, and no
   * amount of inspecting `params` from outside could tell the host which of them is a
   * bar count — `length` here, `breakoutLength` there, `multiple` never.
   *
   * Count only what *this* plugin consumes. The host takes the maximum across a
   * `requires()` tree, so a composite reports the bars its own arithmetic needs on top
   * of its inputs, not the total.
   *
   * Omitting it means "nothing", which is the safe answer: preload stays shorter than
   * it might be, and the indicator warms up on screen exactly as it does today.
   */
  warmupBars?(params: ParamValues): number
  /** Fixed y-range for oscillator panes that have one, e.g. [0, 100] for RSI. */
  fixedRange?: [number, number]
  createInstance(params: ParamValues): IndicatorInstance
}

/**
 * The naming half of a plugin — everything `instanceLabel` needs and nothing else.
 *
 * Deliberately narrower than `IndicatorPlugin` so `ui/` can label a row without
 * holding a plugin: the settings screen only ever has a descriptor (id, names, param
 * specs), never a `createInstance`. `IndicatorPlugin` satisfies this structurally, so
 * there's no adapter and no second implementation.
 */
export interface LabelledIndicator {
  displayName: string
  abbreviation?: string
  params: ParamSpec[]
  labelParams?: string[]
}

/**
 * The label for one configured instance, e.g. `SMA 20`.
 *
 * Derived in one place rather than at each consumer, because the chart legend, the
 * sub-pane title, and the settings row all have to agree — three instances of SMA are
 * only distinguishable if every surface names them identically.
 *
 * Every declared param is appended in declaration order, which is what makes this work
 * for an indicator with more than one: MACD(12, 26, 9) labels itself without needing to
 * know about this function. Integers print bare; anything else keeps a couple of
 * decimals so 0.5 doesn't collapse to 0.
 *
 * **`labelParams` narrows that to the ones that identify an instance.** Appending
 * everything stops scaling somewhere around four: a five-param indicator labels itself
 * `GBAP 20 3 7 2 5`, which is not a legend, it's a row of numbers. Naming the one or two
 * a player actually distinguishes instances by keeps the legend readable while the
 * settings row still shows all of them. Unset means all, so nothing existing changes.
 *
 * Unknown keys in `labelParams` are ignored rather than rendered as `?`: it names a
 * subset of `params`, and a typo there should cost a quiet omission, not a legend full
 * of question marks.
 */
export function instanceLabel(plugin: LabelledIndicator, params: ParamValues): string {
  const name = plugin.abbreviation ?? plugin.displayName
  const shown = plugin.labelParams
    ? plugin.params.filter((spec) => plugin.labelParams?.includes(spec.key))
    : plugin.params
  const values = shown.map((spec) => {
    const value = params[spec.key] ?? (spec.default as number)
    if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  })
  return values.length === 0 ? name : `${name} ${values.join(' ')}`
}

/**
 * How one output of an indicator is drawn.
 *
 * Every field is a **default the player can override** per instance, which is the
 * shape the settings UI needs: an indicator declares how its outputs are best read,
 * and the player has the final say on their own chart. See docs/indicators.md.
 */
export interface IndicatorOutputStyle {
  /**
   * `dots` marks each bar that has a value; `line` joins consecutive ones; `dash` is
   * a broken line, for a level that is informational rather than acted on; `none`
   * computes the output without drawing it.
   *
   * Default `line`. Note the modes treat a gap differently on purpose: a line breaks
   * and resumes, while dots simply aren't there — which is why a sparse output should
   * say `dots` rather than relying on NaN to do something sensible.
   *
   * `none` is worth declaring deliberately. An output that exists for a *stop* to
   * consume rather than for anyone to look at would otherwise put a line on the chart
   * that nobody asked for, and the player would have to turn it off every time.
   */
  draw?: IndicatorDrawStyle
  /** 24-bit RGB. Defaults to the instance's own colour when unset. */
  colour?: number
  /**
   * Pixels to lift the mark above its value. Only meaningful for `dots`.
   *
   * For a mark that flags *a bar* — a breakout, a gap — the exact y is arbitrary
   * (it's drawn at the bar's high because that's out of the way), so lifting it clear
   * of the candle costs nothing and stops the mark being swallowed by the wick. For a
   * mark that names *a price* — a stop level — an offset would be a lie about where
   * the level is, so those leave it unset.
   *
   * Pixels rather than price: a price offset would grow and shrink with the visible
   * range, so the clearance it buys would be different on every ticker.
   */
  offsetPx?: number
}

export type IndicatorDrawStyle = 'none' | 'line' | 'dots' | 'dash'

export interface IndicatorInstance {
  reset(): void
  /**
   * Called once per bar, in order. Returns one value per declared output.
   *
   * `indicators` carries this bar's outputs from everything `requires()` asked for,
   * keyed by request key then output name — already advanced to *this* bar, because
   * the host feeds dependencies first. An indicator that declares no `requires()`
   * receives an empty object and can simply omit the parameter.
   *
   * Return NaN for bars where the indicator isn't warmed up yet (e.g. an
   * SMA(20) before 20 bars exist) — the renderer skips NaN rather than drawing
   * a line to zero. A dependency that is still NaN must propagate as NaN rather
   * than as a number: a composite that substitutes zero for a warming input
   * reports a signal it hasn't actually measured. A stop consuming this must
   * translate NaN to a `null` level; see
   * docs/stops.md#warm-up-must-produce-null-never-a-nan-level.
   */
  onBar(bar: OhlcvBar, isLastBar: boolean, indicators: IndicatorValues): Record<string, number>
}

/**
 * One indicator another plugin asks for.
 *
 * Declared by both stops and indicators — `key` is the local name the asking plugin
 * reads the values back under, so it never has to know which id the host resolved.
 */
export interface IndicatorRequest {
  /** Local name the asking plugin reads its values under. */
  key: string
  /** Any id in the registry — built-in or user-loaded. */
  indicatorId: string
  params: ParamValues
}

/** This bar's indicator outputs, keyed by request key, then by output name. */
export type IndicatorValues = Record<string, Record<string, number>>
