import type { Character } from './types.js'

/**
 * The starter roster, rendered as geometric silhouettes per the committed art
 * direction — these read as distinct *shapes*, not as illustrated characters.
 *
 * Character choice is **purely cosmetic**: identical hitbox, physics, and bounce
 * cadence, so it never affects gameplay or scoring. That keeps the trading-skill
 * signal clean — self-expression, not a difficulty lever.
 */

export const robin: Character = {
  id: 'robin',
  displayName: 'Robin',
  // A nod to the Flappy Bird lineage, and the most legible silhouette for the
  // genre — which is why it's the default.
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0, width: 1, height: 0.88, slot: 'body' },
    { shape: 'arc', dx: -0.32, dy: 0.05, width: 0.62, height: 0.42, slot: 'accent', flaps: true },
    { shape: 'triangle', dx: 0.86, dy: 0.04, width: 0.4, height: 0.26, slot: 'accent', rotation: 0 },
    { shape: 'ellipse', dx: 0.34, dy: -0.22, width: 0.2, height: 0.2, slot: 'detail' },
  ],
  motion: { flapAmplitude: 0.9, flapPhaseOffset: 0, squashFactor: 0.14, tiltResponse: 0.22 },
  palette: { body: 0xf2c14e, accent: 0xe08b2f, detail: 0x2b2410 },
}

export const bull: Character = {
  id: 'bull',
  displayName: 'Bull',
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0.05, width: 1.05, height: 0.8, slot: 'body' },
    { shape: 'triangle', dx: 0.52, dy: -0.6, width: 0.4, height: 0.5, slot: 'accent', rotation: -0.5 },
    { shape: 'triangle', dx: 0.1, dy: -0.66, width: 0.34, height: 0.46, slot: 'accent', rotation: -0.2 },
    { shape: 'ellipse', dx: 0.4, dy: -0.16, width: 0.18, height: 0.18, slot: 'detail' },
  ],
  // Head dips on each bounce: a heavier tilt response rather than new animation.
  motion: { flapAmplitude: 0.28, flapPhaseOffset: 0.4, squashFactor: 0.1, tiltResponse: 0.4 },
  palette: { body: 0x4ddb7a, accent: 0x2f9a55, detail: 0x10240f },
}

export const bear: Character = {
  id: 'bear',
  displayName: 'Bear',
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0.02, width: 1.12, height: 0.98, slot: 'body' },
    { shape: 'ellipse', dx: -0.42, dy: -0.6, width: 0.32, height: 0.32, slot: 'accent' },
    { shape: 'ellipse', dx: 0.42, dy: -0.6, width: 0.32, height: 0.32, slot: 'accent' },
    { shape: 'ellipse', dx: 0.36, dy: -0.1, width: 0.2, height: 0.2, slot: 'detail' },
  ],
  // Weightier squash, so it lands differently from Robin without new code.
  motion: { flapAmplitude: 0.2, flapPhaseOffset: 0.7, squashFactor: 0.22, tiltResponse: 0.16 },
  palette: { body: 0xff6b6b, accent: 0xc44a4a, detail: 0x2b1010 },
}

export const characters: readonly Character[] = [robin, bull, bear]

export function character(id: string): Character {
  return characters.find((entry) => entry.id === id) ?? robin
}
