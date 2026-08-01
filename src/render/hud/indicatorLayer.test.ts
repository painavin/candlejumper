// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { Graphics } from 'pixi.js'
import { jollyTheme } from '@content/visualThemes/index.js'
import type { FrameState, OverlayLine, SubPane } from '@engine/output/index.js'
import { computeLayout } from '../stage/layout.js'
import { createIndicatorLayer } from './indicatorLayer.js'

/**
 * What one indicator output can do to another's, given that they share a `Graphics`.
 *
 * The docs say rendering is verified by playing rather than by tests, and that still
 * holds for anything about how a chart *looks*. This is different, and it's here because
 * of a real defect: Pixi's `fill()` reuses the previous instruction's path when no
 * geometry has been queued since it, so an output with nothing in the current window
 * filled the *previous* output's polyline in its own colour — a lavender wedge spanning
 * the chart where a level line should have been.
 *
 * So the assertion is on Pixi's queued draw instructions, private list and all. That's
 * the point rather than a compromise: the bug is *in* that list, and the property worth
 * pinning is a colour nobody should have painted in, which no screenshot check states as
 * plainly.
 */

interface Instruction {
  action: string
  data: { path: unknown; style: { color?: number } }
}

/**
 * A 2D context good enough to measure text, which jsdom does not provide.
 *
 * The legend sizes its plate from `Text.width`, so drawing more than one output goes
 * through Pixi's font metrics — and without this the layer throws before reaching
 * anything under test. Made-up numbers on purpose: nothing here asserts a pixel, only
 * which colours were painted.
 */
beforeAll(() => {
  // Pixi probes this for letter-spacing support; jsdom omits it along with canvas.
  ;(globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {}
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (text: string) => ({
      width: text.length * 6,
      actualBoundingBoxAscent: 9,
      actualBoundingBoxDescent: 3,
    }),
  })) as unknown as HTMLCanvasElement['getContext']
})

/** Pixi's queued draw instructions. Private, and exactly what's under test. */
function instructionsOf(graphics: Graphics): readonly Instruction[] {
  return (graphics.context as unknown as { instructions: Instruction[] }).instructions
}

type Layer = ReturnType<typeof createIndicatorLayer>

/**
 * The layer's three canvases, in the order it adds them: overlay lines, pane contents,
 * legend plate.
 *
 * Split out because only the first two are the chart. The legend draws a swatch for
 * **every** configured output, including one with no values in the current window — that
 * is correct and is the whole reason the legend exists, so a colour found there says
 * nothing about the bug.
 */
function canvases(layer: Layer): { chart: Graphics[]; overlays: Graphics } {
  const graphics = layer.container.children.filter(
    (child): child is Graphics => child instanceof Graphics
  )
  if (graphics.length !== 3) throw new Error(`expected 3 canvases, found ${graphics.length}`)
  return { chart: graphics.slice(0, 2), overlays: graphics[0]! }
}

/** Every instruction painted onto the chart itself. */
function painted(layer: Layer): Instruction[] {
  return canvases(layer).chart.flatMap((graphics) => [...instructionsOf(graphics)])
}

/**
 * Shared paths on the overlay canvas, which nothing but the output loop draws into.
 *
 * Worth checking there and only there: the pane canvas legitimately reuses one path
 * across a `fill` and a `stroke` — that's `drawPanel` outlining the plate it just filled,
 * the same Pixi behaviour used on purpose — so a bare "no path is shared" rule holds for
 * the overlays alone.
 */
function sharedPaths(layer: Layer): number {
  const paths = new Set<unknown>()
  let shared = 0
  for (const instruction of instructionsOf(canvases(layer).overlays)) {
    if (paths.has(instruction.data.path)) shared++
    paths.add(instruction.data.path)
  }
  return shared
}

const layout = computeLayout(1280, 720, 40, 1)

/** The colour given to whichever output has nothing to draw, so it can be looked for. */
const ABSENT = 0xd2a8ff
const PRESENT = 0xff4d4d

const overlay = (patch: Partial<OverlayLine>): OverlayLine => ({
  instanceId: 'i1',
  label: 'FAKE',
  output: 'out',
  colour: PRESENT,
  draw: 'line',
  units: [],
  ...patch,
})

const frameWith = (overlays: OverlayLine[], subPanes: SubPane[] = []): FrameState =>
  ({
    phase: 'playing',
    bars: [],
    bounds: { min: 0, max: 1 },
    barPhase: 0,
    currentBar: undefined,
    currentIndex: 3,
    firstIndex: 0,
    totalBars: 4,
    previousUnit: undefined,
    droppedBars: 0,
    hud: {} as FrameState['hud'],
    stopLines: [],
    events: [],
    overlays,
    subPanes,
  }) as FrameState

const layer = (): Layer => createIndicatorLayer({ theme: jollyTheme, palette: 'green-red' })

describe('an output with nothing in the window', () => {
  /**
   * The exact shape of the reported bug: a level line, then a sparse mark that happens to
   * have fired nowhere in this window.
   */
  const lineThenEmptyDots = [
    overlay({ output: 'retrace', draw: 'line', colour: PRESENT, units: [0.2, 0.4, 0.6, 0.8] }),
    overlay({ output: 'gapup', draw: 'dots', colour: ABSENT, units: [null, null, null, null] }),
  ]

  it('does not fill the previous output\'s line in its own colour', () => {
    const indicators = layer()
    indicators.draw(frameWith(lineThenEmptyDots), layout)

    expect(painted(indicators).filter((entry) => entry.data.style.color === ABSENT)).toEqual([])
    expect(sharedPaths(indicators)).toBe(0)
  })

  it('does not stroke the previous output\'s dots, which is the mirror case', () => {
    const indicators = layer()
    indicators.draw(
      frameWith([
        overlay({ output: 'breakout', draw: 'dots', colour: PRESENT, units: [0.5, null, 0.7, null] }),
        overlay({ output: 'stop', draw: 'line', colour: ABSENT, units: [null, null, null, null] }),
      ]),
      layout
    )

    expect(painted(indicators).filter((entry) => entry.data.style.color === ABSENT)).toEqual([])
    expect(sharedPaths(indicators)).toBe(0)
  })

  it('leaves a dashed neighbour alone too', () => {
    const indicators = layer()
    indicators.draw(
      frameWith([
        overlay({ output: 'retrace', draw: 'dash', colour: PRESENT, units: [0.2, 0.4, 0.6, 0.8] }),
        overlay({ output: 'stop', draw: 'dots', colour: ABSENT, units: [null, null, null, null] }),
      ]),
      layout
    )

    expect(painted(indicators).filter((entry) => entry.data.style.color === ABSENT)).toEqual([])
    expect(sharedPaths(indicators)).toBe(0)
  })

  it('still lets the outputs that do have values paint', () => {
    // The guard must not turn into a way to draw nothing at all.
    const indicators = layer()
    indicators.draw(frameWith(lineThenEmptyDots), layout)
    expect(
      painted(indicators).some(
        (entry) => entry.action === 'stroke' && entry.data.style.color === PRESENT
      )
    ).toBe(true)
  })

  it('holds inside a pane, where the same two loops run again', () => {
    const indicators = layer()
    indicators.draw(
      frameWith(
        [],
        [
          {
            instanceId: 'i1',
            title: 'FAKE',
            series: [
              { output: 'level', colour: PRESENT, draw: 'line', units: [0.2, 0.4, 0.6] },
              { output: 'mark', colour: ABSENT, draw: 'dots', units: [null, null, null] },
            ],
            min: 0,
            max: 1,
            histogram: false,
          },
        ]
      ),
      layout
    )

    expect(painted(indicators).filter((entry) => entry.data.style.color === ABSENT)).toEqual([])
  })
})
