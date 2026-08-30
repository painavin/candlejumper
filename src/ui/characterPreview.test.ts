import { describe, expect, it } from 'vitest'
import { characters, frog, robin, rocket } from '@content/characters/index.js'
import { previewShapes, previewViewBox, rigBounds } from './characterPreview.js'

/**
 * The settings picker's rig preview.
 *
 * Worth having because the preview has to agree with `drawShape` about what a rig means
 * and nothing enforces that agreement — so the parts with a right answer (bounds under
 * rotation, draw order, the shared viewBox) are pinned here.
 */

describe('rigBounds', () => {
  it('accounts for rotation', () => {
    /**
     * The rocket's nose is a triangle turned a quarter turn, so its 0.5 of *height*
     * becomes width and its 0.5 of width becomes height. Measuring the unrotated box
     * would put the nose inside the fuselage and clip it out of the viewBox.
     */
    const upright = rigBounds([
      { shape: 'triangle', dx: 0, dy: 0, width: 0.4, height: 1, slot: 'body' },
    ])
    const turned = rigBounds([
      { shape: 'triangle', dx: 0, dy: 0, width: 0.4, height: 1, slot: 'body', rotation: Math.PI / 2 },
    ])
    expect(upright.maxX).toBeCloseTo(0.2)
    expect(upright.maxY).toBeCloseTo(0.5)
    // A quarter turn swaps them.
    expect(turned.maxX).toBeCloseTo(0.5)
    expect(turned.maxY).toBeCloseTo(0.2)
  })

  it('measures a rotated ellipse by its true extent, not its bounding square', () => {
    // Half a turn of an axis-aligned ellipse changes nothing, which is the cheapest
    // check that the trigonometry is extents and not a naive max of the two radii.
    const flat = rigBounds([{ shape: 'ellipse', dx: 0, dy: 0, width: 1, height: 0.5, slot: 'body' }])
    const turned = rigBounds([
      { shape: 'ellipse', dx: 0, dy: 0, width: 1, height: 0.5, slot: 'body', rotation: Math.PI },
    ])
    expect(turned.maxX).toBeCloseTo(flat.maxX)
    expect(turned.maxY).toBeCloseTo(flat.maxY)
  })

  it('includes the rig origin, so a preview is always centred on the body', () => {
    const bounds = rigBounds([{ shape: 'ellipse', dx: 3, dy: 3, width: 0.2, height: 0.2, slot: 'body' }])
    expect(bounds.minX).toBeLessThanOrEqual(0)
    expect(bounds.minY).toBeLessThanOrEqual(0)
  })
})

describe('previewViewBox', () => {
  it('is square and centred on the origin, so every cell frames its body alike', () => {
    const [x, y, width, height] = previewViewBox().split(' ').map(Number) as number[]
    expect(width).toBe(height)
    expect(x).toBeCloseTo(-(width as number) / 2)
    expect(y).toBeCloseTo(-(height as number) / 2)
  })

  it('contains every rig in the roster', () => {
    /**
     * The one assertion that matters. A rig poking outside the box is silently cropped,
     * which is exactly how the foreground motifs shipped with their canopies cut off.
     */
    const [x, y, width, height] = previewViewBox().split(' ').map(Number) as number[]
    for (const entry of characters) {
      const bounds = rigBounds(entry.rig)
      // Bounds are in radii; the box is in the preview's own units.
      const scale = 100
      expect(bounds.minX * scale, `${entry.id} left`).toBeGreaterThanOrEqual(x as number)
      expect(bounds.minY * scale, `${entry.id} top`).toBeGreaterThanOrEqual(y as number)
      expect(bounds.maxX * scale, `${entry.id} right`).toBeLessThanOrEqual((x as number) + (width as number))
      expect(bounds.maxY * scale, `${entry.id} bottom`).toBeLessThanOrEqual((y as number) + (height as number))
    }
  })

  it('is shared, so a frog and a rocket are not scaled to the same height', () => {
    // Per-character boxes would normalise away proportion, which is the whole thing the
    // preview exists to show.
    expect(previewViewBox([frog])).toBe(previewViewBox([frog, frog]))
    expect(previewViewBox([frog])).not.toBe(previewViewBox([rocket]))
  })
})

describe('previewShapes', () => {
  it('keeps the rig order, because rigs use it for depth', () => {
    /**
     * The frog's haunch is listed before its body so the body covers the haunch's root and
     * only the bump over the back shows; the squirrel's tail is before its torso for the
     * same reason. Reordering would flatten both.
     *
     * Asserted as a correspondence rather than by pinning which part is which — the first
     * version named the frog's shape kinds and broke the moment the rig changed, which is
     * a test measuring the wrong thing.
     */
    for (const entry of [frog, robin, rocket]) {
      const kinds = previewShapes(entry).map((shape) => shape.kind)
      const expected = entry.rig.map((shape) => (shape.shape === 'triangle' ? 'polygon' : 'ellipse'))
      expect(kinds, entry.id).toEqual(expected)
    }
  })

  it('fills from the character palette', () => {
    const shapes = previewShapes(robin)
    expect(shapes[0]?.fill).toBe('#f2c14e')
  })

  it('omits the rotation when there is none, and emits degrees when there is', () => {
    // Fins, fuselage, then the nose cone — a quarter turn anticlockwise.
    const nose = previewShapes(rocket)[3]
    expect(previewShapes(robin)[0]?.transform).toBe('translate(0 0)')
    expect(nose?.transform).toContain('rotate(-90')
  })

  it('draws an arc as an ellipse about its own centre, matching the layer', () => {
    /**
     * Not a hinge at the inner edge, despite the wing reading that way — the layer's
     * offset and pivot cancel out. Mirrored here on purpose: the preview being *wrong in
     * the same way* is better than the two disagreeing.
     */
    const wing = previewShapes(robin)[1]
    expect(wing?.kind).toBe('ellipse')
    expect(wing?.transform).toBe('translate(-32 5)')
  })
})
