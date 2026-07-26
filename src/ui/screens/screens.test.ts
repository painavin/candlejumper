// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { mount, unmount } from 'svelte'
import { defaultConfig } from '@config/index.js'
import type { RunConfig } from '@config/index.js'
import { createStopRegistry, createIndicatorRegistry } from '@plugins/host/index.js'
import { AppState } from '../appState.svelte.js'
import type { AppActions } from '../appState.svelte.js'
import App from './App.svelte'

/**
 * A mount smoke test for the screens.
 *
 * The docs say rendering is verified by playing rather than by tests, and that
 * still holds for the canvas. But *mounting* is different: the first version of
 * these screens crashed on `structuredClone()` of a `$state` proxy, and because
 * the failure happened after the boot element was removed the page just went
 * blank. This test is the cheapest thing that would have caught it.
 */

interface SpiedActions extends AppActions {
  start: Mock<(config: RunConfig) => void>
}

function actions(): SpiedActions {
  return {
    start: vi.fn<(config: RunConfig) => void>(),
    resume: vi.fn(),
    restart: vi.fn(),
    endRun: vi.fn(),
    abandon: vi.fn(),
    runAgain: vi.fn(),
    toSettings: vi.fn(),
    toTitle: vi.fn(),
    toHowTo: vi.fn(),
    toStats: vi.fn(),
    preview: vi.fn(),
    dismissNotice: vi.fn(),
    surprise: vi.fn(),
    importPlugins: vi.fn(),
    removePlugin: vi.fn(),
  }
}

function render(configure: (state: AppState) => void = () => {}) {
  const state = new AppState()
  state.config = defaultConfig()
  // Every test but the title-screen ones is about a specific screen, so default to
  // settings rather than making each one navigate there first.
  state.screen = 'settings'
  state.unlocked = ['character:bull', 'character:bear', 'theme:serious']
  state.indicatorChoices = [...createIndicatorRegistry().values()].map((plugin) => ({
    id: plugin.id,
    displayName: plugin.displayName,
    paneKind: plugin.paneKind,
    params: plugin.params,
  }))
  state.stopChoices = [...createStopRegistry().values()].map((plugin) => ({
    id: plugin.id,
    displayName: plugin.displayName,
    params: plugin.params,
  }))
  state.tickers = [
    {
      symbol: 'AAPL',
      displayName: 'AAPL — uptrend',
      barCount: 478,
      firstBarTime: 1,
      lastBarTime: 2,
      adjusted: true,
    },
  ]
  configure(state)

  const target = document.createElement('div')
  document.body.appendChild(target)
  const acts = actions()
  const app = mount(App, { target, props: { state, actions: acts } })
  return { target, state, actions: acts, dispose: () => void unmount(app) }
}

describe('the settings screen', () => {
  it('mounts and renders', () => {
    const { target, dispose } = render()
    expect(target.textContent).toContain('Set up your run')
    expect(target.textContent).toContain('Start run')
    dispose()
  })

  it('offers every registered stop plugin', () => {
    const { target, dispose } = render()
    expect(target.textContent).toContain('Trailing percent')
    expect(target.textContent).toContain('Fixed percent from entry')
    dispose()
  })

  it('hands Start a plain object, not a reactive proxy', () => {
    // The bug this test exists for: `structuredClone()` of a $state proxy throws
    // DataCloneError, and the config crosses from ui/ into app/ right here.
    const { target, actions: acts, dispose } = render()
    const button = [...target.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Start run')
    )
    expect(button).toBeDefined()
    button?.click()

    expect(acts.start).toHaveBeenCalledTimes(1)
    const passed = acts.start.mock.calls[0]?.[0] as RunConfig
    expect(() => structuredClone(passed)).not.toThrow()
    expect(passed.data.ticker).toBe('AAPL')
    dispose()
  })

  it('warns when no risk rule is committed', () => {
    const { target, dispose } = render((state) => {
      if (state.config) state.config.stops.active = []
    })
    expect(target.textContent).toContain('No rule committed')
    dispose()
  })

  it('offers every mood, and one pick sets both theme keys', () => {
    // The first version of this screen shipped without a theme picker at all,
    // leaving `serious` — a whole second look and soundtrack — unreachable.
    const { target, actions: acts, dispose } = render()
    const moodSelect = [...target.querySelectorAll('select')].find((element) =>
      [...element.options].some((option) => option.value === 'serious')
    )
    expect(moodSelect).toBeDefined()

    moodSelect!.value = 'serious'
    moodSelect!.dispatchEvent(new Event('change', { bubbles: true }))

    const button = [...target.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Start run')
    )
    button?.click()

    const passed = acts.start.mock.calls[0]?.[0] as RunConfig
    // Both keys, not just the visual one: they are separate keys that the single
    // mood pick is responsible for keeping coherent.
    expect(passed.visuals.theme).toBe('serious')
    expect(passed.audio.theme).toBe('serious')
    dispose()
  })

  it('can still mix the two themes independently', () => {
    const { target, actions: acts, dispose } = render()
    const audioSelect = [...target.querySelectorAll('select')].filter((element) =>
      [...element.options].some((option) => option.value === 'serious')
    )
    // Mood picker, then the visuals and sound overrides inside the disclosure.
    expect(audioSelect).toHaveLength(3)

    const sound = audioSelect[2]!
    sound.value = 'serious'
    sound.dispatchEvent(new Event('change', { bubbles: true }))

    const button = [...target.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Start run')
    )
    button?.click()

    const passed = acts.start.mock.calls[0]?.[0] as RunConfig
    expect(passed.visuals.theme).toBe('jolly')
    expect(passed.audio.theme).toBe('serious')
    dispose()
  })
})

describe('the title screen', () => {
  const titled = (configure: (state: AppState) => void = () => {}) =>
    render((state) => {
      state.screen = 'title'
      configure(state)
    })

  it('is what a fresh player lands on, not the settings form', () => {
    // The whole point of the screen: a form was a poor first impression, and the
    // attract-mode canvas underneath needs something to be looked at over.
    const state = new AppState()
    expect(state.screen).toBe('title')

    const { target, dispose } = titled()
    expect(target.textContent).toContain('Candle Runner')
    expect(target.textContent).toContain('Play')
    dispose()
  })

  it('hides Quick run until there is a run to repeat', () => {
    const { target, dispose } = titled()
    expect(target.textContent).not.toContain('Quick run')
    dispose()

    const seen = titled((state) => {
      state.lifetime = {
        runs: 4,
        campaigns: 9,
        wins: 5,
        realized: 220,
        streakResets: 1,
        cleanRuns: 2,
        bestStreak: 3,
      }
    })
    expect(seen.target.textContent).toContain('Quick run')
    seen.dispose()
  })

  it('names the next unlock, so progression has a visible goal', () => {
    const { target, dispose } = titled((state) => {
      state.lifetime = {
        runs: 1,
        campaigns: 2,
        wins: 1,
        realized: 10,
        streakResets: 0,
        cleanRuns: 0,
        bestStreak: 1,
      }
    })
    expect(target.textContent).toContain('Finish 3 runs')
    dispose()
  })
})

describe('how to play', () => {
  it('states the controls, and adapts them to the device', () => {
    const keys = render((state) => {
      state.screen = 'howto'
    })
    expect(keys.target.textContent).toContain('↑ or W')
    keys.dispose()

    const touch = render((state) => {
      state.screen = 'howto'
      state.isTouch = true
    })
    expect(touch.target.textContent).toContain('Right thumb button')
    expect(touch.target.textContent).not.toContain('↑ or W')
    touch.dispose()
  })

  it('teaches that a compliant loss builds the streak', () => {
    // If a player misses this, the entire scoring model reads as broken.
    const { target, dispose } = render((state) => {
      state.screen = 'howto'
    })
    expect(target.textContent).toContain('including losses')
    dispose()
  })
})

describe('the record screen', () => {
  it('explains itself when nothing has been recorded', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'stats'
    })
    expect(target.textContent).toContain('Nothing recorded yet')
    dispose()
  })

  it('shows the lifetime numbers that were previously stored and never displayed', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'stats'
      state.lifetime = {
        runs: 10,
        campaigns: 40,
        wins: 22,
        realized: 1234,
        streakResets: 3,
        cleanRuns: 7,
        bestStreak: 5,
      }
    })
    expect(target.textContent).toContain('Clean runs')
    expect(target.textContent).toContain('7')
    expect(target.textContent).toContain('55%')
    dispose()
  })
})

describe('the thumb controls', () => {
  const playing = (configure: (state: AppState) => void = () => {}) =>
    render((state) => {
      state.screen = 'playing'
      state.touch = {
        buy: vi.fn(),
        exitDown: vi.fn(),
        exitUp: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
      }
      configure(state)
    })

  it('stays off a desktop, where the keyboard is the better control', () => {
    const { target, dispose } = playing()
    expect(target.querySelector('.thumb')).toBeNull()
    dispose()
  })

  it('appears on a coarse pointer, and buys on pointerdown rather than click', () => {
    const { target, state, dispose } = playing((next) => {
      next.isTouch = true
    })
    const buy = target.querySelector('button[aria-label="Buy one unit"]')
    expect(buy).not.toBeNull()

    // `pointerdown`, because a click fires on release and every entry would feel late.
    buy?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
    expect(state.touch?.buy).toHaveBeenCalledTimes(1)
    dispose()
  })
})

describe('the mid-run notice', () => {
  it('surfaces a dead stop over the run rather than saving it for later', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'playing'
      state.notice = 'Your atr stop stopped working'
    })
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('stopped working')
    dispose()
  })
})

describe('the pause screen', () => {
  it('renders all four outcomes', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'paused'
      state.pauseInfo = {
        buyingPower: 8000,
        startingCapital: 10_000,
        ticker: 'AAPL',
        date: '2025-03-14',
        progress: 33,
      }
    })
    for (const label of ['Resume', 'End run', 'Restart', 'Abandon']) {
      expect(target.textContent).toContain(label)
    }
    dispose()
  })
})

describe('the results screen', () => {
  const outcome = (meter: 'live' | 'automated' | 'dormant') => ({
    summary: {
      campaigns: 3,
      wins: 2,
      losses: 1,
      winRate: 2 / 3,
      averageWin: 120,
      averageLoss: -60,
      biggestWin: 200,
      biggestLoss: -60,
      stoppedOutCampaigns: 1,
      flattenedCampaigns: 1,
      forceClosedCampaigns: 1,
      closeEvents: 5,
      realized: 180,
    },
    percentReturn: 1.8,
    arcadeScore: 240,
    longestStreak: 3,
    streakResets: 1,
    meter,
    endedEarly: false,
    isPersonalBest: true,
    personalBest: undefined,
    unlocked: [],
  })

  it('renders the headline and the stats', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'results'
      state.outcome = outcome('live')
    })
    expect(target.textContent).toContain('Run complete')
    expect(target.textContent).toContain('New best for this setup')
    expect(target.textContent).toContain('67%')
    // Force-closed campaigns must be reported as excluded, not folded into win rate.
    expect(target.textContent).toContain('excluded from win rate')
    dispose()
  })

  it('explains a dormant meter instead of showing an empty one', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'results'
      state.outcome = outcome('dormant')
    })
    expect(target.textContent).toContain('No risk rule was committed')
    dispose()
  })

  it('says the engine did the exiting when stops were enforcing', () => {
    const { target, dispose } = render((state) => {
      state.screen = 'results'
      state.outcome = outcome('automated')
    })
    expect(target.textContent).toContain('Switch one to advisory')
    dispose()
  })
})

describe('the error surface', () => {
  it('shows a start failure rather than a blank screen', () => {
    const { target, dispose } = render((state) => {
      state.error = 'scrollSpeed: must be between 0.5 and 10'
    })
    expect(target.textContent).toContain("Couldn't start")
    expect(target.textContent).toContain('scrollSpeed')
    dispose()
  })
})
