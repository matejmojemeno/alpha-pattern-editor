/** What the chips show for each colour segment of the current row (chips.py). */
import { SKIP_INDEX, type PaletteEntry, type Pattern } from '../../model/types.ts'
import type { RunCarry } from '../../logic/carry.ts'
import { hexToRgb } from '../../theme/contrast.ts'

export type ChipState = 'done' | 'current' | 'pending'

/** A skipped cell, or an index with no palette entry (chips.py). */
const SKIP_ENTRY: PaletteEntry = { id: '?', hex: '#dddddd', name: 'skip', dmc: null, count: 0 }

export function entryFor(p: Pattern, paletteIndex: number): PaletteEntry {
  if (paletteIndex === SKIP_INDEX) return SKIP_ENTRY
  return p.palette[paletteIndex] ?? SKIP_ENTRY
}

export function chipState(index: number, cursor: number): ChipState {
  return index < cursor ? 'done' : index === cursor ? 'current' : 'pending'
}

/** The swatch outline: dark around pale yarns, pale around dark ones (chips.py:55). This
 *  is deliberately not contrastOn(), which picks text colour. */
export function swatchBorder(hex: string): string {
  let rgb: [number, number, number]
  try {
    rgb = hexToRgb(hex)
  } catch {
    return '#888888'
  }
  return rgb[0] + rgb[1] + rgb[2] > 180 ? '#888888' : '#cccccc'
}

/** A chip's note for a colour carried over some of its stitches (logic/carry.ts), e.g.
 *  "carry Black over the first 2" or "pick up Black, carry over the last 3". */
export function carryNote(name: string, c: Pick<RunCarry, 'count' | 'part' | 'pickUp'>): string {
  const over = c.part === 'all' ? `all ${c.count}` : `the ${c.part} ${c.count}`
  return c.pickUp ? `pick up ${name}, carry over ${over}` : `carry ${name} over ${over}`
}
