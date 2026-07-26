/**
 * One trading day. Field names match the bundled data schema exactly, so there
 * is one representation end to end and no remapping layer.
 *
 * See docs/data-sources.md#bar-schema.
 */
export interface OhlcvBar {
  /** open */
  o: number
  /** high */
  h: number
  /** low */
  l: number
  /** close */
  c: number
  /** volume */
  v: number
  /**
   * Epoch SECONDS (not milliseconds), UTC, market-open aligned.
   * Anything handing this to `new Date()` must multiply by 1000.
   */
  t: number
}
