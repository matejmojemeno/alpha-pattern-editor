/**
 * The nearest shade of a library to a colour: the smallest CIE76 ΔE (Euclidean distance
 * in CIELAB), as detection names colours from DMC (`_nearest_dmc` in
 * alphareader/core/detect/palette.py). fixtures/yarn_nearest.json proves the two agree.
 */
import { hexToLab, type Lab } from '../logic/lab.ts'
import type { Library, Shade } from './libraries.ts'

export interface Matcher {
  readonly library: Library
  /** Each shade's Lab, converted once. */
  readonly labs: readonly Lab[]
}

export interface Match {
  readonly shade: Shade
  readonly index: number
  readonly deltaE: number
}

export const matcher = (library: Library): Matcher => ({ library, labs: library.shades.map((s) => hexToLab(s.hex)) })

/**
 * The first shade at the smallest distance, as np.argmin picks it. The distance is the
 * plain square root of the sum of squares, as np.linalg.norm computes it, rather than
 * Math.hypot, which scales its arguments and can round differently in the last bit.
 */
export function nearestShade(m: Matcher, hex: string): Match {
  const [l, a, b] = hexToLab(hex)
  let best = -1
  let bestD = Infinity
  m.labs.forEach(([sl, sa, sb], i) => {
    const d = Math.sqrt((sl - l) ** 2 + (sa - a) ** 2 + (sb - b) ** 2)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  if (best < 0) throw new RangeError(`Library ${m.library.id} has no shades`)
  return { shade: m.library.shades[best]!, index: best, deltaE: bestD }
}
