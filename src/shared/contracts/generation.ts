/**
 * Parameter shapes for procedural generation.
 *
 * These live in `shared/` because they're a **seam**: `content/` declares theme
 * parameter sets using them and `generation/` consumes them, and neither zone may
 * import the other. They pass the shared/ admission test on both counts — used by
 * two or more top-level folders, and importing nothing outside shared/.
 */

export interface FbmParams {
  /** How many octaves to sum. More detail, more cost. */
  octaves: number
  /** Frequency multiplier per octave. */
  lacunarity?: number
  /** Amplitude multiplier per octave. */
  gain?: number
  /**
   * 0 = rounded hills, 1 = sharp ridges. Ridging folds the noise about its
   * midpoint, which is what turns one generator into a mountain range or a city
   * skyline depending only on parameters.
   */
  ridgeSharpness?: number
}

export interface HeightfieldParams extends FbmParams {
  /** Peak height as a fraction of the layer's drawing height, 0..1. */
  amplitude: number
  /** How many noise cycles fit across one tile. Higher = busier silhouette. */
  frequency: number
}

export interface CloudParams {
  style: 'puffy' | 'wispy'
  /** Clouds per tile width. */
  density: number
  /** Base radius as a fraction of tile height. */
  scale: number
}

export interface MotifParams {
  motif: 'grass' | 'leaves' | 'railing'
  /** Motifs per tile width. */
  density: number
}
