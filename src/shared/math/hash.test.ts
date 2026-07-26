import { describe, expect, it } from 'vitest'
import { canonicalize, hashString, stableHash } from './hash.js'

describe('canonicalize', () => {
  it('sorts object keys at every depth', () => {
    const a = { b: 1, a: { d: 2, c: 3 } }
    const b = { a: { c: 3, d: 2 }, b: 1 }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })

  it('preserves array order, because order can be meaningful', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('drops undefined values rather than encoding them', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }))
  })

  it('treats -0 and 0 as the same configuration', () => {
    expect(canonicalize({ x: -0 })).toBe(canonicalize({ x: 0 }))
  })

  it('refuses to fingerprint a non-finite number', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(/non-finite/)
  })
})

describe('stableHash', () => {
  it('is insensitive to key insertion order', () => {
    // A personal-best bucket must not split because a config object was built
    // in a different order.
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }))
  })

  it('changes when a value changes', () => {
    expect(stableHash({ scrollSpeed: 2 })).not.toBe(stableHash({ scrollSpeed: 4 }))
  })

  it('renders as 8 hex digits', () => {
    expect(stableHash({ a: 1 })).toMatch(/^[0-9a-f]{8}$/)
  })

  it('does not collide on a nesting change', () => {
    expect(hashString('{"a":{"b":1}}')).not.toBe(hashString('{"a":1,"b":1}'))
  })
})
