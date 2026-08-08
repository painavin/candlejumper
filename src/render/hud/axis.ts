import type { NormalizationMode, PriceTransform } from '@config/index.js'
import { LAYOUT } from '@config/index.js'
import type { ChartBounds } from '@engine/output/index.js'

/**
 * Axis label maths, kept separate from drawing so it can be tested.
 *
 * The axis is **the inverse of the active normalizer, not a parallel system** —
 * it reads the same eased bounds the poles were drawn from, so the two can never
 * disagree about what the chart is showing (docs/hud.md).
 *
 * Label *units* depend on the active mode and transform, and getting that wrong
 * means a player reads a % axis as a $ axis.
 */

export interface AxisLabel {
  /** 0 at the ground, 1 at the chart top. */
  unit: number
  text: string
}

export interface AxisFormat {
  mode: NormalizationMode
  transform: PriceTransform
  /** For `starting-price-relative`, the value the first close maps to. */
  reference: number
}

/** A short suffix naming the unit, so a % axis is never mistaken for a $ axis. */
export function axisUnitLabel({ mode, transform }: AxisFormat): string {
  if (mode === 'starting-price-relative') return transform === 'log10' ? '% (log)' : '% of start'
  return transform === 'log10' ? 'log₁₀ $' : '$'
}

/**
 * One axis value as text.
 *
 * Exported so a stop tag formats identically to the gridline labels beside it. A tag
 * reading `3.41` next to gridlines reading `3.4` would look like a different quantity,
 * and on a percent axis an unconverted tag would be flatly wrong.
 */
export function formatValue(value: number, { mode, transform }: AxisFormat): string {
  if (transform === 'log10') return value.toFixed(2)
  if (mode === 'starting-price-relative') return `${value.toFixed(0)}%`
  // Cents matter under ~$10 and are noise above it.
  return Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(0)
}

/**
 * Evenly spaced labels across the bounds.
 *
 * Deliberately *not* snapped to round numbers: the bounds ease continuously, so
 * a "nice number" algorithm would make labels pop between values while the chart
 * slides smoothly underneath. Even spacing keeps the axis quiet, and the
 * gridline positions then always correspond to a real height.
 */
export function axisLabels(bounds: ChartBounds, format: AxisFormat): AxisLabel[] {
  const count = LAYOUT.axisLabelCount
  const span = bounds.max - bounds.min
  if (!(span > 0)) return []

  return Array.from({ length: count }, (_, i) => {
    const unit = i / (count - 1)
    return { unit, text: formatValue(bounds.min + span * unit, format) }
  })
}
