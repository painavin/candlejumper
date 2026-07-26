import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults.js'
import { fingerprintPayload, runFingerprint } from './fingerprint.js'

const CONTEXT = { visibleBarCount: 60 }

describe('runFingerprint', () => {
  it('is stable for an unchanged config', () => {
    const config = defaultConfig()
    expect(runFingerprint(config, CONTEXT)).toBe(runFingerprint(config, CONTEXT))
  })

  it('ignores cosmetic and accessibility settings', () => {
    // Nobody should be penalised for making the game comfortable, and turning
    // on a helpful indicator must not orphan their history.
    const base = defaultConfig()
    const comfortable = defaultConfig()
    comfortable.visuals.theme = 'serious'
    comfortable.visuals.worldSeed = 999
    comfortable.visuals.reducedMotion = true
    comfortable.visuals.screenShake = false
    comfortable.visuals.pnlPalette = 'blue-orange'
    comfortable.audio.masterVolume = 0
    comfortable.character.selected = 'bull'
    comfortable.volume.enabled = false
    comfortable.indicators.active = [{ typeId: 'sma', params: { length: 20 }, instanceId: 'i1' }]
    comfortable.hud.showStopLevelOnChart = false

    expect(runFingerprint(comfortable, CONTEXT)).toBe(runFingerprint(base, CONTEXT))
  })

  it.each([
    ['scrollSpeed', (c: ReturnType<typeof defaultConfig>) => (c.scrollSpeed = 8)],
    ['allowShorting', (c: ReturnType<typeof defaultConfig>) => (c.allowShorting = true)],
    ['entrySize', (c: ReturnType<typeof defaultConfig>) => (c.entrySize = 0.5)],
    ['startingCapital', (c: ReturnType<typeof defaultConfig>) => (c.startingCapital = 50_000)],
    ['ticker', (c: ReturnType<typeof defaultConfig>) => (c.data.ticker = 'NKE')],
    ['priceTransform', (c: ReturnType<typeof defaultConfig>) => (c.priceTransform = 'log10')],
    [
      'normalizationMode',
      (c: ReturnType<typeof defaultConfig>) => (c.normalizationMode = 'fixed-price-per-pixel'),
    ],
    ['maxMultiplier', (c: ReturnType<typeof defaultConfig>) => (c.scoring.maxMultiplier = 3)],
    ['streakEnabled', (c: ReturnType<typeof defaultConfig>) => (c.scoring.streakEnabled = false)],
  ])('changes when %s changes', (_name, mutate) => {
    const changed = defaultConfig()
    mutate(changed)
    expect(runFingerprint(changed, CONTEXT)).not.toBe(runFingerprint(defaultConfig(), CONTEXT))
  })

  it('changes when the resolved visible bar count changes', () => {
    // Which is why it's frozen at run start: a mid-run rotation would otherwise
    // move the run into a different personal-best bucket.
    const config = defaultConfig()
    expect(runFingerprint(config, { visibleBarCount: 28 })).not.toBe(
      runFingerprint(config, { visibleBarCount: 60 })
    )
  })

  it('distinguishes an advisory stop from an enforcing one', () => {
    // Under an enforcing stop the streak cannot be lost, so it is a materially
    // different challenge and must not share a bucket.
    const advisory = defaultConfig()
    const enforcing = defaultConfig()
    enforcing.stops.active = enforcing.stops.active.map((s) => ({ ...s, advisory: false }))
    expect(runFingerprint(enforcing, CONTEXT)).not.toBe(runFingerprint(advisory, CONTEXT))
  })

  it('changes when a stop parameter changes', () => {
    const looser = defaultConfig()
    looser.stops.active = [{ typeId: 'trailing-percent', params: { percent: 20 }, advisory: true }]
    expect(runFingerprint(looser, CONTEXT)).not.toBe(runFingerprint(defaultConfig(), CONTEXT))
  })

  it('does not care about the order stops were added in', () => {
    const forwards = defaultConfig()
    forwards.stops.active = [
      { typeId: 'fixed-percent', params: { percent: 5 }, advisory: false },
      { typeId: 'trailing-percent', params: { percent: 8 }, advisory: true },
    ]
    const backwards = defaultConfig()
    backwards.stops.active = [...forwards.stops.active].reverse()
    expect(runFingerprint(backwards, CONTEXT)).toBe(runFingerprint(forwards, CONTEXT))
  })

  it('carries its version, so adding a key is an explicit migration', () => {
    const payload = fingerprintPayload(defaultConfig(), CONTEXT) as Record<string, unknown>
    expect(payload.v).toBe(1)
  })
})
