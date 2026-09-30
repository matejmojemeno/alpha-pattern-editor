/**
 * The Select tool's pieces, as pure functions: rectangles of cells, the block of cells a
 * selection holds, turning a block, and the clipboard.
 *
 * A block is palette indices, as the pattern holds them. On the clipboard it also keeps
 * the colours those indices named, so pasting into another pattern finds the same
 * colours there (or adds them) rather than taking whatever sits at the same index.
 */
import { addPaletteEntry, type Block } from '../logic/edit.ts'
import type { Pattern } from '../model/types.ts'
import type { CellRect } from '../render/design.ts'

export type { Block, CellRect }

/** The rectangle between two corner cells, both included, given either way round. */
export function rectBetween(a: { r: number; c: number }, b: { r: number; c: number }): CellRect {
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r) + 1, c1: Math.max(a.c, b.c) + 1 }
}

export const rectRows = (r: CellRect) => r.r1 - r.r0
export const rectCols = (r: CellRect) => r.c1 - r.c0

export function containsCell(r: CellRect, cell: { r: number; c: number }): boolean {
  return cell.r >= r.r0 && cell.r < r.r1 && cell.c >= r.c0 && cell.c < r.c1
}

export function moveRect(r: CellRect, dr: number, dc: number): CellRect {
  return { r0: r.r0 + dr, c0: r.c0 + dc, r1: r.r1 + dr, c1: r.c1 + dc }
}

/** The part of `r` over a rows × cols chart, or null if none of it is. */
export function clipRect(r: CellRect, rows: number, cols: number): CellRect | null {
  const out = { r0: Math.max(0, r.r0), c0: Math.max(0, r.c0), r1: Math.min(rows, r.r1), c1: Math.min(cols, r.c1) }
  return out.r1 > out.r0 && out.c1 > out.c0 ? out : null
}

export const sameRect = (a: CellRect | null | undefined, b: CellRect | null | undefined) =>
  a === b || (!!a && !!b && a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1)

// --- blocks --------------------------------------------------------------------------------

/** The cells of `r` (which must lie on the chart), as a block. */
export function readBlock(p: Pattern, r: CellRect): Block {
  const rows = rectRows(r)
  const cols = rectCols(r)
  const cells = new Uint16Array(rows * cols)
  for (let y = 0; y < rows; y++) cells.set(p.cells.subarray((r.r0 + y) * p.cols + r.c0, (r.r0 + y) * p.cols + r.c1), y * cols)
  return { rows, cols, cells }
}

export type Turn = 'mirror' | 'flip' | 'cw' | 'ccw'

/**
 * A block mirrored left to right, flipped top to bottom, or turned a quarter clockwise
 * or anticlockwise, as `mirror_h`, `mirror_v` and `rotate_90` turn a whole pattern (seen
 * with row 0 at the top): clockwise new[i][j] = old[R-1-j][i], anticlockwise
 * new[i][j] = old[j][C-1-i].
 */
export function turnBlock(b: Block, how: Turn): Block {
  const { rows: R, cols: C, cells } = b
  const quarter = how === 'cw' || how === 'ccw'
  const rows = quarter ? C : R
  const cols = quarter ? R : C
  const out = new Uint16Array(R * C)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const [y, x] =
        how === 'mirror' ? [i, C - 1 - j] : how === 'flip' ? [R - 1 - i, j] : how === 'cw' ? [R - 1 - j, i] : [j, C - 1 - i]
      out[i * cols + j] = cells[y * C + x]!
    }
  }
  return { rows, cols, cells: out }
}

/** Where a turned block goes: a mirror or a flip stays put; a quarter turn keeps the
 *  centre where it was (the odd half cell going up and left). */
export function turnRect(r: CellRect, how: Turn): CellRect {
  if (how === 'mirror' || how === 'flip') return r
  const h = rectRows(r)
  const w = rectCols(r)
  const r0 = r.r0 + Math.floor((h - w) / 2)
  const c0 = r.c0 + Math.floor((w - h) / 2)
  return { r0, c0, r1: r0 + w, c1: c0 + h }
}

// --- the clipboard ---------------------------------------------------------------------------

/** What Copy and Cut keep: a block, the colours its indices named, and where it was. */
export interface Clip {
  readonly block: Block
  /** The source pattern's palette, as it was: index i of the block names entry i. */
  readonly colours: readonly { readonly id: string; readonly hex: string; readonly name: string }[]
  /** Where its top-left cell was: a paste with nowhere better to go goes there. */
  readonly r0: number
  readonly c0: number
}

export function clipOf(p: Pattern, block: Block, at: { r0: number; c0: number }): Clip {
  return { block, colours: p.palette.map(({ id, hex, name }) => ({ id, hex, name })), r0: at.r0, c0: at.c0 }
}

/**
 * The clip's block in `p`'s own indices, and `p` with any colour it lacked added. Each
 * colour is found by its id with the same hex (the same pattern, or a copy of it), then
 * by its hex; a colour `p` doesn't have is added under its name, so nothing pasted
 * changes colour. Values that named no colour (skip cells) stay as they are.
 */
export function mapClip(p: Pattern, clip: Clip): { pattern: Pattern; block: Block } {
  let pattern = p
  const used = new Set<number>()
  for (const v of clip.block.cells) if (v < clip.colours.length) used.add(v)
  const to = new Map<number, number>()
  for (const i of [...used].sort((a, b) => a - b)) {
    const { id, hex, name } = clip.colours[i]!
    let at = pattern.palette.findIndex((e) => e.id === id && e.hex === hex)
    if (at < 0) at = pattern.palette.findIndex((e) => e.hex === hex)
    if (at < 0) {
      pattern = addPaletteEntry(pattern, hex, name)
      at = pattern.palette.length - 1
    }
    to.set(i, at)
  }
  const cells = clip.block.cells.map((v) => to.get(v) ?? v)
  return { pattern, block: { rows: clip.block.rows, cols: clip.block.cols, cells } }
}

