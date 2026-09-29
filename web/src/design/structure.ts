/**
 * The structural panel's geometry, as pure functions (§9): what a border would do, drawn
 * before it is applied, and what needs asking first.
 *
 * Previews are drawn in the frame of the pattern being edited: a border that adds cells
 * grows the preview outwards, one that removes them shows the cells going, hatched.
 * Setting a size is a border too (what `pad_to_size` does, and cropping as well): the
 * four sides are what's kept, and the size is worked out from them.
 */
import { EditError, MAX_SIDE, addBorder, type Border } from '../logic/edit.ts'
import type { Pattern } from '../model/types.ts'

/** Half-open, in cells: rows [r0, r1) × columns [c0, c1). */
export interface Rect {
  readonly r0: number
  readonly c0: number
  readonly r1: number
  readonly c1: number
}

export interface Preview {
  /** What the canvas shows instead of the pattern. */
  readonly pattern: Pattern
  /** Cells that the edit removes (drawn hatched). */
  readonly removed: readonly Rect[]
  /** The outline drawn over the preview: the result's edges, or the artwork's place. */
  readonly outline: Rect | null
}

export interface Sides {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export const NO_SIDES: Sides = { top: 0, right: 0, bottom: 0, left: 0 }

const isZero = (s: Sides) => s.top === 0 && s.right === 0 && s.bottom === 0 && s.left === 0

/** A pattern-shaped value with other cells, for drawing only. Row ids are left blank. */
function shown(p: Pattern, rows: number, cols: number, cells: Uint16Array): Pattern {
  return { ...p, rows, cols, cells, row_ids: new Array<string>(rows).fill('') }
}

/** The rows and columns of `p` that a border with these sides keeps, before anything is
 *  added: rows [r0, r1) × cols [c0, c1). Empty (r1 ≤ r0 or c1 ≤ c0) when it keeps none. */
export function keptRect(p: Pattern, s: Sides): Rect {
  const cut = (n: number) => Math.max(0, -n)
  return {
    r0: Math.min(p.rows, cut(s.top)),
    r1: Math.max(0, p.rows - cut(s.bottom)),
    c0: Math.min(p.cols, cut(s.left)),
    c1: Math.max(0, p.cols - cut(s.right)),
  }
}

/** The values of the cells a border with these sides removes. */
function removedValues(p: Pattern, s: Sides): Set<number> {
  const k = keptRect(p, s)
  const out = new Set<number>()
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      if (r >= k.r0 && r < k.r1 && c >= k.c0 && c < k.c1) continue
      out.add(p.cells[r * p.cols + c]!)
    }
  }
  return out
}

/** How many cells a border with these sides removes. */
export function removedCount(p: Pattern, s: Sides): number {
  const k = keptRect(p, s)
  return p.rows * p.cols - Math.max(0, k.r1 - k.r0) * Math.max(0, k.c1 - k.c0)
}

/** Whether a border would destroy cells that aren't all one colour (§9: "with
 *  confirmation when non-uniform cells would be destroyed"). */
export function removesArtwork(p: Pattern, s: Sides): boolean {
  return removedValues(p, s).size > 1
}

/** The border's result, or the reason it can't be made (the Python's message). */
export function tryBorder(p: Pattern, s: Sides, paletteIndex: number): Pattern | EditError {
  try {
    return addBorder(p, { ...s, paletteIndex } satisfies Border)
  } catch (e) {
    if (e instanceof EditError) return e
    throw e
  }
}

/**
 * What the canvas shows while a border is being set up: the pattern grown by whatever
 * is added, in the border colour, with whatever is removed still there but marked, and
 * the result's edges outlined (or, when nothing is removed, the pattern's place in it). Null when there is nothing to show (all sides zero), and
 * for the degenerate case where removal runs past the far edge, the result alone.
 */
export function borderPreview(p: Pattern, s: Sides, paletteIndex: number): Preview | null {
  if (isZero(s)) return null
  const result = tryBorder(p, s, paletteIndex)
  const k = keptRect(p, s)
  if (k.r1 <= k.r0 || k.c1 <= k.c0) {
    return result instanceof EditError ? { pattern: p, removed: [{ r0: 0, c0: 0, r1: p.rows, c1: p.cols }], outline: null } : { pattern: result, removed: [], outline: null }
  }
  // The union of the pattern and the result, in cells; (oy, ox) is where the pattern's
  // top-left lands in it.
  const oy = Math.max(0, s.top)
  const ox = Math.max(0, s.left)
  const rows = oy + p.rows + Math.max(0, s.bottom)
  const cols = ox + p.cols + Math.max(0, s.right)
  const cells = new Uint16Array(rows * cols).fill(paletteIndex)
  for (let r = 0; r < p.rows; r++) cells.set(p.cells.subarray(r * p.cols, (r + 1) * p.cols), (r + oy) * cols + ox)
  // The result: the kept part of the pattern, grown by what is added.
  const out: Rect = {
    r0: oy + k.r0 - Math.max(0, s.top),
    r1: oy + k.r1 + Math.max(0, s.bottom),
    c0: ox + k.c0 - Math.max(0, s.left),
    c1: ox + k.c1 + Math.max(0, s.right),
  }
  const removed: Rect[] = []
  const P: Rect = { r0: oy, r1: oy + p.rows, c0: ox, c1: ox + p.cols }
  if (out.r0 > P.r0) removed.push({ r0: P.r0, r1: out.r0, c0: P.c0, c1: P.c1 })
  if (out.r1 < P.r1) removed.push({ r0: out.r1, r1: P.r1, c0: P.c0, c1: P.c1 })
  const mr0 = Math.max(P.r0, out.r0)
  const mr1 = Math.min(P.r1, out.r1)
  if (out.c0 > P.c0) removed.push({ r0: mr0, r1: mr1, c0: P.c0, c1: out.c0 })
  if (out.c1 < P.c1) removed.push({ r0: mr0, r1: mr1, c0: out.c1, c1: P.c1 })
  // Only added: the result is the whole preview, so the outline shows where the pattern
  // sits in it (the part dragged to move it).
  return { pattern: shown(p, rows, cols, cells), removed, outline: removed.length ? out : P }
}

// --- the size, and moving the pattern within it ----------------------------------------------

/** The largest a border may make either side: the desktop's pad-to-size spin boxes stop
 *  at 2000 (design_window.py). */
export const MAX_BORDERED = 2000

/** The size a border with these sides gives, whether or not it can be made. */
export function sizeWith(p: Pick<Pattern, 'cols' | 'rows'>, s: Sides): { width: number; height: number } {
  return { width: p.cols + s.left + s.right, height: p.rows + s.top + s.bottom }
}

/** Share `change` cells between two opposite sides: half each, the odd one going to the
 *  second (right, or bottom). From nothing, that centres as `pad_to_size` does. */
function share(a: number, b: number, change: number): [number, number] {
  const half = Math.floor(change / 2)
  return [a + half, b + change - half]
}

/**
 * The sides that give this size, from the sides it started from: the change is shared
 * between the two opposite sides, so the pattern stays where it was. A size left null
 * keeps that axis as it was.
 */
export function resizeSides(p: Pick<Pattern, 'cols' | 'rows'>, from: Sides, width: number | null, height: number | null): Sides {
  const was = sizeWith(p, from)
  const [left, right] = width === null ? [from.left, from.right] : share(from.left, from.right, width - was.width)
  const [top, bottom] = height === null ? [from.top, from.bottom] : share(from.top, from.bottom, height - was.height)
  return { top, right, bottom, left }
}

/** The same size, with the pattern centred in it. */
export function centreSides(s: Sides): Sides {
  const [left, right] = share(0, 0, s.left + s.right)
  const [top, bottom] = share(0, 0, s.top + s.bottom)
  return { top, right, bottom, left }
}

/**
 * The pattern dragged by (dr, dc) cells from where it was picked up: what one side gains
 * the other loses, so the size stays. It stops at an edge: where cells are only added it
 * never starts removing any, and where they are only removed it never adds (nor does it
 * jump from where it started).
 */
export function shiftSides(from: Sides, dr: number, dc: number): Sides {
  const along = (a: number, b: number, d: number): [number, number] => {
    const total = a + b
    const moved = Math.max(Math.min(0, total, a), Math.min(Math.max(0, total, a), a + d))
    return [moved, total - moved]
  }
  const [left, right] = along(from.left, from.right, dc)
  const [top, bottom] = along(from.top, from.bottom, dr)
  return { top, right, bottom, left }
}

// --- scale --------------------------------------------------------------------------------------------

export const SCALE_MIN = 2
export const SCALE_MAX = 12

/** The size a scale gives, and whether it passes what the import screen allows. */
export function scaledSize(p: Pick<Pattern, 'cols' | 'rows'>, factor: number): { cols: number; rows: number; large: boolean } {
  const cols = p.cols * factor
  const rows = p.rows * factor
  return { cols, rows, large: cols > MAX_SIDE || rows > MAX_SIDE }
}
