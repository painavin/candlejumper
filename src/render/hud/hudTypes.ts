/**
 * Local re-exports of the engine's output types, plus the render-only ones.
 *
 * `render/` may import `@engine/output` and nothing else in `engine/`; funnelling
 * the types through here keeps that single dependency obvious at a glance.
 */
export type { FrameState, HudState, StopLine, StreakView, ChartBounds } from '@engine/output/index.js'

/** Direction of a P&L value, for the sign-and-shape encoding. */
export type PnlSign = 'up' | 'down' | 'flat'
