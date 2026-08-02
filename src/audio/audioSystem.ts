import * as Tone from 'tone'
import { audioTheme } from '@content/audioThemes/index.js'
import type { AudioTheme } from '@content/audioThemes/types.js'
import type { FrameState, PositionEvent } from '@engine/output/index.js'
import type { MidiTrack } from '@shared/contracts/index.js'
import { eventKey } from '@engine/output/index.js'
import { createAmbientBed } from './channels/bed.js'
import { createSonification } from './channels/sonification.js'
import { createStingers } from './channels/stingers.js'
import { createTrackBed } from './channels/track.js'
import { toGain } from './mix.js'

/**
 * The audio system: three independent channels behind one mixer.
 *
 * Tone.js is the whole implementation, not a helper — it supplies the synths, the
 * scale quantization channel 2 needs, the effect sends, and precise scheduling.
 *
 * Two rules from the docs are enforced by construction here:
 *
 *   - **Nothing is conveyed by sound alone.** Every cue duplicates something already
 *     visible, so the game stays fully playable muted (docs/accessibility.md).
 *   - **Cues key to semantic position events, never button names** — a `sell`-keyed
 *     cue misfires on every short exit, since closing a short is a `buy`.
 */

/** The mixing knobs, separated from the theme because they aren't theme properties. */
export interface AudioMix {
  masterVolume: number
  musicVolume: number
  musicMuted: boolean
  sfxVolume: number
  sfxMuted: boolean
}

export interface AudioSystem {
  /**
   * Browsers require a user gesture before audio can start. Called from the Start
   * button's handler — or, for the title screen's bed, from the first click or
   * keypress anywhere.
   */
  start(): Promise<void>
  /** Feed one frame: fires stingers for its events and sonifies a completed bar. */
  update(frame: FrameState): void
  setPaused(paused: boolean): void
  /**
   * Change the mix on a running system.
   *
   * Volume has to be live. It was originally applied once at construction, which
   * meant a slider did nothing until the next run started — and on the settings
   * screen, where the only thing playing is the title bed, it appeared to do nothing
   * at all. A volume control that needs a commit to take effect is a broken volume
   * control: the whole way anyone sets a level is by listening while they move it.
   *
   * This is not an exception to "config is fixed for a run's duration". That rule is
   * about settings that change the *challenge*; the mix is excluded from the run
   * fingerprint precisely because it doesn't.
   */
  setMix(mix: AudioMix): void
  /**
   * Play one representative cue at the current effects level.
   *
   * Because an effects slider you cannot hear is not a control. Behind a menu there
   * are no position events, so channel 3 would otherwise be silent for exactly as
   * long as the player is trying to set its level — the one moment they need to hear
   * it. Uses the entry cue: short, unambiguous, and not the alarming one.
   */
  previewSfx(): void
  dispose(): void
}

export interface AudioOptions extends AudioMix {
  themeId: string
  /** Seeds the bed's voicing, so a run sounds the same way twice. */
  worldSeed: number
  /**
   * Which channels to build.
   *
   * `menu` is the title and settings screens: the bed plays, and stingers exist only
   * so the effects slider can be auditioned. Sonification isn't built at all —
   * there are no bars being played to sonify, and a synth that can never be
   * triggered is still a synth kept alive in the audio graph.
   *
   * In `menu` mode `update()` is a no-op regardless, so nothing behind a menu can
   * fire a cue by accident. The only way a stinger sounds there is `previewSfx()`.
   */
  channels?: 'all' | 'menu'
  /**
   * A decoded background track for channel 1, replacing the generated bed.
   *
   * Passed in rather than fetched here because `src/audio` may not import `@data` —
   * the composition root loads it and hands over the notes. Absent means the theme
   * has no track file, and the generated bed plays instead.
   */
  track?: MidiTrack
}

/** Seconds to ramp a gain change over. Short enough to feel instant, long enough not to click. */
const MIX_RAMP = 0.04

export function createAudio(options: AudioOptions): AudioSystem {
  const theme: AudioTheme = audioTheme(options.themeId)

  // Mixing knobs sit on top of whichever theme is active — they are not theme
  // properties.
  const master = new Tone.Gain(1).toDestination()
  master.gain.value = toGain(options.masterVolume, false)

  const reverb = new Tone.Reverb({ decay: 4, wet: theme.bed.reverbSend }).connect(master)
  const delay = new Tone.FeedbackDelay({ delayTime: 0.36, feedback: 0.28, wet: theme.bed.delaySend })
  delay.connect(reverb)

  const musicBus = new Tone.Gain(1)
  musicBus.gain.value = toGain(options.musicVolume, options.musicMuted)
  musicBus.connect(delay)

  const sfxBus = new Tone.Gain(1)
  sfxBus.gain.value = toGain(options.sfxVolume, options.sfxMuted)
  sfxBus.connect(master)

  const menuOnly = options.channels === 'menu'
  // A composed track wins over the generated bed when the theme ships one. Both
  // satisfy `AmbientBed`, so nothing below this line knows which is playing.
  const bed =
    options.track && options.track.notes.length > 0
      ? createTrackBed(options.track, musicBus)
      : createAmbientBed(theme, musicBus, options.worldSeed)
  const sonification = menuOnly ? undefined : createSonification(theme, sfxBus)
  // Built even in menu mode, for `previewSfx` alone.
  const stingers = createStingers(theme, sfxBus)

  let started = false
  let paused = false
  /** So a bar is sonified once, not on every frame of that bar. */
  let lastSonifiedIndex = -1
  let previousClose: number | undefined

  const fire = (event: PositionEvent): void => {
    const key = eventKey(event)
    // `positionClosed.profit` / `.loss` are theme keys rather than separate event
    // types, which is why the mapping lives in engine/output and not here.
    if (key in theme.stingers) stingers.play(key as keyof AudioTheme['stingers'])
  }

  return {
    async start() {
      if (started) return
      await Tone.start()
      started = true
      bed.start()
    },

    update(frame) {
      if (!started || paused || menuOnly) return

      for (const event of frame.events) fire(event)

      const bar = frame.currentBar
      if (bar && frame.currentIndex !== lastSonifiedIndex) {
        lastSonifiedIndex = frame.currentIndex
        if (previousClose !== undefined) sonification?.playMove(previousClose, bar.c)
        previousClose = bar.c
      }
    },

    setMix(mix) {
      // Ramped rather than set, so dragging a slider doesn't machine-gun clicks into
      // the output — a stepped gain change on a sounding voice is an audible edge.
      master.gain.rampTo(toGain(mix.masterVolume, false), MIX_RAMP)
      musicBus.gain.rampTo(toGain(mix.musicVolume, mix.musicMuted), MIX_RAMP)
      sfxBus.gain.rampTo(toGain(mix.sfxVolume, mix.sfxMuted), MIX_RAMP)
    },

    previewSfx() {
      if (!started) return
      stingers.play('positionOpened')
    },

    setPaused(next) {
      paused = next
      if (!started) return
      // Pause freezes the pipeline entirely — audio included, or a frozen chart
      // with a live soundtrack reads as a bug.
      if (next) bed.stop()
      else bed.start()
    },

    dispose() {
      bed.dispose()
      sonification?.dispose()
      stingers.dispose()
      musicBus.dispose()
      sfxBus.dispose()
      delay.dispose()
      reverb.dispose()
      master.dispose()
    },
  }
}
