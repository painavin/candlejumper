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

/**
 * The foreground silhouettes, in the order the seeded pick sees them.
 *
 * Ground cover (`grass`, `leaves`, `reeds`, `rocks`) sits low and adds weight near the
 * ground line; the upright kinds (`trees`, `conifer`, `bushes`) are tall enough to cross
 * the character, which is what makes the layer an occlusion cue rather than decoration.
 *
 * All seven come off the same placement list — only the shape differs — so adding one is
 * a name here, a branch in `bakeMotifs`, and a base density. There was a `railing` of
 * plain upright posts; it is gone, because on a dark scene a row of dark posts reads as
 * a black bar rather than as occlusion.
 */
export const MOTIF_KINDS = [
  'grass',
  'leaves',
  'reeds',
  'rocks',
  'bushes',
  'trees',
  'conifer',
] as const

export type MotifKind = (typeof MOTIF_KINDS)[number]

export interface MotifParams {
  /**
   * How dense this mood wants its foreground, as a **multiple of the chosen motif's
   * own default** — 1 leaves it alone.
   *
   * A plain count cannot work now that the motif is picked per world: 26 is a pleasant
   * scatter of grass and a solid wall of trees. So the count comes from the motif and
   * this only nudges it, which keeps a mood able to be sparser or busier than another
   * without having to know which shape it will get.
   *
   * Sparseness has a hard reason rather than a stylistic one — this layer crosses the
   * character and must never hide a pole being traded — so the scale is clamped well
   * below anything that would crowd the strip.
   */
  densityScale: number
}
