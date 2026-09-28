/**
 * Which side of each stitch faces the viewer, seen from the pattern's right side.
 *
 * Rows are the chart's (0 at the top) and are worked bottom row first, as a new pattern
 * is (PATTERN_DEFAULTS.bottom_up). The first row worked faces the right side.
 *
 * - `turned`: worked flat, turning at each row end. Every other row is worked with the
 *   wrong side towards the crocheter, so the right side shows those stitches' backs.
 * - `rs`: the right side always faces the crocheter: worked in rounds, or with the yarn
 *   cut at each row end. Every stitch shows its front.
 *
 * Working into one loop leaves the other loop of the stitch below lying across the
 * fabric as a ridge. Back loop only leaves the loop nearer the crocheter, so the ridge is
 * on the side they faced; front loop only leaves the far one, so it's on the other side.
 * The first row is worked into a foundation chain, so it has no ridge.
 *
 * C2C is worked in diagonal rows, turning at the end of each, and each tile's stitches
 * grow out of the side of a tile in the diagonal before (their ch-3 space), so tiles of
 * neighbouring diagonals lie at right angles and show opposite sides. Derived from how a
 * tile is made (README.md), not measured from a photograph.
 */
import type { StitchId } from './catalogue.ts'

export type Mode = 'turned' | 'rs'
export type Face = 'front' | 'back'

export interface CellLook {
  readonly face: Face
  /** The loop of the stitch below lies across this stitch's foot, on the right side. */
  readonly ridge: boolean
  /** The stitch's posts run across rather than up (C2C tiles). */
  readonly across: boolean
  /** Lean of the stitch, as a fraction of its width over its height (waistcoat in turned
   *  rows). */
  readonly lean: number
}

/** Rows worked before chart row r. */
export const workedIndex = (rows: number, r: number) => rows - 1 - r

export function cellLook(id: StitchId, mode: Mode, rows: number, r: number, c: number): CellLook {
  if (id === 'c2c') {
    const odd = (r + c) % 2 === 1
    return { face: odd ? 'back' : 'front', ridge: false, across: odd, lean: 0 }
  }
  const k = workedIndex(rows, r)
  const facingRight = mode === 'rs' || k % 2 === 0
  const face: Face = facingRight ? 'front' : 'back'
  const ridge = k > 0 && ((id === 'sc-blo' && facingRight) || (id === 'sc-flo' && !facingRight))
  // Waistcoat stitches stack straight when every row faces the same way, and slant,
  // alternately, in turned rows (hearthookhome.com, README.md).
  const lean = id === 'waistcoat' && mode === 'turned' ? (k % 2 === 0 ? 0.12 : -0.12) : 0
  return { face, ridge, across: false, lean }
}
