import type {
  IndicatorInstance,
  IndicatorPlugin,
  IndicatorRequest,
  ParamSpec,
  ParamValues,
} from '@shared/contracts/index.js'

/**
 * Gap-up / breakout, then a pull back to an ATR stop level.
 *
 * The strategy in one sentence: a stock that gaps up or closes at a new N-bar high is
 * in play; from there a trailing level sits `atrFactor` ATRs below the close and
 * ratchets upward, and the bar whose low first reaches that level is the entry the
 * signal exists to find. The trade is over when a close falls through the level.
 *
 * ## Why this is the indicator worth porting first
 *
 * It exercises every part of the plugin contract at once: five params (so typed
 * fields rather than sliders had to exist first), several outputs of *different kinds*
 * (marks on scattered bars, and continuous levels — so per-output draw styles had to
 * exist first), and it is **built from two other indicators** rather than computing
 * them inline, which is what `requires()` on an indicator is for. Everything before
 * this step was in service of it.
 *
 * ## Composed, not inlined
 *
 * `breakout` and `atr` are asked for by `requires()` and arrive as values. Inlining
 * either would have been fewer lines today and a second, subtly different copy of
 * each formula for every later indicator that wants them — the repo already shares
 * bar-level maths for exactly this reason, and an ATR that disagrees with the ATR stop
 * a player is also running would be the worst kind of bug: invisible and about risk.
 *
 * ## What a gap means, and when it can't happen
 *
 * A gap is the distance between one session's close and the next session's open —
 * something that can only form while the market is shut. So a bar is treated as
 * gappable only when it is separated from the previous bar by an overnight-or-longer
 * break, measured from the bars' own timestamps rather than from a configured
 * interval. That gets three cases right with one rule: daily bars always qualify;
 * intraday bars qualify only for the first bar of a session, which is precisely where
 * an intraday gap lives; and weekly or monthly bars never do, because the difference
 * between two monthly closes is a quarter's return, not a gap.
 *
 * ## Deviations from the original, deliberately
 *
 * The source strategy ran **two** trades in parallel with a second retrace/stop pair
 * at a wider ATR factor. Dropped: one signal that a player can read beats two that
 * differ by a multiplier they can't see, and the second pair's interactions with the
 * first ("reset trade 2 if trade 1 reopens") were bookkeeping rather than strategy.
 * Volatility-ratio and position-risk figures are also dropped — those are a scanner's
 * sort keys, and nothing here sorts anything.
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
  // Percent *of the ATR*, not of price: the thing being tolerated is a near-miss of a
  // level that is itself measured in ATRs, so a fixed price tolerance would mean
  // something different on every ticker.
  unit: '% of ATR',
}

/**
 * The shortest and longest break between bars that can hold a gap.
 *
 * Twelve hours is below any overnight session break (a 16:00 close to a 09:30 open is
 * about seventeen and a half) and far above any intraday bar spacing. Five days is
 * above a long holiday weekend and below a weekly bar's seven, which is what keeps a
 * weekly period's return from being read as a gap.
 */
const GAP_BREAK_SECONDS = { min: 12 * 60 * 60, max: 5 * 24 * 60 * 60 }

function canGap(secondsSincePreviousBar: number): boolean {
  return (
    secondsSincePreviousBar >= GAP_BREAK_SECONDS.min &&
    secondsSincePreviousBar <= GAP_BREAK_SECONDS.max
  )
}

export const gapupBreakoutAtrPullbackIndicator: IndicatorPlugin = {
  id: 'gapup-breakout-atr-pullback',
  displayName: 'Gap-up Breakout ATR Pullback',
  abbreviation: 'GBAP',
  paneKind: 'overlay',
  outputs: ['breakout', 'gapup', 'retrace', 'stop', 'retraceHit'],
  params: [BREAKOUT_LENGTH, GAPUP_PERCENT, ATR_LENGTH, ATR_FACTOR, ATR_TOLERANCE_PERCENT],
  // Five values in a legend is a row of digits, not a label. The window and the ATR
  // factor are what a player actually runs two instances of side by side.
  labelParams: ['breakoutLength', 'atrFactor'],
  /**
   * Two, on top of whatever its inputs need — which the host adds for it.
   *
   * Its own arithmetic looks back exactly one bar: the gap compares two closes, and the
   * retrace crossing compares two lows. Everything else it knows comes from `breakout`
   * and `atr`, and reporting their lengths here as well would preload twice over.
   *
   * Worth noting what this *can't* promise. Two bars makes the signal computable; it
   * does not make a signal have *happened*, and a chart opens with a retrace level only
   * if a breakout or gap fell inside the preloaded bars. There's no honest number for
   * "until this fires" — that depends on the prices, not the parameters.
   */
  warmupBars: () => 2,
  outputStyles: {
    // Three of the five outputs are *events* on scattered bars, so they are marks
    // rather than lines. `breakout` and `gapup` are drawn at the bar's high, where the
    // exact price is arbitrary — so they lift clear of the candle, at different heights
    // so a bar that both gapped and broke out shows two marks instead of one overlap.
    breakout: { draw: 'dots', colour: 0x4fd6c8, offsetPx: 10 },
    gapup: { draw: 'dots', colour: 0xd2a8ff, offsetPx: 20 },
    // No offset: this one names a price the player might act on, and lifting it would
    // put the mark somewhere the level isn't. Rose rather than a fourth hue, because
    // every plugin-declared colour should be one the settings row can *name* — an
    // unlisted value shows as "Custom…" and tells the player nothing.
    retraceHit: { draw: 'dots', colour: 0xff9ec4 },
    // The ratchet as a broken line and the stop as a dot per bar. That pairing is
    // deliberate: the retrace level is context, the stop is the number that closes the
    // position, and dashing the one you don't act on keeps them apart at a glance.
    retrace: { draw: 'dash' },
    stop: { draw: 'dots' },
  },

  requires(params: ParamValues): IndicatorRequest[] {
    return [
      {
        key: 'breakout',
        indicatorId: 'breakout',
        params: { length: params.breakoutLength ?? (BREAKOUT_LENGTH.default as number) },
      },
      {
        key: 'atr',
        indicatorId: 'atr',
        params: { length: params.atrLength ?? (ATR_LENGTH.default as number) },
      },
    ]
  },

  createInstance(params: ParamValues): IndicatorInstance {
    const gapupPercent = params.gapupPercent ?? (GAPUP_PERCENT.default as number)
    const atrFactor = params.atrFactor ?? (ATR_FACTOR.default as number)
    const tolerancePercent =
      params.atrTolerancePercent ?? (ATR_TOLERANCE_PERCENT.default as number)

    let inTrade = false
    let retracePrice = Number.NaN
    /** The previous bar, for the gap, the break length, and the retrace crossing. */
    let previous: { c: number; l: number; t: number } | undefined

    return {
      reset() {
        inTrade = false
        retracePrice = Number.NaN
        previous = undefined
      },

      onBar(bar, _isLastBar, indicators) {
        // Every output defaults to NaN, so a bar says nothing unless something
        // happened on it. That's what makes the marks sparse and the levels absent
        // while no trade is open, rather than both being drawn at zero.
        const out: Record<string, number> = {
          breakout: Number.NaN,
          gapup: Number.NaN,
          retrace: Number.NaN,
          stop: Number.NaN,
          retraceHit: Number.NaN,
        }

        const atr = indicators.atr?.atr
        const breakoutSignal = indicators.breakout?.signal
        const prior = previous
        previous = { c: bar.c, l: bar.l, t: bar.t }

        // A dependency still warming up propagates as nothing, never as a number: an
        // entry taken with a NaN ATR fixes `retracePrice` at NaN for the whole run,
        // so the level would never draw and the trade would never close.
        if (prior === undefined || atr === undefined || !Number.isFinite(atr)) return out

        const gapPercent = prior.c === 0 ? 0 : (100 * (bar.c - prior.c)) / prior.c
        const gappedUp = canGap(bar.t - prior.t) && gapPercent >= gapupPercent
        const brokeOut = breakoutSignal !== undefined && Number.isFinite(breakoutSignal)

        // Marked whether or not it starts a trade: a gap during an open trade is still
        // information about the bar, and hiding it would make the chart disagree with
        // what the player can see in the candles.
        if (gappedUp) out.gapup = bar.h

        if (!inTrade && (brokeOut || gappedUp)) {
          // Only marked when it *starts* a trade, so a mark reads as "this is where
          // the signal began" rather than as every bar that happened to close high.
          if (brokeOut) out.breakout = bar.h
          inTrade = true
          retracePrice = bar.c - atr * atrFactor
          // No level on the entry bar, and no exit test either: a bar cannot both open
          // and close a signal, or a single wide bar would produce a complete trade
          // nobody could have acted on.
          return out
        }

        if (inTrade) {
          // Ratchets upward only. It follows price up and then holds, which is what
          // makes "price came back to it" a meaningful event rather than a restatement
          // of wherever price happens to be.
          retracePrice = Math.max(retracePrice, bar.c - atr * atrFactor)
          out.retrace = retracePrice
          out.stop = retracePrice - atr

          // The tolerance exists because an exact touch is a coin flip on real data —
          // a level missed by a cent is the same trade in every way that matters, and
          // on intraday bars the near-misses outnumber the touches.
          const tolerated = retracePrice + (tolerancePercent * atr) / 100
          // The *crossing*, not the state: `prior.l > tolerated` is what makes this the
          // first bar to reach the level, so a slow drift along it marks once instead
          // of on every bar.
          if (bar.l <= tolerated && prior.l > tolerated) out.retraceHit = tolerated

          if (bar.c < retracePrice) inTrade = false
        }

        return out
      },
    }
  },
}
