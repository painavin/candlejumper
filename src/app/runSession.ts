import type { RunConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { createRunController } from '@engine/run/runController.js'
import type { RunController } from '@engine/run/runController.js'
import type { StopEngine } from '@engine/stops/port.js'
import type { IndicatorFeed } from '@engine/indicators/feed.js'
import type { AudioMix, AudioSystem } from '@audio/audioSystem.js'
import { loadMidi } from '@data/index.js'
import { attachKeyboard } from '@input/keyboard.js'
import { createTouchControls } from '@input/touchControls.js'
import type { TouchControls } from '@input/touchControls.js'
import { character } from '@content/characters/index.js'
import { visualTheme } from '@content/visualThemes/index.js'
import { createStage } from '@render/stage/stage.js'
import { createParallaxStack } from '@render/layers/parallaxStack.js'
import { createPoleLayer } from '@render/poles/poleLayer.js'
import { createAxisLayer } from '@render/hud/axisLayer.js'
import { createTopHudLayer } from '@render/hud/topHud.js'
import { createStopLinesLayer } from '@render/hud/stopLines.js'
import { createIndicatorLayer } from '@render/hud/indicatorLayer.js'
import { createLandmarkLayer } from '@render/landmarks/landmarkLayer.js'
import { createJuiceLayer } from '@render/juice/juiceLayer.js'
import { createCharacterLayer } from '@render/character/characterLayer.js'
import { damp } from '@shared/math/index.js'
import { createDemoPilot } from './demoPilot.js'

/**
 * The run session: the engine's run controller plus the render layers, driven by
 * one time-based loop.
 *
 * All motion advances from elapsed wall-clock time, never frame count, so the game
 * runs at identical speed on a 60Hz laptop and a 120Hz phone. Two of the three
 * stall rules live in the engine's clock; the third — auto-pause when the page is
 * hidden — has to live here, because this is the only layer that knows about the
 * document.
 *
 * **Attract mode is the same session with four things off**: no input, no audio, no
 * HUD, and an autopilot pressing the buttons. docs/game-feel.md describes the
 * title screen's attract mode as "just the existing render loop with input
 * disabled", and building it as a mode rather than a second scene is what keeps
 * that true — a separate menu renderer would drift from the real one.
 */

export interface RunSession {
  stop(): void
  /** Browsers need a user gesture before audio can start. */
  startAudio(): Promise<void>
  pause(): void
  resume(): void
  endRun(): void
  /** Live mix change — volume sliders have to be audible while they move. */
  setMix(mix: AudioMix): void
  /** One cue at the current effects level, so that slider can be auditioned. */
  previewSfx(): void
  readonly controller: RunController
  /** Bound by `ui/mobile/` to the thumb buttons. Absent in attract mode. */
  readonly touch: TouchControls | undefined
}

/**
 * `play` is a real run. `attract` is the menu backdrop: no input, no audio, no
 * HUD, autopiloted, and nothing it does is ever recorded.
 */
export type SessionMode = 'play' | 'attract'

export interface RunSessionOptions {
  host: HTMLElement
  config: RunConfig
  bars: readonly OhlcvBar[]
  /** Resolved once from orientation before the run starts, then frozen. */
  visibleBarCount: number
  /** Bars warmed before play begins, already resolved from `config.preloadBars`. */
  preloadBars?: number
  mode?: SessionMode
  stops?: StopEngine
  /** Displayed indicators — separate instances from anything a stop owns. */
  indicators?: IndicatorFeed
  /** Fired on buy/sell/flatten, for haptics. Never called in attract mode. */
  onAction?(): void
  /**
   * The pause key, or the page being hidden. `app/` decides what pausing *means*
   * — this only reports that it happened, so the pause menu and the engine's
   * frozen pipeline stay in step.
   */
  onPauseRequested?(): void
  /** The series ran out. Any open position has already been force-closed. */
  onFinished?(): void
}

/** Fraction of the chart height the camera follows the character by. */
const CAMERA_FOLLOW = 0.06
/** Seconds to close ~63% of the gap. Slow, so it reads as drift rather than tracking. */
const CAMERA_SMOOTHING = 0.32

export async function startRunSession({
  host,
  config,
  bars,
  visibleBarCount,
  preloadBars,
  mode = 'play',
  stops,
  indicators,
  onAction,
  onPauseRequested,
  onFinished,
}: RunSessionOptions): Promise<RunSession> {
  const attract = mode === 'attract'
  const theme = visualTheme(config.visuals.theme)


  // The pane count has to be known before the layout is computed, since panes share
  // 40% of the chart area and the main chart's height depends on it.
  const oscillators = (indicators?.series ?? []).filter((series) => series.paneKind === 'oscillator')
  const requestedPanes = (config.volume.enabled ? 1 : 0) + oscillators.length
  const stage = await createStage({ host, visibleBarCount, theme, subPaneCount: requestedPanes })

  const controller = createRunController({
    bars,
    config,
    visibleBarCount,
    preloadBars,
    stops,
    indicators,
    showVolume: config.volume.enabled,
    maxSubPanes: stage.layout.maxSubPanes,
  })

  // Every layer is generated at load from `theme + worldSeed`, so the same pair
  // always produces an identical world.
  const parallax = createParallaxStack(stage.app.renderer, config, theme, stage.layout)
  const poles = createPoleLayer({
    theme,
    palette: config.visuals.pnlPalette,
    barStyle: config.visuals.barStyle,
  })
  const actor = createCharacterLayer({
    character: character(config.character.selected),
    theme,
    reducedMotion: config.visuals.reducedMotion,
  })
  const axis = createAxisLayer(
    {
      mode: config.normalizationMode,
      transform: config.priceTransform,
      reference: config.normalizationReference,
    },
    theme
  )
  const stopLines = createStopLinesLayer(config.hud.showStopLevelOnChart, theme)
  const indicatorLayer = createIndicatorLayer({ theme, palette: config.visuals.pnlPalette })
  const landmarks = createLandmarkLayer(theme)
  const juice = createJuiceLayer({
    palette: config.visuals.pnlPalette,
    theme,
    screenShake: config.visuals.screenShake,
    reducedMotion: config.visuals.reducedMotion,
    worldSeed: config.visuals.worldSeed,
  })
  /**
   * Tone.js is ~350kB and nothing needs it before first paint, so it loads as its own
   * chunk — the title screen still renders before the audio bundle arrives.
   *
   * Attract mode gets the **bed**, and stingers only so the settings screen's effects
   * slider can be auditioned — nothing behind a menu can fire a cue by accident,
   * since `update()` is inert in that mode. Sonification isn't built: there are no
   * played bars to sonify. It stays silent until `startAudio()` is called, which
   * `app/` defers to the first click or keypress — browsers block audio before a
   * gesture, and a page that greets you with music you didn't ask for would be worse
   * anyway.
   */
  const { createAudio } = await import('@audio/audioSystem.js')
  /**
   * The theme's background track, if it ships one.
   *
   * Loaded here rather than inside the audio system because `src/audio` may not
   * import `@data`. A theme with no file resolves to `undefined` and the generated
   * bed plays, so this never blocks startup on a 404 — and a decode failure is
   * swallowed for the same reason the run should still start with silence rather
   * than not at all.
   */
  const track = await loadMidi(config.audio.theme).catch(() => undefined)
  const audio: AudioSystem = createAudio({
    themeId: config.audio.theme,
    track,
    masterVolume: config.audio.masterVolume,
    musicVolume: config.audio.musicVolume,
    musicMuted: config.audio.musicMuted,
    sfxVolume: config.audio.sfxVolume,
    sfxMuted: config.audio.sfxMuted,
    worldSeed: config.visuals.worldSeed,
    channels: attract ? 'menu' : 'all',
  })
  const topHud = createTopHudLayer({
    ticker: config.data.ticker,
    startingCapital: config.startingCapital,
    palette: config.visuals.pnlPalette,
    theme,
  })

  stage.background.addChild(parallax.background)
  stage.world.addChild(landmarks.container, poles.container)
  // Trail below the character, and in the actors layer so both share the camera.
  stage.actors.addChild(actor.trail, actor.container)
  stage.overlay.addChild(parallax.foreground)
  stage.hud.addChild(
    juice.container,
    indicatorLayer.container,
    axis.container,
    stopLines.container,
    topHud.container
  )
  // No numbers, no floating text, no stop lines behind a menu — the backdrop is
  // scenery, and a HUD reading $0.00 under the title would look broken.
  stage.hud.visible = !attract

  const pilot = attract ? createDemoPilot(config.visuals.worldSeed) : undefined

  let elapsed = 0
  let reportedFinished = false
  /**
   * Vertical camera offset, eased toward wherever the character is.
   *
   * Small on purpose. A camera that fully tracks the bounce makes the chart move
   * under a player trying to read price levels off it — the opposite of what a
   * trading trainer wants — so this is a hint of follow rather than a lock.
   */
  let cameraY = 0

  const render = (dtSeconds: number): void => {
    elapsed += dtSeconds
    if (pilot) {
      const action = pilot.decide(controller.frame)
      if (action) controller.press(action)
    }
    const frame = controller.advance(dtSeconds)
    if (frame.phase === 'finished' && !reportedFinished) {
      reportedFinished = true
      onFinished?.()
    }
    const layout = stage.layout
    // Bars travelled drives every parallax layer, so the whole scene scrolls
    // coherently off one number.
    parallax.update(frame.currentIndex + frame.barPhase, layout.barWidth)
    landmarks.draw(frame, layout)
    poles.draw(frame, layout)
    actor.draw(frame, layout, elapsed)
    axis.draw(frame, layout)
    indicatorLayer.draw(frame, layout)
    stopLines.draw(frame, layout)
    topHud.draw(frame, layout, dtSeconds)

    // Where the character is, as an offset from the middle of the chart.
    const newest = frame.bars.find((visible) => visible.age === 0)
    const targetCamera =
      config.visuals.reducedMotion || !newest
        ? 0
        : (newest.unit - 0.5) * layout.chartHeight * CAMERA_FOLLOW
    cameraY = dtSeconds > 0 ? damp(cameraY, targetCamera, CAMERA_SMOOTHING, dtSeconds) : targetCamera

    // Shake moves the world, not the HUD: numbers you're trying to read shouldn't
    // jump, and the effect reads better applied to the scene anyway.
    const { shakeX, shakeY } = juice.draw(frame, layout, dtSeconds)
    for (const container of [stage.background, stage.world, stage.actors, stage.overlay]) {
      container.position.set(shakeX, shakeY + cameraY)
    }
    /**
     * The chart-anchored HUD layers move with the camera but not with the shake.
     *
     * The axis has to follow, or it labels prices at the wrong heights the moment
     * the camera moves — the axis and the poles are two views of one scale and must
     * never disagree. Shake is the opposite case: it's noise, and noise on the
     * numbers is just harder to read.
     */
    for (const container of [axis.container, stopLines.container, indicatorLayer.container]) {
      container.position.set(0, cameraY)
    }

    // Audio is additive: it duplicates information already on screen, so the game
    // stays fully playable muted.
    audio.update(frame)
  }

  const tick = (): void => {
    // Seconds, not frames, and not Pixi's normalized delta.
    render(stage.app.ticker.deltaMS / 1000)
  }
  stage.app.ticker.add(tick)

  // A resize must repaint immediately, not on the next tick, or the chart is
  // stretched for a frame.
  stage.onResize((layout) => {
    parallax.rebuild(layout)
    render(0)
  })

  const press = (action: Parameters<RunController['press']>[0]): void => {
    controller.press(action)
    onAction?.()
  }

  const onPause = (): void => {
    if (controller.isPaused) return
    controller.pause()
    audio.setPaused(true)
    onPauseRequested?.()
  }

  // Attract mode attaches nothing: the menu above owns the pointer, and a stray
  // keypress must not trade in a session whose result is thrown away.
  const keyboard = attract
    ? undefined
    : attachKeyboard({
        press,
        flattenHoldMs: config.flattenHoldMs,
        onPause,
        // Straight through: the controller owns the ladder and refuses while paused, so
        // there is nothing for this layer to decide.
        onSpeed: (direction) => void controller.changeSpeed(direction),
        isInputBlocked: () => controller.isInputBlocked(),
      })

  /**
   * Touch handlers, for `ui/mobile/` to bind to its thumb buttons.
   *
   * The gesture and action mapping stays in `input/` even though the buttons are
   * DOM — `input/` is meant to be the last place button names exist, and moving
   * tap-versus-hold into a component would fork that rule between two zones.
   */
  const touch = attract
    ? undefined
    : createTouchControls({
        press,
        flattenHoldMs: config.flattenHoldMs,
        isInputBlocked: () => controller.isInputBlocked(),
        onPause,
      })

  /**
   * Rule 3 of the stall rules: a hidden page must not resolve the bars it owes.
   * Routed into the existing pause state rather than a bespoke recovery path, so
   * the player sees "PAUSED" and resumes deliberately instead of losing time
   * silently. See docs/game-design.md#scroll-speed-timing-and-pole-geometry.
   *
   * Attract mode pauses the same way but reports nothing — there is no menu to
   * show, and a backdrop that keeps burning through its series in a background tab
   * would restart itself repeatedly for nobody.
   */
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      if (controller.isPaused) return
      controller.pause()
      audio.setPaused(true)
      if (!attract) onPauseRequested?.()
      return
    }
    // Only the backdrop resumes itself. A real run stays paused until the player
    // resumes deliberately, which is the whole point of routing this through the
    // pause menu rather than silently catching up.
    if (attract && controller.isPaused) controller.resume()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  render(0)

  return {
    controller,
    touch,
    startAudio: () => audio.start(),
    setMix: (mix) => audio.setMix(mix),
    previewSfx: () => audio.previewSfx(),
    pause: () => {
      controller.pause()
      audio.setPaused(true)
    },
    resume: () => {
      controller.resume()
      audio.setPaused(false)
    },
    endRun: () => controller.endRun(),
    stop() {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      keyboard?.detach()
      touch?.cancel()
      stage.app.ticker.remove(tick)
      parallax.destroy()
      audio.dispose()
      stage.destroy()
    },
  }
}
