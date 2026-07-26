import * as Tone from 'tone'
import { audioTheme } from '@content/audioThemes/index.js'
import type { AudioTheme } from '@content/audioThemes/types.js'
import type { FrameState, PositionEvent } from '@engine/output/index.js'
import { eventKey } from '@engine/output/index.js'
import { createAmbientBed } from './channels/bed.js'
import { createSonification } from './channels/sonification.js'
import { createStingers } from './channels/stingers.js'

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

export interface AudioSystem {
  /**
   * Browsers require a user gesture before audio can start. Called from the Start
   * button's handler, which is exactly such a gesture.
   */
  start(): Promise<void>
  /** Feed one frame: fires stingers for its events and sonifies a completed bar. */
  update(frame: FrameState): void
  setPaused(paused: boolean): void
  dispose(): void
}

export interface AudioOptions {
  themeId: string
  masterVolume: number
  musicVolume: number
  musicMuted: boolean
  sfxVolume: number
  sfxMuted: boolean
  /** Seeds the bed's voicing, so a run sounds the same way twice. */
  worldSeed: number
}

/** Linear 0..1 slider → decibels. Muted is silence, not -60dB. */
function toDecibels(volume: number, muted: boolean): number {
  if (muted || volume <= 0) return -Infinity
  return Tone.gainToDb(volume)
}

export function createAudio(options: AudioOptions): AudioSystem {
  const theme: AudioTheme = audioTheme(options.themeId)

  // Mixing knobs sit on top of whichever theme is active — they are not theme
  // properties.
  const master = new Tone.Gain(1).toDestination()
  master.gain.value = Tone.dbToGain(toDecibels(options.masterVolume, false))

  const reverb = new Tone.Reverb({ decay: 4, wet: theme.bed.reverbSend }).connect(master)
  const delay = new Tone.FeedbackDelay({ delayTime: 0.36, feedback: 0.28, wet: theme.bed.delaySend })
  delay.connect(reverb)

  const musicBus = new Tone.Gain(1)
  musicBus.gain.value = Tone.dbToGain(toDecibels(options.musicVolume, options.musicMuted))
  musicBus.connect(delay)

  const sfxBus = new Tone.Gain(1)
  sfxBus.gain.value = Tone.dbToGain(toDecibels(options.sfxVolume, options.sfxMuted))
  sfxBus.connect(master)

  const bed = createAmbientBed(theme, musicBus, options.worldSeed)
  const sonification = createSonification(theme, sfxBus)
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
      if (!started || paused) return

      for (const event of frame.events) fire(event)

      const bar = frame.currentBar
      if (bar && frame.currentIndex !== lastSonifiedIndex) {
        lastSonifiedIndex = frame.currentIndex
        if (previousClose !== undefined) sonification.playMove(previousClose, bar.c)
        previousClose = bar.c
      }
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
      sonification.dispose()
      stingers.dispose()
      musicBus.dispose()
      sfxBus.dispose()
      delay.dispose()
      reverb.dispose()
      master.dispose()
    },
  }
}
