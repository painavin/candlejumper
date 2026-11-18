import { AtrRetraceLevel } from './atrRetraceLevel.js'
import type { TradeDirection } from './atrRetraceLevel.js'

/**
 * One retrace-and-enter trade lifecycle.
 *
 * A line-for-line port of `RetraceLeg.cs` in the Paisa library, kept as close to it as
 * the language allows — same phases, same order of operations inside `update`, same
 * names bar the casing — so a behaviour change on one side can be carried to the other
 * by reading the diff. The Paisa indicator runs two of these at two depths; this port
 * is run as a single leg.
 *
 * Flow: Idle → Monitoring → Entered → Trailing → Idle
 *
 * - A breakout or gapup moves from Idle to Monitoring.
 * - While Monitoring, the retrace level trails up with price. When price touches the
 *   retrace level, a signal fires and we enter.
 * - Once Entered, a fixed initial stop (stopFactor×ATR below entry) protects the trade.
 *   A stop-out ends the cycle; the next trade needs a fresh breakout.
 * - While holding, a pullback back to the stop in force that closes above it is a
 *   retrace — a second chance at the entry — and counts as a signal.
 * - Once price reaches +activationR profit, the trailing stop activates. The trail
 *   ratchets up (never down) at peakClose − trailFactor×ATR.
 * - When trailed out, the cycle resets to Idle.
 *
 * Key behaviours:
 * - Only ONE signal fires per Monitoring→Entered transition (no duplicates).
 * - Stop is never checked on the signal bar (entry and exit cannot be the same bar).
 * - Entry is on the bar extreme, both exits are on the close, so an intraday spike
 *   through a stop does not end a trade the bar closed the right side of.
 * - The retrace level ratchets in the profit direction in every phase.
 * - Close back through the retrace while Monitoring resets to Idle (move failed).
 * - ATR is frozen at entry, so stop, target and trail share one R.
 * - The trail arms at activationR and is trailFactor/stopFactor wide in R, so it locks
 *   the difference between the two. Equal is breakeven.
 * - Under trailAtRetraceDepth the trail sits at the ratcheted max of
 *   (close − retraceFactor × ATR) since entry and needs no activation, making that
 *   level a ceiling on the stop.
 *
 * A short leg is this machine reflected: every level sits the other side of price and
 * every comparison reverses, carried by a single sign. Directional words here read in
 * the trade's own direction — "up" is toward profit, which for a short is down the chart.
 *
 * ## Why this matters to the game
 *
 * `stopPrice` is the number the `pullback-stop` plugin enforces. It is evaluated on the
 * **close** and the game enforces a level computed at bar N against bar N+1's close, so
 * the two line up without help: the stop in force after bar N is exactly the stop bar
 * N+1 is tested against, and the trail can only move on bar N+1 to a level below that
 * bar's close, which a close cannot be at or below.
 */

/** Idle, then Monitoring once armed, Entered on the touch, Trailing once the trail takes over. */
export type TradePhase = 'idle' | 'monitoring' | 'entered' | 'trailing'

/** Which phases hold a position. One definition, shared with anything that stored a phase. */
export function holdsPosition(phase: TradePhase): boolean {
  return phase === 'entered' || phase === 'trailing'
}

export interface RetraceLegOptions {
  /** Entry depth, in ATR back from the close */
  retraceFactor: number
  /** Risk, in ATR beyond the entry. This is one R */
  stopFactor: number
  /** Trail distance, in ATR back from the peak */
  trailFactor: number
  /** Touch slack, as a percent of ATR */
  tolerancePct: number
  /**
   * Profit at which the trail arms, in R rather than in ATR — the target only means
   * anything relative to what was risked.
   *
   * It interacts with trailFactor, and the interaction is the whole exit model. The
   * trail is trailFactor/stopFactor wide in R, so at the moment it arms it sits
   * activationR − trailFactor/stopFactor above the entry. Equal, and it arms exactly at
   * breakeven and can only lock profit as the peak extends further; wider than
   * activationR + 1 and it arms below the initial stop, where the floor makes arming a
   * no-op.
   */
  activationR: number
  /** Long by default; short mirrors every level */
  direction?: TradeDirection
  /**
   * Lets the stop tighten as ATR contracts, one way only: it moves to
   * entry − stopFactor × min(ATR since entry), so risk can shrink but never grow back.
   * Off by default.
   *
   * Only the stop moves. The activation, the trail width and every reported R stay on
   * the ATR at entry, so R remains one number per trade and a realised loss can come in
   * under the risk that was accepted rather than the accepted risk being rewritten
   * after the fact.
   */
  tightenStopWithAtr?: boolean
  /**
   * Trails at the ratcheted max of (close − retraceFactor × ATR) since entry instead of
   * at trailFactor off the entry ATR, and drops the activationR gate. That level is a
   * ceiling: the stop cannot tighten past it, whichever mechanism is moving it. Each
   * close is paired with its own ATR, so a contraction cannot lift the level a volatile
   * bar set. Off by default.
   */
  trailAtRetraceDepth?: boolean
  /**
   * Also count a retrace on the bar that closes through the stop. Off, as the trade it
   * would be a second chance at has just ended.
   */
  retraceOnExitBar?: boolean
}

export class RetraceLeg {
  private readonly stopFactor: number
  private readonly trailFactor: number
  private readonly activationR: number
  private readonly tightenStopWithAtr: boolean
  private readonly trailAtRetraceDepth: boolean

  /**
   * The Monitoring phase, and the sign arithmetic every level in this leg is expressed
   * through. One implementation, shared with anything else that wants a pullback level.
   */
  private readonly level: AtrRetraceLevel

  private entryAtr = 0
  private trailActivationPrice = 0

  /** Lowest ATR seen since entry. Only read when tightening is on, where the stop is anchored to it. */
  private minAtr = 0

  /** Best close since entry — the highest for a long, the lowest for a short. */
  private peakClose = 0

  /**
   * Ratcheted max of (close − retraceFactor × ATR) since entry. Each close is paired
   * with its own ATR, so a later contraction cannot lift the level a high-volatility
   * bar set.
   */
  private retraceCap = 0

  /** This bar's close, for the stop an idle leg would carry if it armed now. */
  private lastClose = 0

  // ── Public state ─────────────────────────────────────────────────────────────

  /** Fixed at construction; sets the sign of every price comparison. */
  readonly direction: TradeDirection

  /** Idle, then Monitoring once armed, Entered on the touch, Trailing once the trail takes over. */
  phase: TradePhase = 'idle'

  /**
   * This bar only — cleared at the top of every `update`. The past tense is grammar, not
   * persistence: `signalCount > 0` is the sticky version.
   */
  isSignalled = false

  /**
   * This bar only: price came back to the stop in force and, unless `retraceOnExitBar`,
   * closed the right side of it. The trade is unchanged.
   */
  isRetraced = false

  /** Signals this cycle — the entry, then one per retrace of the stop. */
  signalCount = 0

  /** Also count a retrace on the bar that closes through the stop. */
  readonly retraceOnExitBar: boolean

  /**
   * The stop level a retrace touched on this bar. Only meaningful while `isRetraced`.
   * Not in the Paisa leg, which reports the bare flag; the game wants a price to mark.
   */
  retraceTouchPrice = 0

  /**
   * The retrace level before this bar's close ratcheted it — where a resting order would
   * have been sitting through the bar.
   */
  previousRetraceLevel = 0

  /**
   * `retraceLevel` on the touch bar, even when the bar only reached the tolerance band
   * and never traded at it. Zero when flat.
   */
  entryPrice = 0

  /**
   * The stop accepted at entry, stopFactor ATR beyond it. Frozen for the life of the
   * trade even when tightening is on, because this is the risk the position was sized
   * against — rewriting it would make risk-at-entry a retroactive number.
   */
  initialStopPrice = 0

  /**
   * The stop actually in force: the initial stop, moved up as ATR contracts when
   * tightening is on. Equal to `initialStopPrice` otherwise, and the floor under the
   * trail either way.
   */
  stopFloorPrice = 0

  /** Set when the leg starts trailing and only ratchets toward profit after; zero until then. */
  trailStopPrice = 0

  constructor(options: RetraceLegOptions) {
    this.stopFactor = options.stopFactor
    this.trailFactor = options.trailFactor
    this.activationR = options.activationR
    this.tightenStopWithAtr = options.tightenStopWithAtr ?? false
    this.trailAtRetraceDepth = options.trailAtRetraceDepth ?? false
    this.retraceOnExitBar = options.retraceOnExitBar ?? false

    this.direction = options.direction ?? 'long'
    this.level = new AtrRetraceLevel(
      options.retraceFactor,
      options.tolerancePct,
      this.direction
    )
  }

  /** +1 long, -1 short, for the leg's own levels. */
  private get sign(): 1 | -1 {
    return this.direction === 'short' ? -1 : 1
  }

  /**
   * Advances the leg by one bar. `armed` is a breakout or gapup on this bar. The extreme
   * is the bar's low for a long and its high for a short — the side the pullback has to
   * reach through to touch the entry.
   */
  update(
    close: number,
    extreme: number,
    prevExtreme: number,
    atr: number,
    armed: boolean
  ): void {
    this.isSignalled = false
    this.isRetraced = false
    this.lastClose = close
    this.previousRetraceLevel = this.level.level

    // The retrace level is the depth this leg is named for, so it ratchets in every
    // phase rather than only while Monitoring — a level frozen for the life of a trade
    // plots as a flat line and tells a chart nothing. Nothing about the open trade reads
    // it: the entry, the stop and the trail are all captured at the signal, so keeping
    // it current cannot move a stop.
    if (this.phase !== 'idle') {
      this.level.ratchet(close, atr)
    }

    // Ratchet the whole expression, not the peak against a live ATR, or a contraction
    // walks the cap up toward a peak close price never revisits.
    if (this.trailAtRetraceDepth && this.inPosition) {
      this.retraceCap = this.ahead(this.retraceCap, this.pullbackFrom(close, atr))
    }

    switch (this.phase) {
      case 'idle':
        this.updateIdle(close, atr, armed)
        break
      case 'monitoring':
        this.updateMonitoring(close, extreme, prevExtreme, atr)
        break
      case 'entered':
        this.updateEntered(close, extreme, prevExtreme, atr)
        break
      case 'trailing':
        this.updateTrailing(close, extreme, prevExtreme, atr)
        break
      default:
        throw new Error(`Unknown phase: ${String(this.phase)}`)
    }
  }

  /** Returns the leg to its constructed state. */
  reset(): void {
    this.phase = 'idle'
    this.isSignalled = false
    this.isRetraced = false
    this.signalCount = 0
    this.lastClose = 0
    this.previousRetraceLevel = 0
    this.retraceTouchPrice = 0
    this.level.reset()
    this.clearTrade()
  }

  /**
   * Drops everything captured at a signal. Called when a cycle arms and on a stop-out,
   * because a caller reading `entryPrice` beside `stopPrice` would otherwise pair the
   * finished trade's entry with the stop the *next* one would carry — two different
   * trades in one line.
   */
  private clearTrade(): void {
    this.entryPrice = 0
    this.initialStopPrice = 0
    this.stopFloorPrice = 0
    this.trailStopPrice = 0
    this.entryAtr = 0
    this.minAtr = 0
    this.peakClose = 0
    this.retraceCap = 0
    this.trailActivationPrice = 0
  }

  private updateIdle(close: number, atr: number, armed: boolean): void {
    if (armed) {
      this.phase = 'monitoring'
      this.level.arm(close, atr)
      this.signalCount = 0
      this.clearTrade()
    }
  }

  private updateMonitoring(
    close: number,
    extreme: number,
    prevExtreme: number,
    atr: number
  ): void {
    if (this.level.touched(extreme, prevExtreme, atr)) {
      // ATR frozen here, so stop, target and trail share one R
      this.entryAtr = atr
      this.minAtr = atr
      this.entryPrice = this.retraceLevel
      this.initialStopPrice = this.entryPrice - this.sign * this.entryAtr * this.stopFactor
      this.stopFloorPrice = this.initialStopPrice

      this.isSignalled = true
      this.signalCount++
      this.peakClose = close
      this.retraceCap = this.pullbackFrom(close, atr)
      this.trailActivationPrice =
        this.entryPrice + this.sign * this.activationR * this.entryAtr * this.stopFactor
      this.phase = 'entered'
      return
    }

    // If close breaks back through the retrace level, the move has failed
    if (this.level.closedBack(close)) {
      this.phase = 'idle'
      this.level.disarm()
    }
  }

  private updateEntered(
    close: number,
    extreme: number,
    prevExtreme: number,
    atr: number
  ): void {
    this.tightenStopFloor(atr)

    // On the close, so an intraday spike through the stop does not end it. A re-entry
    // off the stop-out close would chase a falling price, so the next trade needs a
    // fresh breakout.
    const stoppedOut = this.advance(close, this.stopFloorPrice) <= 0
    this.checkRetrace(this.stopFloorPrice, extreme, prevExtreme, atr, stoppedOut)

    if (stoppedOut) {
      this.phase = 'idle'
      this.level.disarm()
      this.clearTrade()
      return
    }

    // Track peak for trail activation
    if (this.advance(close, this.peakClose) > 0) this.peakClose = close

    // At retrace depth the cap gates itself — it takes over once it clears the stop in
    // force.
    const trailTakesOver = this.trailAtRetraceDepth
      ? this.advance(this.rawTrailLevel(), this.stopFloorPrice) > 0
      : this.advance(this.peakClose, this.trailActivationPrice) >= 0

    if (trailTakesOver) {
      this.trailStopPrice = this.trailStopForPeak()
      this.phase = 'trailing'
    }
  }

  private updateTrailing(
    close: number,
    extreme: number,
    prevExtreme: number,
    atr: number
  ): void {
    this.tightenStopFloor(atr)

    // Update peak and trailing stop
    if (this.advance(close, this.peakClose) > 0) this.peakClose = close
    this.trailStopPrice = this.ahead(this.trailStopPrice, this.trailStopForPeak())

    // Trailed out → back to Idle (move is spent, needs a fresh breakout). On the close,
    // matching the initial stop.
    const trailedOut = this.advance(close, this.trailStopPrice) <= 0
    this.checkRetrace(this.trailStopPrice, extreme, prevExtreme, atr, trailedOut)

    if (trailedOut) {
      this.phase = 'idle'
      this.level.disarm()
    }
  }

  /**
   * A pullback to the stop in force is a second chance at the trade for anyone who
   * missed the entry, so it counts as a signal of the cycle.
   */
  private checkRetrace(
    stop: number,
    extreme: number,
    prevExtreme: number,
    atr: number,
    exited: boolean
  ): void {
    if (exited && !this.retraceOnExitBar) return

    if (this.level.touchedAt(stop, extreme, prevExtreme, atr)) {
      this.isRetraced = true
      this.retraceTouchPrice = stop
      this.signalCount++
    }
  }

  /**
   * Moves the floor up as ATR contracts, never back down. Anchored to the lowest ATR
   * since entry rather than the current one, so a quiet stretch keeps the risk it earned
   * even if volatility expands again.
   */
  private tightenStopFloor(atr: number): void {
    if (!this.tightenStopWithAtr) return

    this.minAtr = Math.min(this.minAtr, atr)
    let tightened = this.entryPrice - this.sign * this.minAtr * this.stopFactor

    // The depth is a ceiling on the stop however it is moving.
    if (this.trailAtRetraceDepth) {
      tightened = this.behind(tightened, this.rawTrailLevel())
    }

    this.stopFloorPrice = this.ahead(this.stopFloorPrice, tightened)
  }

  /** The trail this bar allows, before the floor. */
  private rawTrailLevel(): number {
    return this.trailAtRetraceDepth
      ? this.retraceCap
      : this.peakClose - this.sign * this.entryAtr * this.trailFactor
  }

  /**
   * Trail for the current peak, floored at the stop in force. Without the floor a trail
   * wider than (activationR + 1) × stopFactor would arm beyond the stop already accepted,
   * widening risk once the trade worked. The floor rises with the stop when tightening
   * is on.
   */
  private trailStopForPeak(): number {
    return this.ahead(this.rawTrailLevel(), this.stopFloorPrice)
  }

  /**
   * The retrace level for this close — retraceFactor ATR back against the trade, so
   * below the close for a long and above it for a short.
   */
  private pullbackFrom(close: number, atr: number): number {
    return this.level.pullbackFrom(close, atr)
  }

  /** Whichever level is further along this leg's profit direction. */
  private ahead(a: number, b: number): number {
    return this.level.ahead(a, b)
  }

  /** The mirror of `ahead` — further back against the profit direction. */
  private behind(a: number, b: number): number {
    return this.level.behind(a, b)
  }

  /**
   * How far price sits beyond `level` in this leg's profit direction, so positive is
   * always profit and every threshold reads the same for both directions.
   */
  private advance(price: number, level: number): number {
    return this.level.advance(price, level)
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  /**
   * The entry trigger after this bar's ratchet. A touch is tested against it widened by
   * the tolerance, but the entry is booked at the level itself.
   */
  get retraceLevel(): number {
    return this.level.level
  }

  /** The band a touch is tested within, for this ATR. */
  tolerance(atr: number): number {
    return this.level.tolerance(atr)
  }

  /** Holding a position, rather than waiting for the touch. */
  get inPosition(): boolean {
    return holdsPosition(this.phase)
  }

  /**
   * Whether the retrace level is still a live entry trigger. Once a trade is on it is
   * not — it is no longer a price anything would be entered at, so plotting it past this
   * point draws a line that wanders away from the market.
   */
  get isPendingEntry(): boolean {
    return this.phase === 'monitoring' || this.isSignalled
  }

  /**
   * Risk at entry as a percentage of it, positive either way. Zero when flat. Reads the
   * accepted stop, not the tightened one — this is what the position was sized against.
   */
  get riskPct(): number {
    return this.inPosition && this.entryPrice > 0
      ? ((this.sign * (this.entryPrice - this.initialStopPrice)) / this.entryPrice) * 100
      : 0
  }

  /**
   * The stop that governs while holding. While only armed there is no trade yet, so it
   * is the stop the entry would carry — which is what this indicator family has always
   * plotted. Idle has no level of its own, so it is the stop a cycle armed on this bar
   * would carry.
   */
  stopPrice(atr: number): number {
    switch (this.phase) {
      case 'trailing':
        return this.trailStopPrice
      case 'entered':
        return this.stopFloorPrice
      // The disarmed level is the last cycle's — a stock that fell after it would read
      // a stop far above price, a negative risk, and sort first
      case 'idle':
        return this.pullbackFrom(this.lastClose, atr) - this.sign * atr * this.stopFactor
      default:
        return this.retraceLevel - this.sign * atr * this.stopFactor
    }
  }
}
