/**
 * One ATR-measured pullback level, in either direction.
 *
 * A line-for-line port of `AtrRetraceLevel.cs` in the Paisa library, so the two code
 * bases answer the same question the same way. Deliberately smaller than `RetraceLeg`:
 * a consumer that wants "armed, and did price touch the level" should not inherit an
 * Entered/Trailing state machine it never enters. `RetraceLeg` holds one of these for
 * its Monitoring phase and adds the trade to it.
 *
 * Every level and comparison is written through a single sign (+1 long, -1 short),
 * which is what makes the short side a reflection rather than a copy.
 */

/** Which way the position trades. Long: breakout up, then a pullback down to the entry. */
export type TradeDirection = 'long' | 'short'

export class AtrRetraceLevel {
  private readonly factor: number
  private readonly tolerancePct: number
  private readonly sign: 1 | -1

  /** The pullback price a touch is measured against. */
  level = 0
  isArmed = false

  /**
   * @param factor Depth of the pullback, in ATR back from the close
   * @param tolerancePct Touch slack, as a percent of ATR. Needed because exact touches
   *   were being missed on intraday data.
   * @param direction Long by default; short mirrors every level
   */
  constructor(
    factor: number,
    tolerancePct: number,
    readonly direction: TradeDirection = 'long'
  ) {
    this.factor = factor
    this.tolerancePct = tolerancePct
    this.sign = direction === 'short' ? -1 : 1
  }

  /**
   * Sets the level to the pullback off this close, discarding whatever it held. Used
   * both to arm a fresh cycle and to reset after a stop-out, where ratcheting would
   * leave the level above the stop just closed under and end the cycle on the next bar.
   */
  arm(close: number, atr: number): void {
    this.level = this.pullbackFrom(close, atr)
    this.isArmed = true
  }

  /**
   * Ends the cycle. Leaves `level` where it was: disarming is about whether a cycle is
   * running, and a caller still reporting the stop an entry would carry needs the last
   * level rather than a zero. `reset` is the one that clears it.
   */
  disarm(): void {
    this.isArmed = false
  }

  /**
   * Moves the level toward profit if this bar's pullback is shallower, and leaves it
   * alone otherwise. One way only.
   */
  ratchet(close: number, atr: number): void {
    this.level = this.ahead(this.level, this.pullbackFrom(close, atr))
  }

  /** The level widened toward price by the tolerance, which is what a touch is tested against. */
  toleratedLevel(atr: number): number {
    return this.toleratedAt(this.level, atr)
  }

  /**
   * True on the bar the extreme first reaches the level — the low for a long, the high
   * for a short. Tested across two bars rather than on one, so a pullback that sits
   * below the level for a week signals once.
   *
   * @param extreme This bar's low for a long, high for a short
   * @param prevExtreme The previous bar's, same side
   */
  touched(extreme: number, prevExtreme: number, atr: number): boolean {
    return this.touchedAt(this.level, extreme, prevExtreme, atr)
  }

  /**
   * The same touch against another level, so a leg's retrace of its stop reads the
   * tolerance exactly as its entry does.
   */
  touchedAt(level: number, extreme: number, prevExtreme: number, atr: number): boolean {
    const tolerated = this.toleratedAt(level, atr)
    return this.advance(extreme, tolerated) <= 0 && this.advance(prevExtreme, tolerated) > 0
  }

  private toleratedAt(level: number, atr: number): number {
    return level + this.sign * this.tolerance(atr)
  }

  /** How far toward price the tolerance widens a level, for this ATR. */
  tolerance(atr: number): number {
    return this.tolerancePct * (atr / 100)
  }

  /**
   * True once the close has fallen back through the level, which is how every user of
   * one decides the move has failed.
   */
  closedBack(close: number): boolean {
    return this.advance(close, this.level) < 0
  }

  /** Back to the constructed state. */
  reset(): void {
    this.level = 0
    this.isArmed = false
  }

  // ── Sign arithmetic ──────────────────────────────────────────────────────────
  //
  // Public because a leg built on this level expresses its stops, its trail and its
  // targets through the same sign, and two definitions of "further along the profit
  // direction" is exactly the kind of duplication this class exists to remove.

  /** The pullback level this close and ATR imply. */
  pullbackFrom(close: number, atr: number): number {
    return close - this.sign * atr * this.factor
  }

  /** Whichever level is further along the profit direction — higher for a long, lower for a short. */
  ahead(a: number, b: number): number {
    return this.sign * (a - b) > 0 ? a : b
  }

  /**
   * The mirror of `ahead` — further back against the profit direction, so it reads as a
   * ceiling on a stop.
   */
  behind(a: number, b: number): number {
    return this.sign * (a - b) < 0 ? a : b
  }

  /**
   * How far price sits beyond `level` in the profit direction, so positive is always
   * profit and every threshold reads the same for both directions.
   */
  advance(price: number, level: number): number {
    return this.sign * (price - level)
  }
}
