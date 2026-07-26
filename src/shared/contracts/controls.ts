/**
 * The touch-control seam.
 *
 * `ui/mobile/` draws the thumb buttons and `input/` decides what a gesture means,
 * and neither zone may import the other. So the shape they agree on lives here —
 * the same pattern as `StopInstanceSpec`, for the same reason: one definition, two
 * readers, no dependency between them.
 *
 * Names describe the *gesture*, not the trade. `exitDown`/`exitUp` rather than
 * `sell`/`flatten`, because which of those a press becomes depends on how long it's
 * held, and only `input/` knows that rule.
 */
export interface TouchHandlers {
  buy(): void
  exitDown(): void
  exitUp(): void
  /** The pointer left the button, or the run ended mid-hold. */
  cancel(): void
  pause(): void
}
