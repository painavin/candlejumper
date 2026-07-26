/**
 * Haptics — the only zone allowed anywhere near a native API.
 *
 * docs/game-feel.md asks for haptics on buy/sell/stop-out via Capacitor's Haptics
 * plugin on mobile. That plugin isn't a dependency yet (packaging is roadmap step
 * 11), so this ships the **web** implementation, `navigator.vibrate`, behind the
 * same interface. When Capacitor lands, the swap happens inside this file and
 * nothing else changes — which is the entire reason `platform/` exists.
 *
 * `navigator.vibrate` is absent on iOS Safari and desktop, so every call is
 * feature-detected and silently does nothing. That's correct behaviour, not a
 * degradation: haptics are always redundant with something visible and audible.
 */

/** Semantic, not durations — the caller shouldn't be choosing milliseconds. */
export type HapticKind = 'action' | 'warning'

export interface Haptics {
  fire(kind: HapticKind): void
}

/** Short enough to read as a click rather than a buzz. */
const PATTERN: Record<HapticKind, number | number[]> = {
  action: 12,
  // Two beats, so a stop-out is distinguishable from a press without looking —
  // the same reason its audio cue is deliberately unlike a manual exit's.
  warning: [24, 40, 24],
}

export function createHaptics(enabled = true): Haptics {
  const vibrate = (globalThis.navigator as { vibrate?: (p: number | number[]) => boolean })?.vibrate

  return {
    fire(kind) {
      if (!enabled || typeof vibrate !== 'function') return
      try {
        vibrate.call(globalThis.navigator, PATTERN[kind])
      } catch {
        // A blocked or unsupported call must never interrupt a run.
      }
    },
  }
}
