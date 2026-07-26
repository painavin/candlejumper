import { visualTheme } from '@content/visualThemes/index.js'

/**
 * The menus' colours, taken from the *game's* theme rather than invented.
 *
 * Before this, every screen hardcoded its own hex values, which is why the front
 * page looked like a web form sitting in front of a game instead of part of one.
 * The palettes and accents already exist as data for the renderer; `ui/` is
 * permitted to import `@content`, so there was never a structural reason for the
 * menus to have their own look.
 *
 * Emitted as CSS custom properties on the screen root rather than as inline styles
 * per element, so the stylesheets stay ordinary CSS and switching mood restyles
 * everything at once.
 */

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

function rgba(value: number, alpha: number): string {
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * `style` attribute value for a screen root.
 *
 * Panels are translucent on purpose: attract mode is playing behind them, and a
 * menu that hides the game it's advertising defeats the point. The scrim is what
 * keeps text legible over a moving scene — without it, light poles under white text
 * make the whole thing unreadable.
 */
export function uiVars(themeId: string): string {
  const theme = visualTheme(themeId)
  return [
    `--ink: ${hex(theme.accent.text)}`,
    `--dim: ${hex(theme.accent.dim)}`,
    `--accent: ${hex(theme.accent.accent)}`,
    `--panel: ${rgba(theme.palette.sky[0], 0.72)}`,
    `--panel-solid: ${hex(theme.palette.sky[0])}`,
    `--field: ${rgba(theme.palette.mountains[0], 0.55)}`,
    `--edge: ${rgba(theme.accent.axisLine, 0.45)}`,
    `--scrim: ${rgba(theme.palette.mountains[0], 0.55)}`,
    `--up: ${hex(theme.palette.ground)}`,
    `--down: ${hex(theme.palette.poles)}`,
  ].join('; ')
}
