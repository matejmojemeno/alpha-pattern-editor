/**
 * Each stitch as strands of yarn, in a cell one unit wide and one unit tall (y down),
 * spilling a little past it where loops meet the neighbours. The renderer scales x by the
 * stitch's width and y by its height, and a strand's radius by the width, since the yarn
 * is as thick in a tall stitch as in a short one.
 *
 * Drawn from how each stitch is made, not traced from a photograph:
 * - Every stitch ends with its top loops: a chain lying across the top, which the next
 *   row's stitches are worked into. From either side, one of its two loops lies across
 *   the top (`over`: drawn over the foot of the stitch above).
 * - Single crochet: from the front, its two legs make a V; from the back, a horizontal
 *   bar crosses the post.
 * - Half double: taller legs, the wrap of its yarn over slanting across them; from the
 *   back, the "third loop" lies as a bar just under the top.
 * - Double: two long legs with a wrap across the middle, and gaps between neighbours.
 * - Waistcoat: worked through the middle of the stitch below, so its legs make a full-
 *   height V, like knitting; from the back, a bump like purl.
 * - C2C: a tile of three double crochets side by side, with the ch-3 up one side.
 * - A ridge (back or front loop only): the unworked loop of the stitch below, across this
 *   stitch's foot, in the colour of the row below.
 * - A carried strand lies along the top of the row below, inside the foot of the stitches
 *   worked over it; it shows where the stitches leave gaps.
 */
import type { StitchId } from './catalogue.ts'
import type { CellLook } from './faces.ts'

export type Part = 'body' | 'over' | 'ridge'
export type Pt = readonly [number, number]

export interface Strand {
  /** Points the yarn passes through, smoothed by the rasteriser. */
  readonly pts: readonly Pt[]
  /** Radius, as a fraction of the stitch's width. */
  readonly r: number
  readonly part: Part
}

const s = (part: Part, r: number, ...pts: Pt[]): Strand => ({ pts, r, part })

/** The top loop across the top of a stitch. */
const top = (y = 0.07, r = 0.11) => s('over', r, [-0.06, y + 0.05], [0.25, y], [0.5, y - 0.01], [0.75, y], [1.06, y + 0.05])

function front(id: StitchId): Strand[] {
  switch (id) {
    case 'sc':
    case 'sc-blo':
    case 'sc-flo':
      return [
        s('body', 0.2, [0.12, 0.2], [0.3, 0.6], [0.5, 1.0]),
        s('body', 0.2, [0.88, 0.2], [0.7, 0.6], [0.5, 1.0]),
        top(0.1, 0.15),
      ]
    case 'hdc':
      return [
        s('body', 0.17, [0.27, 0.14], [0.35, 0.55], [0.44, 0.99]),
        s('body', 0.17, [0.73, 0.14], [0.65, 0.55], [0.56, 0.99]),
        s('body', 0.15, [0.12, 0.68], [0.5, 0.54], [0.88, 0.4]),
        top(0.07, 0.13),
      ]
    case 'dc':
      return [
        s('body', 0.17, [0.29, 0.08], [0.33, 0.55], [0.4, 0.99]),
        s('body', 0.17, [0.71, 0.08], [0.67, 0.55], [0.6, 0.99]),
        s('body', 0.15, [0.14, 0.62], [0.5, 0.49], [0.86, 0.36]),
        top(0.05, 0.13),
      ]
    case 'waistcoat':
      return [
        s('body', 0.22, [0.06, 0.0], [0.28, 0.5], [0.5, 1.0]),
        s('body', 0.22, [0.94, 0.0], [0.72, 0.5], [0.5, 1.0]),
      ]
    case 'c2c':
      return tile(false)
  }
}

function back(id: StitchId): Strand[] {
  switch (id) {
    case 'sc':
    case 'sc-blo':
    case 'sc-flo':
      return [
        s('body', 0.18, [0.24, 0.4], [0.38, 0.72], [0.5, 1.0]),
        s('body', 0.18, [0.76, 0.4], [0.62, 0.72], [0.5, 1.0]),
        s('body', 0.19, [-0.05, 0.5], [0.25, 0.4], [0.5, 0.38], [0.75, 0.4], [1.05, 0.5]),
        top(0.1, 0.13),
      ]
    case 'hdc':
      return [
        s('body', 0.14, [0.12, 0.42], [0.5, 0.55], [0.88, 0.68]),
        s('body', 0.17, [0.27, 0.3], [0.35, 0.62], [0.44, 0.99]),
        s('body', 0.17, [0.73, 0.3], [0.65, 0.62], [0.56, 0.99]),
        s('body', 0.18, [-0.05, 0.27], [0.25, 0.2], [0.5, 0.19], [0.75, 0.2], [1.05, 0.27]),
        top(0.06, 0.12),
      ]
    case 'dc':
      return [
        s('body', 0.14, [0.14, 0.36], [0.5, 0.49], [0.86, 0.62]),
        s('body', 0.17, [0.29, 0.16], [0.33, 0.58], [0.4, 0.99]),
        s('body', 0.17, [0.71, 0.16], [0.67, 0.58], [0.6, 0.99]),
        s('body', 0.14, [-0.03, 0.17], [0.5, 0.13], [1.03, 0.17]),
        top(0.05, 0.12),
      ]
    case 'waistcoat':
      return [
        s('body', 0.18, [0.16, 0.1], [0.34, 0.6], [0.5, 1.0]),
        s('body', 0.18, [0.84, 0.1], [0.66, 0.6], [0.5, 1.0]),
        s('body', 0.22, [-0.05, 0.55], [0.25, 0.44], [0.5, 0.41], [0.75, 0.44], [1.05, 0.55]),
      ]
    case 'c2c':
      return tile(true)
  }
}

/** A C2C tile: three double crochets, the ch-3 up the left side, the top loops across. */
function tile(back: boolean): Strand[] {
  const out: Strand[] = []
  // The ch-3: three links up the side.
  for (let i = 0; i < 3; i++) {
    const y = 0.14 + i * 0.28
    out.push(s('body', 0.07, [0.06, y], [0.1, y + 0.12], [0.06, y + 0.24]))
  }
  for (const x of [0.3, 0.54, 0.78]) {
    const wrap: Strand = back
      ? s('body', 0.075, [x - 0.11, 0.4], [x + 0.11, 0.56])
      : s('body', 0.075, [x - 0.11, 0.6], [x + 0.11, 0.44])
    if (back) out.push(wrap)
    out.push(s('body', 0.1, [x - 0.02, 0.1], [x, 0.55], [x + 0.02, 0.97]))
    if (!back) out.push(wrap)
  }
  out.push(s('over', 0.075, [0.0, 0.07], [0.5, 0.05], [1.0, 0.07]))
  return out
}

const RIDGE = (): Strand => s('ridge', 0.17, [-0.06, 0.97], [0.25, 1.04], [0.5, 1.05], [0.75, 1.04], [1.06, 0.97])

/** The strand a carried colour makes inside a stitch's foot; `slot` stacks several. */
export function carriedStrand(slot: number): Strand {
  const y = 0.9 - slot * 0.09
  return s('body', 0.1, [-0.06, y], [0.5, y - 0.02], [1.06, y])
}

/** A small, repeatable pseudo-random sequence, so each variant looks the same every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a ^= a << 13
    a ^= a >>> 17
    a ^= a << 5
    return (a >>> 0) / 0x1_0000_0000
  }
}

/** How many slightly different versions of each stitch there are. */
export const VARIANTS = 4

/**
 * A stitch's strands as seen: its face, turned across (the posts running sideways, for
 * C2C), leaning, with the ridge of the stitch below across its foot when it has one, and
 * nudged a little by `variant` so a field of one colour doesn't look stamped.
 */
export function stitchStrands(id: StitchId, look: CellLook, variant: number): Strand[] {
  const strands = [...(look.face === 'front' ? front(id) : back(id))]
  if (look.ridge) strands.push(RIDGE())
  const rand = rng(0x9e37 + variant * 7919)
  const j = variant === 0 ? 0 : 0.028
  return strands.map((st) => ({
    part: st.part,
    r: st.r * (1 + (rand() - 0.5) * 2 * (j ? 0.06 : 0)),
    pts: st.pts.map(([x0, y0]) => {
      let x = x0 + (rand() - 0.5) * 2 * j
      let y = y0 + (rand() - 0.5) * 2 * j
      x += look.lean * (0.5 - y)
      if (look.across) [x, y] = [1 - y, x]
      return [x, y] as const
    }),
  }))
}
