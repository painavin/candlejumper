import type { VisualTheme } from './types.js'

/**
 * Two moods, as plain data. Adding a third is another object of this size — no
 * pipeline, no files, no build step.
 *
 * Note that `serious`'s "city skyline" falls out of the *same* mountain generator
 * at high frequency, low amplitude, maximum ridge sharpness, rather than needing
 * separate art. That's the payoff of themes-as-parameters.
 */

export const jollyTheme: VisualTheme = {
  id: 'jolly',
  displayName: 'Jolly',
  palette: {
    sky: [0x2f6ea8, 0x8fc4e8],
    mountains: [0x5b4b8a, 0x7a6bb0],
    trees: 0x2f7d4f,
    poles: 0xf06a6a,
    polesForming: 0xffa4a4,
    ground: 0x3e8a58,
    groundLine: 0x2b6b42,
    clouds: 0xffffff,
    fog: 0xdfefff,
    foreground: 0x276b41,
  },
  accent: { text: 0xffffff, dim: 0xc8dcee, axisLine: 0x9dc4e0, accent: 0xffd166 },
  terrain: {
    mountainsFar: { amplitude: 0.42, frequency: 3.2, octaves: 4, ridgeSharpness: 0.1, gain: 0.5 },
    mountainsNear: { amplitude: 0.3, frequency: 5.1, octaves: 4, ridgeSharpness: 0.15, gain: 0.5 },
    trees: { amplitude: 0.2, frequency: 14, octaves: 3, ridgeSharpness: 0.05, gain: 0.55 },
  },
  clouds: { style: 'puffy', density: 7, scale: 0.1 },
  // Sparse on purpose: this layer crosses the character, and it must never
  // obscure poles the player is trading.
  foreground: { motif: 'grass', density: 26 },
  poles: { capStyle: 'round', outline: false },
}

export const seriousTheme: VisualTheme = {
  id: 'serious',
  displayName: 'Serious',
  palette: {
    sky: [0x1b2331, 0x3d4a5c],
    mountains: [0x2a3341, 0x374250],
    trees: 0x2b3542,
    poles: 0x8fa3bd,
    polesForming: 0xc2d3e6,
    ground: 0x222b36,
    groundLine: 0x39465a,
    clouds: 0x9aa8b8,
    fog: 0x2a3340,
    foreground: 0x1a222c,
  },
  accent: { text: 0xe6edf5, dim: 0x8494a8, axisLine: 0x44536a, accent: 0x4da3ff },
  terrain: {
    mountainsFar: { amplitude: 0.46, frequency: 2.6, octaves: 5, ridgeSharpness: 0.85, gain: 0.48 },
    // The skyline: high frequency, low amplitude, maximum ridging.
    mountainsNear: { amplitude: 0.26, frequency: 22, octaves: 2, ridgeSharpness: 1, gain: 0.4 },
    trees: { amplitude: 0.12, frequency: 30, octaves: 2, ridgeSharpness: 0.9, gain: 0.5 },
  },
  clouds: { style: 'wispy', density: 4, scale: 0.14 },
  foreground: { motif: 'railing', density: 12 },
  poles: { capStyle: 'flat', outline: true },
}

export const visualThemes: readonly VisualTheme[] = [jollyTheme, seriousTheme]

export function visualTheme(id: string): VisualTheme {
  return visualThemes.find((theme) => theme.id === id) ?? jollyTheme
}
