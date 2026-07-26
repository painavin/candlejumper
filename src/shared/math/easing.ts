/** Clamp to an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Inverse lerp: where `value` sits in [a, b], as 0..1. Returns 0 if a === b. */
export function normalize(value: number, a: number, b: number): number {
  return b === a ? 0 : (value - a) / (b - a)
}

/**
 * Frame-rate-independent exponential smoothing.
 *
 * The naive form `current += (target - current) * factor` converges at a rate
 * that depends on how often it's called, so the same easing would settle at
 * different speeds on a 60Hz and a 120Hz display. This corrects for elapsed
 * time, which matters here because the Y-axis easing is load-bearing rather
 * than cosmetic — see docs/hud.md#y-axis-auto-scaling-price-axis.
 *
 * @param smoothing fraction of the remaining distance left after one second
 *                  (0.001 = very snappy, 0.5 = languid)
 */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return lerp(target, current, Math.pow(smoothing, dt))
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1)
  return 1 - u * u * u
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** A parabolic 0→1→0 arc, for a fixed-height hop. */
export function arc(t: number): number {
  const x = clamp(t, 0, 1)
  return 4 * x * (1 - x)
}
