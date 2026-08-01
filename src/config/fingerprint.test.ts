import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults.js'
import { fingerprintPayload, runFingerprint } from './fingerprint.js'

const SERIES = { barCount: 480, lastBarTime: 1_784_899_800 }
const CONTEXT = { visibleBarCount: 60, preloadBars: 0, series: SERIES }

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
    comfortable.indicators.active = [
      { typeId: 'sma', params: { length: 20 }, instanceId: 'i1', colour: 0x4da3ff },
    ]
    comfortable.hud.showStopLevelOnChart = false

    expect(runFingerprint(comfortable, CONTEXT)).toBe(runFingerprint(base, CONTEXT))
  })

  it('ignores scroll speed, which the player can change mid-run', () => {
    // It used to be a bucket key, and on difficulty grounds it had the best claim of
    // anything on the list. It came out when the arrow keys made it adjustable while
    // playing: a bucket key has to identify a run, and a value that can change nine times
    // before the first trade identifies nothing. Speed is also the accessibility control,
    // so filing a run by it would penalise slowing down to think.
    const slow = defaultConfig()
    const fast = defaultConfig()
    slow.scrollSpeed = 0.5
    fast.scrollSpeed = 10
    expect(runFingerprint(fast, CONTEXT)).toBe(runFingerprint(slow, CONTEXT))
  })

  it.each([
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
    expect(runFingerprint(config, { visibleBarCount: 28, preloadBars: 0, series: SERIES })).not.toBe(
      runFingerprint(config, { visibleBarCount: 60, preloadBars: 0, series: SERIES })
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

  it('changes when the dataset behind the ticker changes', () => {
    // A downloaded ticker can be refreshed, which leaves the source and symbol
    // identical and adds bars. Without this the new dataset would compete against
    // records set on the old one.
    const config = defaultConfig()
    const refreshed = { barCount: 481, lastBarTime: 1_784_986_200 }
    expect(runFingerprint(config, { visibleBarCount: 60, preloadBars: 0, series: refreshed })).not.toBe(
      runFingerprint(config, CONTEXT)
    )
  })

  it('carries its version, so changing the key set is an explicit migration', () => {
    // Pinned to a literal rather than to the exported constant on purpose: this test's job
    // is to make a version change deliberate, and reading the constant would let one slide
    // through green. At 3 because `scrollSpeed` left the payload — removing a key changes
    // every hash regardless, and the bump is what makes `loadSave` clear the old buckets
    // instead of stranding them in the save file.
    const payload = fingerprintPayload(defaultConfig(), CONTEXT) as Record<string, unknown>
    expect(payload.v).toBe(3)
    expect('scrollSpeed' in payload).toBe(false)
  })
})

describe('preloaded bars', () => {
  it('does not change the fingerprint when preload is off', () => {
    // The property that let this ship without a FINGERPRINT_VERSION bump: `canonicalize`
    // drops undefined keys, so a run with no preload hashes exactly as it did before the
    // key existed — and a bump would have emptied every personal-best bucket.
    const config = defaultConfig()
    expect(runFingerprint(config, { ...CONTEXT, preloadBars: 0 })).toBe(
      runFingerprint(config, CONTEXT)
    )
  })

  it('is a different bucket once preload is in use', () => {
    // Starting 200 bars in is a shorter, different price path with warm indicators.
    // Pooling it with a full run would compare two games and flatter the easier one.
    const config = defaultConfig()
    expect(runFingerprint(config, { ...CONTEXT, preloadBars: 200 })).not.toBe(
      runFingerprint(config, { ...CONTEXT, preloadBars: 0 })
    )
    expect(runFingerprint(config, { ...CONTEXT, preloadBars: 200 })).not.toBe(
      runFingerprint(config, { ...CONTEXT, preloadBars: 50 })
    )
  })

  it('buckets by the resolved number, not by how it was chosen', () => {
    // `'auto'` is a number by the time it reaches here, so an automatic 200 and a typed
    // 200 are the same challenge and share a record.
    const auto = { ...defaultConfig(), preloadBars: 'auto' as const }
    const typed = { ...defaultConfig(), preloadBars: 200 }
    expect(runFingerprint(auto, { ...CONTEXT, preloadBars: 200 })).toBe(
      runFingerprint(typed, { ...CONTEXT, preloadBars: 200 })
    )
  })
})
