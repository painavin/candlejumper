import { Container, Graphics, Text } from 'pixi.js'
import type { PnlPalette } from '@config/index.js'
import type { FrameState, PositionEvent } from '@engine/output/index.js'
import { clamp, createPrng, easeOutCubic } from '@shared/math/index.js'
import type { Layout } from '../stage/layout.js'
import { HUD_FONT, hudFontSize } from '../hud/hudFont.js'

/**
 * Per-action feedback.
 *
 * Everything here is **reactive** — feedback on what just happened — never
 * anticipatory. The no-lookahead constraint rules out the whole family of
 * anticipatory mechanics endless runners normally lean on (steering toward pickups,
 * dodging telegraphed obstacles), because nothing ahead of the character is ever
 * visible. That's a real constraint on how game-like this can feel, and the direct
 * cost of the training goal.
 *
 * Floating text is keyed to the **close event**, not the sell button: closing a
 * short is a `buy` press, so a button-keyed trigger would show nothing on half of
 * all short exits and fire spuriously on short entries.
 */

export interface JuiceLayer {
  container: Container
  /** Returns the camera shake offset to apply this frame. */
  draw(frame: FrameState, layout: Layout, dt: number): { shakeX: number; shakeY: number }
}

interface FloatingLabel {
  text: Text
  age: number
  x: number
  y: number
}

/**
 * One particle. Drawn as a rectangle rather than a sprite for the same reason
 * everything else here is: no asset pipeline, and a few dozen rects per burst is
 * cheaper than the texture upload would be.
 */
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  colour: number
  /** Dust settles; confetti tumbles. */
  spin: number
}

const LIFETIME = 1.1
const RISE = 54
/** Gravity, in pixels per second squared. Tuned to look like weight, not physics. */
const GRAVITY = 620
/** Hard cap, so a flurry of exits can't accumulate into a frame-rate problem. */
const MAX_PARTICLES = 220

export interface JuiceOptions {
  palette: PnlPalette
  /** Screen shake toggle, and the broader reduced-motion setting. */
  screenShake: boolean
  reducedMotion: boolean
  /** Particles are seeded, like every other random-looking thing in the game. */
  worldSeed?: number
}

const PNL_COLOURS = {
  'blue-orange': { up: 0x4da3ff, down: 0xff9d4d },
  'red-green': { up: 0x4ddb7a, down: 0xff6b6b },
} as const

export function createJuiceLayer({
  palette,
  screenShake,
  reducedMotion,
  worldSeed = 1,
}: JuiceOptions): JuiceLayer {
  const container = new Container()
  const particleGraphics = new Graphics()
  const flash = new Graphics()
  // Particles sit under the floating number: the number is information, the burst
  // is decoration, and decoration must never obscure a value the player is reading.
  container.addChild(particleGraphics, flash)

  const labels: FloatingLabel[] = []
  const pool: Text[] = []
  const particles: Particle[] = []
  const colours = PNL_COLOURS[palette]
  const prng = createPrng(worldSeed)

  let shake = 0
  let flashAlpha = 0
  /** Deterministic wobble: no Math.random anywhere, including in cosmetics. */
  let shakePhase = 0

  const spawn = (event: Extract<PositionEvent, { kind: 'positionClosed' }>, layout: Layout): void => {
    const text = pool.pop() ?? makeText()
    // Sign and an arrow, so the value reads correctly with no colour at all —
    // P&L direction is never conveyed by hue alone.
    const arrow = event.realized > 0 ? '▲' : event.realized < 0 ? '▼' : '·'
    const sign = event.realized > 0 ? '+' : event.realized < 0 ? '−' : ''
    text.text = `${arrow} ${sign}$${Math.abs(event.realized).toFixed(2)}`
    text.style.fill = event.realized >= 0 ? colours.up : colours.down
    text.alpha = 1
    text.visible = true
    container.addChild(text)
    labels.push({ text, age: 0, x: layout.characterX, y: layout.chartTop + layout.chartHeight * 0.4 })
  }

  /**
   * A burst at the character.
   *
   * Confetti on a profitable close goes *up* and outward; the stop-out puff goes
   * sideways and down, hugging the ground. The difference is the point — the two
   * events should be distinguishable from the corner of your eye, without reading
   * the number.
   */
  const burst = (
    kind: 'confetti' | 'dust',
    layout: Layout,
    count: number,
    colour: number
  ): void => {
    if (reducedMotion) return
    const x = layout.characterX
    const y = kind === 'confetti' ? layout.chartTop + layout.chartHeight * 0.45 : layout.groundY
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      const angle =
        kind === 'confetti'
          ? prng.range(-Math.PI * 0.85, -Math.PI * 0.15)
          : prng.range(-Math.PI * 0.35, -Math.PI * 0.05) + (prng.chance(0.5) ? Math.PI : 0)
      const speed = kind === 'confetti' ? prng.range(150, 330) : prng.range(60, 170)
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: kind === 'confetti' ? prng.range(0.7, 1.3) : prng.range(0.35, 0.7),
        size: kind === 'confetti' ? prng.range(3, 6) : prng.range(2, 5),
        colour,
        spin: kind === 'confetti' ? prng.range(-9, 9) : 0,
      })
    }
  }

  return {
    container,

    draw(frame, layout, dt) {
      for (const event of frame.events) {
        if (event.kind === 'positionClosed') {
          spawn(event, layout)
          if (event.realized > 0) {
            burst('confetti', layout, 26, colours.up)
            // A smaller punch on a notably large win; the big one is reserved for
            // being taken out.
            if (screenShake && !reducedMotion) shake = Math.max(shake, 3)
          } else if (event.realized < 0) {
            // A loss taken on purpose gets a muted acknowledgement rather than
            // nothing: it's still a completed decision, and under the discipline
            // rules it may well have built the streak.
            burst('dust', layout, 10, colours.down)
          }
        }
        if (event.kind === 'stoppedOut') {
          burst('dust', layout, 30, colours.down)
          if (screenShake && !reducedMotion) shake = 9
          flashAlpha = 0.32
        }
      }

      particleGraphics.clear()
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i]
        if (!particle) continue
        particle.age += dt
        if (particle.age >= particle.life) {
          particles.splice(i, 1)
          continue
        }
        particle.vy += GRAVITY * dt
        particle.x += particle.vx * dt
        particle.y += particle.vy * dt

        const fade = 1 - particle.age / particle.life
        // Tumble is faked by squashing width over time rather than rotating each
        // rect: visually equivalent at this size, and one draw call cheaper.
        const width = particle.size * (particle.spin === 0 ? 1 : Math.abs(Math.cos(particle.age * particle.spin)))
        particleGraphics
          .rect(particle.x - width / 2, particle.y - particle.size / 2, Math.max(1, width), particle.size)
          .fill({ color: particle.colour, alpha: fade })
      }

      for (let i = labels.length - 1; i >= 0; i--) {
        const label = labels[i]
        if (!label) continue
        label.age += dt
        const t = clamp(label.age / LIFETIME, 0, 1)
        label.text.position.set(label.x, label.y - easeOutCubic(t) * RISE)
        label.text.alpha = 1 - t
        if (t >= 1) {
          label.text.visible = false
          container.removeChild(label.text)
          pool.push(label.text)
          labels.splice(i, 1)
        }
      }

      flash.clear()
      if (flashAlpha > 0.001) {
        // A vignette rather than a full wash, so the chart stays readable while the
        // stop-out registers.
        flash.rect(0, 0, layout.width, layout.height).fill({ color: colours.down, alpha: flashAlpha })
        flashAlpha = Math.max(0, flashAlpha - dt * 1.6)
      }

      shakePhase += dt * 46
      shake = Math.max(0, shake - dt * 26)
      return {
        shakeX: Math.sin(shakePhase) * shake,
        shakeY: Math.cos(shakePhase * 1.31) * shake,
      }
    },
  }

  function makeText(): Text {
    const text = new Text({
      text: '',
      style: {
        fontFamily: HUD_FONT,
        fontSize: hudFontSize(16),
        fontWeight: 'bold',
      },
    })
    text.anchor.set(0.5, 1)
    return text
  }
}
