/**
 * sRGB → CIELAB (D65), a port of `srgb_to_lab` in alphareader/core/detect/palette.py.
 * Used to find the perceptually nearest colour (edit.ts, `nearestEntryId`).
 */
import { hexToRgb } from '../theme/contrast.ts'

export type Lab = readonly [l: number, a: number, b: number]

const M = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
] as const
const WHITE = [0.95047, 1.0, 1.08883] as const
const EPS = 216 / 24389
const KAPPA = 24389 / 27

const linear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function rgbToLab(rgb: readonly [number, number, number]): Lab {
  const lin = rgb.map(linear)
  const f = M.map((row, i) => {
    const t = (row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!) / WHITE[i]!
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116
  })
  const [fx, fy, fz] = f as [number, number, number]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex))

export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
