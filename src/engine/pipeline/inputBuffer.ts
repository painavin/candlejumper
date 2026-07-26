/**
 * Input buffering.
 *
 * Presses are buffered during a bar and applied at step 3 of the tick pipeline,
 * in press order, at that bar's completed close. Multiple presses in one bar all
 * apply.
 *
 * A press during the growth animation still fills at the bar's completed close —
 * the player commits before seeing the final height, which is intentional: it's
 * the same commitment a real trader makes intraday, and the alternative
 * (blocking input during growth) would drop presses.
 */

/** What the engine understands. Button names stop existing at `input/`'s edge. */
export type TradeAction = 'buy' | 'sell' | 'flatten'

export interface InputBuffer {
  /** Enqueue a press. Order is preserved. */
  push(action: TradeAction): void
  /** Take everything buffered and clear. */
  drain(): TradeAction[]
  /**
   * Discard without applying. Used on pause: presses buffered during the
   * interrupted bar must not land on the bar that resolves after a resume —
   * the same mis-assignment bug as banking stalled bars, through another door.
   */
  clear(): void
  readonly length: number
}

export function createInputBuffer(): InputBuffer {
  let pending: TradeAction[] = []

  return {
    push(action) {
      pending.push(action)
    },
    drain() {
      const drained = pending
      pending = []
      return drained
    },
    clear() {
      pending = []
    },
    get length() {
      return pending.length
    },
  }
}
