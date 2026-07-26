import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults.js'
import { validateConfig } from './validate.js'
import type { ValidationContext } from './validate.js'

const context = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
  stopIds: new Set(['trailing-percent', 'fixed-percent']),
  indicatorIds: new Set(['sma']),
  sourceIds: new Set(['bundled']),
  ...overrides,
})

describe('validateConfig', () => {
  it('accepts the shipped defaults', () => {
    expect(validateConfig(defaultConfig(), context())).toEqual([])
  })

  it('rejects a stop plugin that is not registered', () => {
    const config = defaultConfig()
    config.stops.active = [{ typeId: 'chandelier', params: {}, advisory: false }]
    expect(validateConfig(config, context())).toEqual([
      { path: 'stops.active[0].typeId', message: 'no stop plugin registered with id "chandelier"' },
    ])
  })

  it('refuses the run when a stop needs an indicator that cannot resolve', () => {
    // Deliberately blocking rather than the mid-run auto-disable path: this is
    // knowable before the first bar, and starting a run whose stop silently
    // doesn't exist is the failure worth spending an error on.
    const config = defaultConfig()
    config.stops.active = [{ typeId: 'fixed-percent', params: { atrLength: 14 }, advisory: false }]
    const problems = validateConfig(
      config,
      context({
        stopRequirements: new Map([[0, [{ key: 'atr', indicatorId: 'atr' }]]]),
      })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.path).toBe('stops.active[0].requires.atr')
    expect(problems[0]?.message).toContain('not in the registry')
  })

  it('accepts a stop whose indicator does resolve', () => {
    const config = defaultConfig()
    config.stops.active = [{ typeId: 'fixed-percent', params: { length: 20 }, advisory: false }]
    expect(
      validateConfig(
        config,
        context({ stopRequirements: new Map([[0, [{ key: 'ma', indicatorId: 'sma' }]]]) })
      )
    ).toEqual([])
  })

  it('rejects an unimplemented cost basis method instead of silently substituting', () => {
    const config = defaultConfig()
    config.costBasisMethod = 'fifo'
    expect(validateConfig(config, context())[0]?.path).toBe('costBasisMethod')
  })

  it.each([
    ['entrySize', 0],
    ['entrySize', 1.5],
  ])('rejects %s = %s', (_key, value) => {
    const config = defaultConfig()
    config.entrySize = value
    expect(validateConfig(config, context())[0]?.path).toBe('entrySize')
  })

  it('rejects a scroll speed outside the usable range', () => {
    const config = defaultConfig()
    config.scrollSpeed = 25
    expect(validateConfig(config, context())[0]?.path).toBe('scrollSpeed')
  })

  it('rejects a leaky normalization mode even if someone hand-edits it in', () => {
    const config = defaultConfig()
    // Persisted config is untrusted on read; the leaky modes aren't implemented
    // and must not be accepted from a file either.
    Object.assign(config, { normalizationMode: 'whole-series-min-max' })
    expect(validateConfig(config, context())[0]?.path).toBe('normalizationMode')
  })

  it('rejects an inverted date range', () => {
    const config = defaultConfig()
    config.data.dateRange = { from: 200, to: 100 }
    expect(validateConfig(config, context())[0]?.path).toBe('data.dateRange')
  })

  it('reports every problem at once rather than stopping at the first', () => {
    const config = defaultConfig()
    config.scrollSpeed = 0
    config.entrySize = 0
    config.data.source = 'live'
    expect(validateConfig(config, context()).map((p) => p.path)).toEqual([
      'entrySize',
      'scrollSpeed',
      'data.source',
    ])
  })
})
