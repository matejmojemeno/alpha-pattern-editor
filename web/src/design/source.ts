/**
 * "From another pattern": picking part of another pattern to bring into the one being
 * designed, as pure functions (ui/design/FromPatternPanel.tsx is the panel).
 *
 * The other pattern is only read: what is picked becomes a clipboard clip
 * (design/selection.ts `Clip`), and bringing it in is the Select tool's paste, so its
 * colours are found or added (`mapClip`), a shape's see-through cells ride along, and it
 * lands floating, as one undo step. What is brought in is a copy: changing the other
 * pattern later changes nothing here.
 */
import type { Pattern } from '../model/types.ts'
import { backgroundIndex } from './editor.ts'
import { clipOf, objectAt, readBlock, rectCols, rectRows, type CellRect, type Clip } from './selection.ts'

/** What is picked in the other pattern: a rectangle, and for a shape the cells of the
 *  rectangle that aren't part of it (see-through). */
export interface Picked {
  readonly rect: CellRect
  readonly clear: Uint8Array | null
}

/** The shape at a cell, as Select object picks one (`objectAt`), or null on the
 *  background. */
export function pickShape(source: Pattern, cell: { r: number; c: number }): Picked | null {
  if (cell.r < 0 || cell.c < 0 || cell.r >= source.rows || cell.c >= source.cols) return null
  const o = objectAt(source, cell, backgroundIndex(source))
  return o && { rect: o.rect, clear: o.clear }
}

/** The whole of the other pattern. */
export const pickAll = (source: Pattern): Picked => ({ rect: { r0: 0, c0: 0, r1: source.rows, c1: source.cols }, clear: null })

/**
 * The clip that brings `picked` into a rows × cols pattern: centred on it, so it lands
 * in the middle of the chart (the paste keeps it on the chart when it is bigger), rather
 * than where it was in the other pattern, which means nothing here.
 */
export function clipFor(source: Pattern, picked: Picked, target: { rows: number; cols: number }): Clip {
  const h = rectRows(picked.rect)
  const w = rectCols(picked.rect)
  const at = { r0: Math.floor((target.rows - h) / 2), c0: Math.floor((target.cols - w) / 2) }
  return clipOf(source, readBlock(source, picked.rect), at, picked.clear)
}
