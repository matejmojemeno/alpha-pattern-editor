/** What the chips show for each colour segment of the current row (chips.py). */
import { SKIP_INDEX, type Direction, type PaletteEntry, type Pattern } from '../../model/types.ts'
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

/** What one pass along a pattern's rows is called: a round when every row runs the same
 *  way (worked in rounds), else a row. */
export const passName = (p: Pick<Pattern, 'alternate_direction'>): 'row' | 'round' => (p.alternate_direction ? 'row' : 'round')

/** The reading order in one sentence, under the Work stage's choices that set it, e.g.
 *  "Row 1 is the bottom row of the chart, worked right to left; row 2 comes back left to
 *  right." `inRounds` (the craft's) says whether rows that don't turn are rounds. */
export function readingOrder(p: Pick<Pattern, 'start_direction' | 'alternate_direction' | 'bottom_up'>, inRounds: boolean): string {
  const way = (d: Direction) => (d === 'RTL' ? 'right to left' : 'left to right')
  const first = `the ${p.bottom_up ? 'bottom' : 'top'} row of the chart, worked ${way(p.start_direction)}`
  if (p.alternate_direction) return `Row 1 is ${first}; row 2 comes back ${way(p.start_direction === 'RTL' ? 'LTR' : 'RTL')}.`
  const pass = inRounds ? 'round' : 'row'
  return `${pass === 'round' ? 'Round' : 'Row'} 1 is ${first}, and so is every ${pass} after it.`
}

/** A chip's note for a colour carried over some of its stitches (logic/carry.ts), e.g.
 *  "carry Black over the first 2" or "pick up Black, carry over the last 3"; or, for one
 *  that runs to an end of the row, "carry Black on to the end of the row" or "carry Black
 *  from the start of the row" ("round" in place of "row" when worked in rounds). */
export function carryNote(
  name: string,
  c: Pick<RunCarry, 'count' | 'part' | 'pickUp'> & { reach?: RunCarry['reach'] },
  pass: 'row' | 'round' = 'row',
): string {
  if (c.reach === 'end') return `carry ${name} on to the end of the ${pass}`
  if (c.reach === 'start') return `carry ${name} from the start of the ${pass}`
  const over = c.part === 'all' ? `all ${c.count}` : `the ${c.part} ${c.count}`
  return c.pickUp ? `pick up ${name}, carry over ${over}` : `carry ${name} over ${over}`
}
