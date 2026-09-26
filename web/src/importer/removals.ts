/**
 * Colours removed on the import screen before saving: each one's cells take the nearest
 * remaining colour, as Delete does in Design (edit.ts, `deletePaletteEntryNearest`).
 *
 * A removal is remembered by its colour, not its palette id: every resample (moving the
 * outline, Re-detect) builds a fresh palette with fresh ids (core/detect/palette.py). So
 * each preview is kept as detection answered it, and the removals are applied to it in
 * the order they were made; each finds the entry nearest its colour, if one is within
 * `tolerance` (half the merge threshold, so it can only be one entry). A colour a new
 * preview doesn't have is skipped, and applied again if a later one has it.
 *
 * Saving applies the same removals to the committed pattern, which is built from the same
 * cached preview (bridge.commit), so what is saved is what was shown.
 */
import { deletePaletteEntryNearest } from '../logic/edit.ts'
import { deltaE, hexToLab } from '../logic/lab.ts'
import type { PaletteEntry, Pattern } from '../model/types.ts'

type Cells = Pick<Pattern, 'rows' | 'cols' | 'cells' | 'palette'>

/** A colour removed, and what it was called when it was. */
export interface Removal {
  hex: string
  name: string
}

/** The index of the entry nearest `hex`, if it is within `tolerance` (CIELAB ΔE). */
export function matchEntry(palette: readonly PaletteEntry[], hex: string, tolerance: number): number {
  const want = hexToLab(hex)
  let best = -1
  let bestD = Infinity
  palette.forEach((e, i) => {
    const d = deltaE(hexToLab(e.hex), want)
    if (d < bestD) {
      best = i
      bestD = d
    }
  })
  return bestD <= tolerance ? best : -1
}

/**
 * `p` with each removal applied in turn; `applied` says which were. The last colour is
 * never removed. Everything else about `p` (a Pattern's ids, a Preview's confidence) is
 * kept as it is.
 */
export function applyRemovals<T extends Cells>(
  p: T,
  removals: readonly Removal[],
  tolerance: number,
): { result: T; applied: boolean[] } {
  if (removals.length === 0) return { result: p, applied: [] }
  // edit.ts works on a Pattern; only its cells and palette are read back.
  let q = { ...p, row_ids: Array.from({ length: p.rows }, () => '') } as unknown as Pattern
  const applied = removals.map(({ hex }) => {
    if (q.palette.length <= 1) return false
    const i = matchEntry(q.palette, hex, tolerance)
    if (i < 0) return false
    q = deletePaletteEntryNearest(q, q.palette[i]!.id)
    return true
  })
  return { result: { ...p, cells: q.cells, palette: q.palette }, applied }
}
