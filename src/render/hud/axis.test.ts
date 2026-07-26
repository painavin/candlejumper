import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import { axisLabels, axisUnitLabel } from './axis.js'
import type { AxisFormat } from './axis.js'

const format = (overrides: Partial<AxisFormat> = {}): AxisFormat => ({
  mode: defaultConfig().normalizationMode,
  transform: 'none',
  reference: 100,
  ...overrides,
})

describe('axisLabels', () => {
  it('spans the bounds from ground to chart top', () => {
    const labels = axisLabels({ min: 100, max: 200 }, format())
    expect(labels[0]?.unit).toBe(0)
    expect(labels[labels.length - 1]?.unit).toBe(1)
  })

  it('describes the same bounds the poles were drawn from', () => {
    // The axis is the inverse of the normalizer, not a parallel system — a label
    // at unit 0.5 must be the midpoint of the bounds.
    const labels = axisLabels({ min: 100, max: 200 }, format())
    const middle = labels.find((l) => l.unit === 0.5)
    expect(middle?.text).toBe('150')
  })

  it('returns nothing for a degenerate span rather than dividing by zero', () => {
    expect(axisLabels({ min: 100, max: 100 }, format())).toEqual([])
  })

  it('shows cents on a low-priced series and whole dollars on a high one', () => {
    // NKE trades in the 40s and AAPL in the 300s; the same axis has to read
    // sensibly for both.
    expect(axisLabels({ min: 1, max: 9 }, format())[0]?.text).toBe('1.00')
    expect(axisLabels({ min: 100, max: 300 }, format())[0]?.text).toBe('100')
  })

  it('labels relative mode as a percentage, not a price', () => {
    const labels = axisLabels({ min: 90, max: 110 }, format({ mode: 'starting-price-relative' }))
    expect(labels[0]?.text).toBe('90%')
  })

  it('labels a log axis with its magnitude', () => {
    const labels = axisLabels({ min: 2, max: 3 }, format({ transform: 'log10' }))
    expect(labels[0]?.text).toBe('2.00')
  })
})

describe('axisUnitLabel', () => {
  it('names the unit so a % axis is never read as a $ axis', () => {
    expect(axisUnitLabel(format())).toBe('$')
    expect(axisUnitLabel(format({ mode: 'starting-price-relative' }))).toBe('% of start')
    expect(axisUnitLabel(format({ transform: 'log10' }))).toBe('log₁₀ $')
    expect(axisUnitLabel(format({ mode: 'starting-price-relative', transform: 'log10' }))).toBe(
      '% (log)'
    )
  })
})
