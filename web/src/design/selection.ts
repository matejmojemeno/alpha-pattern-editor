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
 *  centre within half a cell. The odd half cell must round so that the next quarter turn
 *  takes it back, making four turns, or a turn and its reverse, leave the block exactly
 *  where it was (rounding down both times crept up and left a cell every two turns). So
 *  each shift is the opposite of the one that undoes it: a wide block turned grows
 *  upward and keeps its left edge; a tall one turned keeps its bottom row and grows
 *  to the right. */
export function turnRect(r: CellRect, how: Turn): CellRect {
  if (how === 'mirror' || how === 'flip') return r
  const h = rectRows(r)
  const w = rectCols(r)
  const r0 = r.r0 + Math.sign(h - w) * Math.ceil(Math.abs(h - w) / 2)
  const c0 = r.c0 + Math.trunc((w - h) / 2)
  return { r0, c0, r1: r0 + w, c1: c0 + h }
}

// --- see-through cells (Remove background) -----------------------------------------------------

/**
 * Which of a block's cells are its background, as a mask the block's shape (1 =
 * see-through), or null if the block is empty. The background is the colour most of the
 * block's edge is (as `major_border_index` takes a pattern's), and only the cells of it
 * joined to the edge, side by side, go: a motif keeps that colour inside it, such as the
 * white of an eye.
 */
export function backgroundMask(b: Block): Uint8Array | null {
  const { rows: R, cols: C, cells } = b
  if (R === 0 || C === 0) return null
  const edge: number[] = []
  for (let i = 0; i < R * C; i++) {
    const y = Math.floor(i / C)
    const x = i % C
    if (y === 0 || x === 0 || y === R - 1 || x === C - 1) edge.push(i)
  }
  const counts = new Map<number, number>()
  for (const i of edge) counts.set(cells[i]!, (counts.get(cells[i]!) ?? 0) + 1)
  let bg = -1
  let most = -1
  for (const [v, n] of counts) if (n > most || (n === most && v < bg)) [bg, most] = [v, n]
  const mask = new Uint8Array(R * C)
  const todo = edge.filter((i) => cells[i] === bg)
  for (const i of todo) mask[i] = 1
  while (todo.length > 0) {
    const i = todo.pop()!
    const y = Math.floor(i / C)
    const x = i % C
    for (const [ny, nx] of [
      [y - 1, x],
      [y + 1, x],
      [y, x - 1],
      [y, x + 1],
    ] as const) {
      const j = ny * C + nx
      if (ny >= 0 && ny < R && nx >= 0 && nx < C && !mask[j] && cells[j] === bg) {
        mask[j] = 1
        todo.push(j)
      }
    }
  }
  return mask
}

/**
 * Select object: the object at a cell, as the rectangle round it and a see-through mask
 * over that rectangle, or null on the background. The object is every cell that isn't
 * the background joined to this one, corners included (a tail drawn as a diagonal
 * staircase is one piece), whatever its colours, plus whatever it encloses (the eyes of
 * a cat, a letter inside a ring). What else lies in its rectangle (a neighbour's paw) is
 * see-through, so it isn't part of it.
 */
export function objectAt(p: Pattern, cell: { r: number; c: number }, background: number): { rect: CellRect; clear: Uint8Array } | null {
  const { rows: R, cols: C, cells } = p
  const start = cell.r * C + cell.c
  if (cells[start] === background) return null
  const inObject = new Uint8Array(R * C)
  inObject[start] = 1
  const todo = [start]
  let r0 = cell.r
  let r1 = cell.r
  let c0 = cell.c
  let c1 = cell.c
  while (todo.length > 0) {
    const i = todo.pop()!
    const y = Math.floor(i / C)
    const x = i % C
    r0 = Math.min(r0, y)
    r1 = Math.max(r1, y)
    c0 = Math.min(c0, x)
    c1 = Math.max(c1, x)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy
        const nx = x + dx
        const j = ny * C + nx
        if (ny >= 0 && ny < R && nx >= 0 && nx < C && !inObject[j] && cells[j] !== background) {
          inObject[j] = 1
          todo.push(j)
        }
      }
    }
  }
  // Outside: what can be reached from the rectangle's edge without crossing the object,
  // side by side only (an object joined corner to corner still walls it in).
  const h = r1 - r0 + 1
  const w = c1 - c0 + 1
  const clear = new Uint8Array(h * w)
  const open = (y: number, x: number) => !inObject[(r0 + y) * C + c0 + x] && !clear[y * w + x]
  const out: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((y === 0 || x === 0 || y === h - 1 || x === w - 1) && open(y, x)) {
        clear[y * w + x] = 1
        out.push(y * w + x)
      }
    }
  }
  while (out.length > 0) {
    const i = out.pop()!
    const y = Math.floor(i / w)
    const x = i % w
    for (const [ny, nx] of [
      [y - 1, x],
      [y + 1, x],
      [y, x - 1],
      [y, x + 1],
    ] as const) {
      if (ny >= 0 && ny < h && nx >= 0 && nx < w && open(ny, nx)) {
        clear[ny * w + nx] = 1
        out.push(ny * w + nx)
      }
    }
  }
  return { rect: { r0, c0, r1: r1 + 1, c1: c1 + 1 }, clear }
}

/** A see-through mask turned as `turnBlock` turns its block. */
export function turnMask(mask: Uint8Array, rows: number, cols: number, how: Turn): Uint8Array {
  return Uint8Array.from(turnBlock({ rows, cols, cells: Uint16Array.from(mask) }, how).cells)
}

/** The block to write at (r0, c0) over `under`: its see-through cells take what `under`
 *  has there, so `paste_block` leaves those cells as they were. Cells off the chart are
 *  left alone (`paste_block` clips them). */
export function seeThrough(b: Block, clear: Uint8Array | null, under: Pattern, r0: number, c0: number): Block {
  if (!clear) return b
  const cells = b.cells.slice()
  for (let y = 0; y < b.rows; y++) {
    const py = r0 + y
    if (py < 0 || py >= under.rows) continue
    for (let x = 0; x < b.cols; x++) {
      const px = c0 + x
      if (clear[y * b.cols + x] && px >= 0 && px < under.cols) cells[y * b.cols + x] = under.cells[py * under.cols + px]!
    }
  }
  return { rows: b.rows, cols: b.cols, cells }
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
  /** Its see-through cells, when its background was removed. */
  readonly clear?: Uint8Array | null
}

export function clipOf(p: Pattern, block: Block, at: { r0: number; c0: number }, clear: Uint8Array | null = null): Clip {
  return { block, colours: p.palette.map(({ id, hex, name }) => ({ id, hex, name })), r0: at.r0, c0: at.c0, clear }
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

