import type {
  IndicatorInstance,
  IndicatorPlugin,
  IndicatorRequest,
  ParamValues,
} from '@shared/contracts/index.js'
import { RetraceLeg } from './retraceLeg.js'
import {
  ACTIVATION_R,
  ATR_FACTOR,
  ATR_LENGTH,
  ATR_TOLERANCE_PERCENT,
  BREAKOUT_LENGTH,
  GAPUP_PARAMS,
  GAPUP_PERCENT,
  STOP_FACTOR,
  TIGHTEN_STOP_WITH_ATR,
  TRAIL_AT_RETRACE_DEPTH,
  TRAIL_FACTOR,
  paramOr,
} from './gapupParams.js'

/**
 * Gap-up / breakout, then a pull back to an ATR level — a port of
 * `GapupBreakoutAtrPullback.cs` in the Paisa library, run as **one leg**.
 *
 * The strategy: a stock that gaps up or closes at a new N-bar high is armed. From there a
 * retrace level sits `atrFactor` ATRs below the close and ratchets upward; the bar whose
 * low first reaches it (within a tolerance) is the entry. Once entered, a `RetraceLeg`
 * carries the trade: a fixed initial stop one ATR beyond the entry, then a trail, and
 * the cycle ends when a close goes through whichever of the two is in force. All of that
 * lifecycle lives in `RetraceLeg`, which is a line-for-line port too — this file is only
 * the bar-by-bar wiring that `OnBarUpdate` is in the original.
 *
 * ## Settings are the breakout scan's
 *
 * `Scan.cs` builds this indicator as `(20, 10.0, 7, 2.0, 3.0, 20)` with the trail at the
 * retrace depth. The two legs there are depths 2.0 and 3.0; the game runs the first, and
 * the defaults below are that scan's.
 *
 * ## The stop is the point
 *
 * The `stop` output is `RetraceLeg.stopPrice` while the leg holds a position, and the
 * `pullback-stop` plugin enforces exactly that. It lines up with the game's timing
 * without translation: both exit on the **close**, and a level computed at bar N is
 * enforced against bar N+1's close — which is the bar the leg itself would test it on.
 *
 * ## Where it differs from the original, and why
 *
 * - **ATR is computed here, as a simple average of true range** — the original's
 *   `AverageTrueRange`. It is not asked for from the shared `atr` indicator, which is
 *   Wilder's smoothing: a different number for the same name, which would move every
 *   level in this file. The shared one is left alone because `atr-stop` is built on it.
 *   Like the original, it reports from the first bar, averaging what it has so far.
 * - **The breakout window stays the shared `breakout` indicator**, which is a full
 *   window of closes and says nothing until it is full. The original's reports a
 *   "breakout" on the second bar of a series because a one-bar window is trivially its
 *   own high. After the first `breakoutLength` bars the two agree exactly; a run
 *   preloads its warm-up, so the difference is the first few bars of a series that has
 *   no history before it.
 * - **A gap is the original's close-to-close move**, on any bar that is not weekly or
 *   monthly. The original gates on `Duration <= Daily`; a bar here carries no interval,
 *   so the same gate is read off the spacing from the previous bar — more than five days
 *   is a weekly or monthly bar, whose period return is not a gap.
 * - **Volatility ratio and the risk/sort figures are not computed.** They are the
 *   scanner's sort keys, and nothing here sorts anything.
 * - **One leg, not two.**
 */

/**
 * The longest break between bars that can still hold a gap. Above a long holiday weekend
 * and below a weekly bar's seven, which is what keeps a weekly period's return from being
 * read as a gap — standing in for the original's `Duration <= Daily`.
 */
const GAP_BREAK_MAX_SECONDS = 5 * 24 * 60 * 60

export const gapupBreakoutAtrPullbackIndicator: IndicatorPlugin = {
  id: 'gapup-breakout-atr-pullback',
  displayName: 'Gap-up Breakout ATR Pullback',
  abbreviation: 'GBAP',
  paneKind: 'overlay',
  outputs: ['breakout', 'gapup', 'retrace', 'stop', 'retraceHit'],
  params: [...GAPUP_PARAMS],
  // Ten values in a legend is a row of digits, not a label. The window and the entry
  // depth are what a player actually runs two instances of side by side.
  labelParams: ['breakoutLength', 'atrFactor'],
  /**
   * What this needs *beyond* the breakout window the host adds for it — and no more.
   *
   * The ATR is computed here, in parallel with that window rather than after it, so the
   * two warm up together: the total is the larger of the breakout window and the ATR
   * window plus the seeding bar (the first bar's true range has no previous close to
   * reach back to). Two bars is the floor, for the one-bar look-back the gap and the
   * touch both need.
   *
   * Worth noting what this *can't* promise. It makes the signal computable; it does not
   * make a signal have *happened*, and a chart opens with a retrace level only if a
   * breakout or gap fell inside the preloaded bars. There's no honest number for "until
   * this fires" — that depends on the prices, not the parameters.
   */
  warmupBars: (params) =>
    Math.max(
      2,
      Math.round(paramOr(params, ATR_LENGTH)) + 1 - Math.round(paramOr(params, BREAKOUT_LENGTH))
    ),
  outputStyles: {
    // `breakout` and `gapup` are *events* on scattered bars, so they are marks rather
    // than lines. They are drawn at the bar's high, where the exact price is arbitrary —
    // so they lift clear of the candle, at different heights so a bar that both gapped
    // and broke out shows two marks instead of one overlap.
    breakout: { draw: 'dots', colour: 0x4fd6c8, offsetPx: 10 },
    gapup: { draw: 'dots', colour: 0xd2a8ff, offsetPx: 20 },
    // No offset: this one names a price the player might act on, and lifting it would
    // put the mark somewhere the level isn't. Rose rather than a fourth hue, because
    // every plugin-declared colour should be one the settings row can *name*.
    retraceHit: { draw: 'dots', colour: 0xff9ec4 },
    // The entry trigger as a broken line and the stop as a dot per bar. That pairing is
    // deliberate: the trigger is context, the stop is the number that closes the
    // position, and dashing the one you don't act on keeps them apart at a glance.
    retrace: { draw: 'dash' },
    stop: { draw: 'dots' },
  },

  requires(params: ParamValues): IndicatorRequest[] {
    return [
      {
        key: 'breakout',
        indicatorId: 'breakout',
        params: { length: paramOr(params, BREAKOUT_LENGTH) },
      },
    ]
  },

  createInstance(params: ParamValues): IndicatorInstance {
    const gapupPercent = paramOr(params, GAPUP_PERCENT)
    const atrLength = Math.max(2, Math.round(paramOr(params, ATR_LENGTH)))

    const leg = new RetraceLeg({
      retraceFactor: paramOr(params, ATR_FACTOR),
      stopFactor: paramOr(params, STOP_FACTOR),
      trailFactor: paramOr(params, TRAIL_FACTOR),
      tolerancePct: paramOr(params, ATR_TOLERANCE_PERCENT),
      activationR: paramOr(params, ACTIVATION_R),
      direction: 'long',
      tightenStopWithAtr: paramOr(params, TIGHTEN_STOP_WITH_ATR) !== 0,
      trailAtRetraceDepth: paramOr(params, TRAIL_AT_RETRACE_DEPTH) !== 0,
    })

    // ── ATR: a simple average of true range ────────────────────────────────────
    //
    // `FastSimpleMovingAverage` in the original: a running sum over a ring of the last
    // `atrLength` true ranges, averaging what exists until the ring is full.
    const trueRanges = new Float64Array(atrLength)
    let trSum = 0
    let trCount = 0

    /** The previous bar, for the gap, the true range, the break length, and the touch. */
    let previous: { c: number; l: number; t: number } | undefined

    const averageTrueRange = (high: number, low: number): number => {
      let trueRange = high - low
      if (previous !== undefined) {
        trueRange = Math.max(trueRange, Math.abs(high - previous.c))
        trueRange = Math.max(trueRange, Math.abs(low - previous.c))
      }

      const slot = trCount % atrLength
      if (trCount < atrLength) {
        trSum += trueRange
        trCount += 1
        trueRanges[slot] = trueRange
        return trSum / trCount
      }
      trSum = trSum + trueRange - (trueRanges[slot] as number)
      trueRanges[slot] = trueRange
      trCount += 1
      return trSum / atrLength
    }

    return {
      reset() {
        leg.reset()
        trueRanges.fill(0)
        trSum = 0
        trCount = 0
        previous = undefined
      },

      onBar(bar, _isLastBar, indicators) {
        // Every output defaults to NaN, so a bar says nothing unless something happened
        // on it. That's what makes the marks sparse and the levels absent while there is
        // no trade, rather than both being drawn at zero.
        const out: Record<string, number> = {
          breakout: Number.NaN,
          gapup: Number.NaN,
          retrace: Number.NaN,
          stop: Number.NaN,
          retraceHit: Number.NaN,
        }

        // Computed before the first-bar return: the original's ATR is auto-calculated on
        // every bar, so bar one's true range is already in the average on bar two.
        const atr = averageTrueRange(bar.h, bar.l)
        const prior = previous
        previous = { c: bar.c, l: bar.l, t: bar.t }

        if (prior === undefined) return out

        // Close to close, as the original reads it.
        const gapPercent = prior.c === 0 ? 0 : (100 * (bar.c - prior.c)) / prior.c
        const gappedUp = bar.t - prior.t <= GAP_BREAK_MAX_SECONDS && gapPercent >= gapupPercent
        const breakoutSignal = indicators.breakout?.signal
        const brokeOut = breakoutSignal !== undefined && Number.isFinite(breakoutSignal)

        // The breakout marker has always marked the start of a cycle rather than every
        // breakout bar, so it is read before the leg advances.
        const startingCycle = leg.phase === 'idle'

        leg.update(bar.c, bar.l, prior.l, atr, brokeOut || gappedUp)

        // We want to see the gap even if we are in a trade.
        if (gappedUp) out.gapup = bar.h
        if (brokeOut && startingCycle) out.breakout = bar.h

        // The two are mutually exclusive: the trigger is drawn while it is still a
        // trigger, the stop once there is a position for it to protect, and neither when
        // the leg is idle. The signal bar counts as pending so the entry there gets a
        // number.
        if (leg.isPendingEntry) out.retrace = leg.retraceLevel
        if (leg.inPosition) out.stop = leg.stopPrice(atr)

        // A mark where the leg signalled: the entry itself, or a return to the stop in
        // force that held. Both are "a second look at this trade" on the chart.
        if (leg.isSignalled) out.retraceHit = leg.entryPrice
        else if (leg.isRetraced) out.retraceHit = leg.retraceTouchPrice

        return out
      },
    }
  },
}
