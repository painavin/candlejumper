import type { CloudParams, HeightfieldParams, MotifParams } from '@shared/contracts/index.js'

/**
 * A visual theme is a **parameter set, not an asset bundle**.
 *
 * Because every visual is generated at runtime, adding a mood costs no art
 * production — just numbers. Rendering code always asks "what does the *current*
 * theme supply for layer N" and never branches on theme id, which is what keeps
 * that true.
 *
 * Pole *height* is always price data and is never touched by a theme; only pole
 * colour and cap style are skinnable.
 */

export interface ThemePalette {
  /** Vertical gradient, top then bottom. */
  sky: [number, number]
  /** Back to front, one per terrain layer instance. */
  mountains: [number, number]
  trees: number
  poles: number
  polesForming: number
  ground: number
  groundLine: number
  clouds: number
  fog: number
  foreground: number
}

/** HUD/UI colours matched to the mood, so a switch never leaves them mismatched. */
export interface AccentPalette {
  text: number
  dim: number
  axisLine: number
  accent: number
}

export interface VisualTheme {
  id: string
  displayName: string
  palette: ThemePalette
  accent: AccentPalette
  terrain: {
    /** Two mountain ranges, back and front, for cheap depth. */
    mountainsFar: HeightfieldParams
    mountainsNear: HeightfieldParams
    trees: HeightfieldParams
  }
  clouds: CloudParams
  foreground: MotifParams
  poles: {
    /** Rounded caps read playful; flat caps read like a terminal. */
    capStyle: 'round' | 'flat'
    outline: boolean
  }
}
