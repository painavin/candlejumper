import { describe, expect, it } from 'vitest'
import { visualThemes } from '@content/visualThemes/index.js'
import { MIN_HUD_FONT_SIZE } from './hudFont.js'
import { HUD_OUTLINE_WIDTH, hudDimTextStyle, hudTextStyle } from './hudText.js'

/**
 * The HUD is drawn over a moving scene, so legibility can't come from picking a fill
 * colour — it has to come from the glyph's edge. These assert that every style the
 * factory hands out actually carries that edge, which is the whole reason the factory
 * exists rather than seven files each building their own style object.
 */

const [jolly, serious] = visualThemes as [
  (typeof visualThemes)[number],
  (typeof visualThemes)[number],
]

describe('hudTextStyle', () => {
  it('outlines every style it produces', () => {
    for (const theme of visualThemes) {
      const style = hudTextStyle({ theme, size: 14 })
      expect(style.stroke, theme.id).toMatchObject({
        color: theme.accent.outline,
        width: HUD_OUTLINE_WIDTH,
      })
    }
  })

  it('outlines the dim variant too, which is where the problem actually was', () => {
    // Secondary text over a bright sky was the least legible thing on screen.
    for (const theme of visualThemes) {
      const style = hudDimTextStyle(theme, 12)
      expect(style.fill, theme.id).toBe(theme.accent.dim)
      expect(style.stroke, theme.id).toBeDefined()
    }
  })

  it('outlines text whose fill is information rather than the theme colour', () => {
    // P&L direction and indicator series colours override the fill; losing the
    // outline with them would make exactly the numbers that matter most unreadable.
    const style = hudTextStyle({ theme: jolly, size: 16, fill: 0x4ddb7a })
    expect(style.fill).toBe(0x4ddb7a)
    expect(style.stroke).toBeDefined()
  })

  it('still enforces the accessibility size floor', () => {
    // The factory now owns style *and* size, so the floor has to survive the move.
    expect(hudTextStyle({ theme: jolly, size: 8 }).fontSize).toBe(MIN_HUD_FONT_SIZE)
    expect(hudTextStyle({ theme: jolly, size: 20 }).fontSize).toBe(20)
  })

  it('rounds the outline join, so small digits do not grow spikes', () => {
    expect(hudTextStyle({ theme: jolly, size: 12 }).stroke).toMatchObject({ join: 'round' })
  })
})

describe('theme outline colours', () => {
  /** Rec. 601 luma, which is close enough for a light-vs-dark judgement. */
  const luma = (colour: number): number =>
    (0.299 * ((colour >> 16) & 0xff) + 0.587 * ((colour >> 8) & 0xff) + 0.114 * (colour & 0xff)) /
    255

  it('opposes the text it sits behind, in every theme', () => {
    // The property that makes an outline work at all. A theme shipping a light
    // outline behind light text would leave the HUD exactly as unreadable as before,
    // and it would look deliberate.
    for (const theme of visualThemes) {
      const gap = Math.abs(luma(theme.accent.text) - luma(theme.accent.outline))
      expect(gap, `${theme.id} outline does not contrast with its text`).toBeGreaterThan(0.4)
    }
  })

  it('opposes the dim colour as well', () => {
    for (const theme of visualThemes) {
      const gap = Math.abs(luma(theme.accent.dim) - luma(theme.accent.outline))
      expect(gap, `${theme.id} outline does not contrast with its dim text`).toBeGreaterThan(0.4)
    }
  })

  it('keeps dim close to text, since the outline now supplies the contrast', () => {
    // Counterintuitive but load-bearing: with an outline, secondary text reads as
    // light-on-dark-edge, so `dim` being nearly as light as `text` *raises* contrast.
    // A much darker `dim` would fight the outline instead of resting on it.
    for (const theme of visualThemes) {
      const gap = Math.abs(luma(theme.accent.text) - luma(theme.accent.dim))
      expect(gap, `${theme.id} dim is too far from its text`).toBeLessThan(0.25)
    }
  })

  it('gives the two moods genuinely different outlines', () => {
    expect(jolly.accent.outline).not.toBe(serious.accent.outline)
  })
})
