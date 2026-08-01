import { describe, expect, it } from 'vitest'
import { defaultConfig } from './defaults.js'
import { CONFIG_VERSION, parseStoredConfig, resolveMotion, toStoredConfig } from './storedConfig.js'

/**
 * The persisted settings, and reading them back from a file that might have been
 * written by an older build or edited by hand.
 *
 * The rule under test throughout: **permissive about missing fields, strict about wrong
 * ones**. A player who upgrades keeps everything their file does carry; a file
 * containing nonsense loses only the nonsense.
 */

const defaults = defaultConfig()
const options = { defaults, systemReducedMotion: false }

/** Round-trip helper: what comes back after storing this config. */
const roundTrip = (config = defaults, systemReducedMotion = false) =>
  parseStoredConfig(toStoredConfig(config), { defaults, systemReducedMotion })

/** A stored blob with `config` patched, for the untrusted-read cases. */
const stored = (patch: Record<string, unknown>) => ({
  version: CONFIG_VERSION,
  config: { ...(toStoredConfig(defaults).config as Record<string, unknown>), ...patch },
})

describe('round trip', () => {
  it('preserves a default config exactly', () => {
    expect(roundTrip()).toEqual(defaults)
  })

  it('preserves every kind of change a player can make', () => {
    const changed = defaultConfig()
    changed.startingCapital = 50_000
    changed.entrySize = 0.35
    changed.allowShorting = true
    changed.flattenHoldMs = 750
    changed.scrollSpeed = 6.5
    changed.visibleBarCount = { landscape: 90, portrait: 40 }
    changed.priceTransform = 'log10'
    changed.normalizationMode = 'fixed-price-per-pixel'
    changed.scoring = { streakEnabled: false, maxMultiplier: 3 }
    changed.hud.showStopLevelOnChart = false
    changed.volume.enabled = false
    changed.background.layers.clouds.enabled = false
    changed.visuals.theme = 'serious'
    changed.visuals.worldSeed = 12_345
    changed.visuals.screenShake = false
    changed.visuals.pnlPalette = 'blue-orange'
    changed.visuals.barStyle = 'candlestick'
    changed.character.selected = 'bear'
    changed.audio = {
      theme: 'serious',
      masterVolume: 0.5,
      musicVolume: 0,
      musicMuted: true,
      sfxVolume: 0.25,
      sfxMuted: false,
    }
    changed.data = { source: 'downloaded', ticker: 'INTC', dateRange: { from: 100, to: 200 } }
    changed.stops.active = [{ typeId: 'fixed-percent', params: { percent: 4 }, advisory: false }]
    changed.indicators.active = [
      { typeId: 'sma', params: { length: 200 }, instanceId: 'sma-1', colour: 0x4da3ff },
      {
        typeId: 'atr',
        params: { length: 14 },
        instanceId: 'atr-1',
        colour: 0xffd166,
        paneKind: 'overlay',
      },
      {
        typeId: 'gapup-breakout-atr-pullback',
        params: { breakoutLength: 20 },
        instanceId: 'gbap-1',
        colour: 0x9dd6a0,
        outputs: { breakout: { draw: 'none' }, stop: { draw: 'dash', colour: 0xff9ec4 } },
      },
    ]

    expect(roundTrip(changed)).toEqual(changed)
  })
})

describe('a first run', () => {
  it('returns defaults for nothing stored', () => {
    expect(parseStoredConfig(undefined, options)).toEqual(defaults)
  })

  it('returns defaults for stored junk rather than throwing', () => {
    for (const junk of ['nope', 42, [], null, {}, { version: CONFIG_VERSION }]) {
      expect(parseStoredConfig(junk, options)).toEqual(defaults)
    }
  })

  it('discards a config written under a different version', () => {
    // The alternative is guessing at a shape change, which is how someone's settings
    // quietly become half-migrated nonsense.
    const old = { ...toStoredConfig(defaults), version: CONFIG_VERSION + 1 }
    expect(parseStoredConfig(old, options)).toEqual(defaults)
  })
})

describe('missing fields', () => {
  it('keeps everything a partial config does carry', () => {
    // What an older build's file looks like: some keys simply absent.
    const partial = { version: CONFIG_VERSION, config: { scrollSpeed: 8, allowShorting: true } }
    const parsed = parseStoredConfig(partial, options)

    expect(parsed.scrollSpeed).toBe(8)
    expect(parsed.allowShorting).toBe(true)
    // And everything else is the default, not undefined.
    expect(parsed.visuals.theme).toBe(defaults.visuals.theme)
    expect(parsed.audio.musicVolume).toBe(defaults.audio.musicVolume)
    expect(parsed.background.layers.trees).toEqual(defaults.background.layers.trees)
    expect(parsed.stops.active).toEqual(defaults.stops.active)
  })

  it('fills in a partially stored group', () => {
    const parsed = parseStoredConfig(stored({ audio: { sfxMuted: true } }), options)
    expect(parsed.audio.sfxMuted).toBe(true)
    expect(parsed.audio.masterVolume).toBe(defaults.audio.masterVolume)
  })
})

describe('wrong values fall back individually', () => {
  it.each([
    ['startingCapital', { startingCapital: -5 }],
    ['startingCapital as a string', { startingCapital: '10000' }],
    ['entrySize above 1', { entrySize: 4 }],
    ['entrySize at 0', { entrySize: 0 }],
    ['scrollSpeed', { scrollSpeed: 1e9 }],
    ['flattenHoldMs', { flattenHoldMs: 0 }],
    ['normalizationReference', { normalizationReference: 0 }],
    ['costBasisMethod', { costBasisMethod: 'lifo' }],
    ['priceTransform', { priceTransform: 'ln' }],
    ['normalizationMode', { normalizationMode: 'whole-series-min-max' }],
    ['allowShorting', { allowShorting: 'yes' }],
  ])('%s', (_name, patch) => {
    const parsed = parseStoredConfig(stored(patch), options)
    const key = Object.keys(patch)[0] as keyof typeof defaults
    expect(parsed[key]).toEqual(defaults[key])
  })

  it('rejects a non-integer bar count', () => {
    const parsed = parseStoredConfig(stored({ visibleBarCount: { landscape: 60.5, portrait: 28 } }), options)
    expect(parsed.visibleBarCount.landscape).toBe(defaults.visibleBarCount.landscape)
    expect(parsed.visibleBarCount.portrait).toBe(28)
  })

  it('rejects a NaN world seed, which would collapse every world into one', () => {
    const parsed = parseStoredConfig(stored({ visuals: { worldSeed: Number.NaN } }), options)
    expect(parsed.visuals.worldSeed).toBe(defaults.visuals.worldSeed)
  })

  it('clamps nothing — it rejects, so a bad value never becomes a plausible one', () => {
    // A volume of 4 is not "1"; it's a value nothing wrote, so the default is the
    // honest answer.
    const parsed = parseStoredConfig(stored({ audio: { masterVolume: 4 } }), options)
    expect(parsed.audio.masterVolume).toBe(defaults.audio.masterVolume)
  })

  it('keeps an unknown theme or character id, for the shell to resolve', () => {
    // Ids are open sets — themes and characters are content, and a run refuses to
    // start on an unresolvable one with a message naming it. Rewriting it here would
    // hide a plugin or content problem behind a silent default.
    const parsed = parseStoredConfig(
      stored({ visuals: { theme: 'chill' }, character: { selected: 'nobody' } }),
      options
    )
    expect(parsed.visuals.theme).toBe('chill')
    expect(parsed.character.selected).toBe('nobody')
  })

  it('rejects an empty string id, which names nothing', () => {
    const parsed = parseStoredConfig(stored({ visuals: { theme: '  ' } }), options)
    expect(parsed.visuals.theme).toBe(defaults.visuals.theme)
  })
})

describe('reduced motion', () => {
  it('is not stored at all', () => {
    const config = defaultConfig()
    config.visuals.reducedMotion = true
    const visuals = (toStoredConfig(config).config as { visuals: Record<string, unknown> }).visuals
    expect('reducedMotion' in visuals).toBe(false)
  })

  it('follows the system when there is no override', () => {
    // The whole reason for the tri-state: a persisted boolean would override
    // prefers-reduced-motion, which exists precisely to be honoured unasked.
    expect(roundTrip(defaults, true).visuals.reducedMotion).toBe(true)
    expect(roundTrip(defaults, false).visuals.reducedMotion).toBe(false)
  })

  it('lets an explicit override win over the system in both directions', () => {
    const forcedOn = defaultConfig()
    forcedOn.visuals.motionOverride = true
    expect(roundTrip(forcedOn, false).visuals.reducedMotion).toBe(true)

    const forcedOff = defaultConfig()
    forcedOff.visuals.motionOverride = false
    expect(roundTrip(forcedOff, true).visuals.reducedMotion).toBe(false)
  })

  it('treats a non-boolean override as no override', () => {
    const parsed = parseStoredConfig(stored({ visuals: { motionOverride: 'sometimes' } }), {
      defaults,
      systemReducedMotion: true,
    })
    expect(parsed.visuals.motionOverride).toBeUndefined()
    expect(parsed.visuals.reducedMotion).toBe(true)
  })

  it('resolves the same way mid-session', () => {
    const config = defaultConfig()
    expect(resolveMotion(config, true).visuals.reducedMotion).toBe(true)
    config.visuals.motionOverride = false
    expect(resolveMotion(config, true).visuals.reducedMotion).toBe(false)
  })
})

describe('configured stops and indicators', () => {
  it('keeps an instance whose plugin is not registered', () => {
    // Load-bearing: silently deleting a stop because its plugin is missing changes the
    // player's risk configuration without telling them, in the dangerous direction.
    // `validateConfig` refuses the run and names it instead.
    const parsed = parseStoredConfig(
      stored({ stops: { active: [{ typeId: 'my-custom-stop', params: { x: 1 }, advisory: false }] } }),
      options
    )
    expect(parsed.stops.active).toEqual([
      { typeId: 'my-custom-stop', params: { x: 1 }, advisory: false },
    ])
  })

  it('drops an entry with no typeId, which names nothing at all', () => {
    const parsed = parseStoredConfig(
      stored({ stops: { active: [{ params: {} }, { typeId: 'fixed-percent', params: {} }] } }),
      options
    )
    expect(parsed.stops.active.map((stop) => stop.typeId)).toEqual(['fixed-percent'])
  })

  it('drops non-numeric params rather than the whole instance', () => {
    const parsed = parseStoredConfig(
      stored({ stops: { active: [{ typeId: 'x', params: { good: 3, bad: 'nope' } }] } }),
      options
    )
    expect(parsed.stops.active[0]?.params).toEqual({ good: 3 })
  })

  it('defaults a stop with no advisory flag to advisory', () => {
    // The safe direction: advisory measures the player, enforcing lets the engine act.
    const parsed = parseStoredConfig(stored({ stops: { active: [{ typeId: 'x' }] } }), options)
    expect(parsed.stops.active[0]?.advisory).toBe(true)
  })

  it('synthesises a missing instance id rather than leaving it blank', () => {
    // Instance ids key the engine's series output, so two blanks would collide.
    const parsed = parseStoredConfig(
      stored({ indicators: { active: [{ typeId: 'sma' }, { typeId: 'sma' }] } }),
      options
    )
    expect(parsed.indicators.active.map((entry) => entry.instanceId)).toEqual(['sma-1', 'sma-2'])
  })

  it('keeps a pane override, and forgets an invalid one', () => {
    const parsed = parseStoredConfig(
      stored({
        indicators: {
          active: [
            { typeId: 'a', instanceId: 'a-1', colour: 1, paneKind: 'oscillator' },
            { typeId: 'b', instanceId: 'b-1', colour: 1, paneKind: 'sideways' },
          ],
        },
      }),
      options
    )
    expect(parsed.indicators.active[0]?.paneKind).toBe('oscillator')
    expect(parsed.indicators.active[1]?.paneKind).toBeUndefined()
  })

  it('keeps per-output style overrides, and drops the parts that are corrupt', () => {
    const parsed = parseStoredConfig(
      stored({
        indicators: {
          active: [
            {
              typeId: 'a',
              instanceId: 'a-1',
              colour: 1,
              outputs: {
                good: { draw: 'dots', colour: 0x4fd6c8 },
                badDraw: { draw: 'squiggle', colour: 0x112233 },
                badColour: { draw: 'dash', colour: -1 },
                empty: { draw: 'wrong', colour: 'red' },
                notAnObject: 'dots',
              },
            },
          ],
        },
      }),
      options
    )

    const outputs = parsed.indicators.active[0]?.outputs
    expect(outputs?.good).toEqual({ draw: 'dots', colour: 0x4fd6c8 })
    // Field by field, not entry by entry: one bad half shouldn't cost the good half,
    // and what's left still resolves against the plugin's own default.
    expect(outputs?.badDraw).toEqual({ colour: 0x112233 })
    expect(outputs?.badColour).toEqual({ draw: 'dash' })
    // Nothing survived, so no entry — absent already means "use the plugin's default".
    expect(outputs?.empty).toBeUndefined()
    expect(outputs?.notAnObject).toBeUndefined()
  })

  it('omits the override map entirely when nothing in it survives', () => {
    const parsed = parseStoredConfig(
      stored({
        indicators: {
          active: [{ typeId: 'a', instanceId: 'a-1', colour: 1, outputs: { x: { draw: 5 } } }],
        },
      }),
      options
    )
    expect(parsed.indicators.active[0]?.outputs).toBeUndefined()
  })

  it('falls back to the default list when the stored one is not a list', () => {
    const parsed = parseStoredConfig(stored({ stops: { active: 'all of them' } }), options)
    expect(parsed.stops.active).toEqual(defaults.stops.active)
  })
})

describe('the playback date range', () => {
  it('survives when it describes a range', () => {
    const parsed = parseStoredConfig(stored({ data: { dateRange: { from: 10, to: 20 } } }), options)
    expect(parsed.data.dateRange).toEqual({ from: 10, to: 20 })
  })

  it.each([
    ['reversed', { from: 20, to: 10 }],
    ['empty', { from: 10, to: 10 }],
    ['half-open', { from: 10 }],
    ['non-numeric', { from: 'yesterday', to: 'today' }],
    ['not an object', 'all of it'],
  ])('is dropped when %s', (_name, range) => {
    // It narrows whichever series is selected, and that dataset can be replaced between
    // sessions — a range covering no bars would read as a broken game.
    const parsed = parseStoredConfig(stored({ data: { dateRange: range } }), options)
    expect(parsed.data.dateRange).toBeUndefined()
  })
})

describe('background layers', () => {
  it('merges per layer', () => {
    const parsed = parseStoredConfig(
      stored({ background: { layers: { clouds: { enabled: false } } } }),
      options
    )
    expect(parsed.background.layers.clouds.enabled).toBe(false)
    // The speed is motion, not preference, and comes back from the defaults.
    expect(parsed.background.layers.clouds.speedMultiplier).toBe(
      defaults.background.layers.clouds.speedMultiplier
    )
    expect(parsed.background.layers.sky).toEqual(defaults.background.layers.sky)
  })

  it('ignores a layer name that does not exist', () => {
    const parsed = parseStoredConfig(
      stored({ background: { layers: { volcano: { enabled: true } } } }),
      options
    )
    expect(Object.keys(parsed.background.layers)).toEqual(Object.keys(defaults.background.layers))
  })

  it('rejects an out-of-range speed', () => {
    const parsed = parseStoredConfig(
      stored({ background: { layers: { trees: { speedMultiplier: 5000 } } } }),
      options
    )
    expect(parsed.background.layers.trees.speedMultiplier).toBe(
      defaults.background.layers.trees.speedMultiplier
    )
  })
})
