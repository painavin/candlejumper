/**
 * Stable hashing, for the run fingerprint.
 *
 * "Stable" means two structurally equal values hash identically across
 * sessions, machines, and key insertion order — a personal-best bucket looked
 * up by this must not silently split because a config object was built in a
 * different order. `JSON.stringify` alone does not give that.
 *
 * See docs/game-feel.md#new-session-structure-the-highest-leverage-item-here.
 */

/** JSON-shaped values, which is all a fingerprint ever contains. */
export type Hashable =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Hashable[]
  | { readonly [key: string]: Hashable }

/** Serialize with object keys sorted at every depth. Arrays keep their order. */
export function canonicalize(value: Hashable): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') {
    // -0 and 0 are the same configuration; NaN/Infinity shouldn't reach here.
    if (!Number.isFinite(value)) throw new Error(`Cannot fingerprint non-finite number: ${value}`)
    return JSON.stringify(value === 0 ? 0 : value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`

  const entries = Object.entries(value as Record<string, Hashable>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
  return `{${entries.join(',')}}`
}

/**
 * FNV-1a, 32-bit, rendered as 8 lowercase hex digits.
 *
 * Not cryptographic and doesn't need to be — this keys a local personal-best
 * bucket, and the inputs are a dozen config values rather than adversarial.
 */
export function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function stableHash(value: Hashable): string {
  return hashString(canonicalize(value))
}
