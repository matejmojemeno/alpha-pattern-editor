/**
 * Colours removed on the import screen before saving, by the colour count's "fewer
 * colours": each one's cells take the nearest remaining colour, as Delete does in Design
 * (edit.ts, `deletePaletteEntryNearest`). (Each colour once had its own × too; removing a
 * colour by hand is Design's now, so every removal the screen makes is a merge.)
 *
 * A removal is remembered by its colour, not its palette id: every resample (moving the
 * outline, detecting again) builds a fresh palette with fresh ids (core/detect/palette.py). So
 * each preview is kept as detection answered it, and the removals are applied to it in
 * the order they were made; each finds the entry nearest its colour, if one is within
 * `tolerance` (half the merge threshold, so it can only be one entry). A colour a new
 * preview doesn't have is skipped, and applied again if a later one has it.
 *
 * Saving applies the same removals to the committed pattern, which is built from the same
 * cached preview (bridge.commit), so what is saved is what was shown.
 *
 * Once a colour is gone, the rest are named again (names.ts), since detection told them
 * apart from it: with one of two blues removed, "Dark blue" is plain "Blue" again.
 */
import { deletePaletteEntryNearest } from '../logic/edit.ts'
import { deltaE, hexToLab } from '../logic/lab.ts'
import type { PaletteEntry, Pattern } from '../model/types.ts'
import { simpleNames } from './names.ts'

type Cells = Pick<Pattern, 'rows' | 'cols' | 'cells' | 'palette'>

/** A colour removed, and what it was called when it was. */
export interface Removal {
  hex: string
  name: string
  /** Taken away by "fewer colours" (`mergeCandidate`) rather than its own ×: the colour
   *  count's + puts these back, last first. */
  merged?: boolean
}

/**
 * The colour "fewer colours" takes away: of the two closest colours (CIELAB ΔE, as
 * `deletePaletteEntryNearest` measures, so its stitches go to the other of the two), the
 * one used less. Of two used equally, the later goes. Null with one colour or none.
 */
export function mergeCandidate(palette: readonly PaletteEntry[]): PaletteEntry | null {
  const labs = palette.map((e) => hexToLab(e.hex))
  let pair: [number, number] | null = null
  let bestD = Infinity
  for (let i = 0; i < labs.length; i++)
    for (let j = i + 1; j < labs.length; j++) {
      const d = deltaE(labs[i]!, labs[j]!)
      if (d < bestD) {
        pair = [i, j]
        bestD = d
      }
    }
  if (!pair) return null
  const [a, b] = [palette[pair[0]]!, palette[pair[1]]!]
  return b.count <= a.count ? b : a
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
 * never removed. When any was, the colours left are named again. Everything else about
 * `p` (a Pattern's ids, a Preview's confidence) is kept as it is.
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
  const names = applied.some(Boolean) ? simpleNames(q.palette.map((e) => e.hex)) : null
  const palette = names ? q.palette.map((e, i) => ({ ...e, name: names[i]! })) : q.palette
  return { result: { ...p, cells: q.cells, palette }, applied }
}
