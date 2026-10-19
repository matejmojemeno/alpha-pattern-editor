/**
 * Filet crochet (§15): a chart of filled squares (blocks) and open ones (spaces), each
 * square 3 stitches wide plus 1 at the edge of the row. Every convention here is cited in
 * ./README.md.
 *
 * A filet chart's blank squares are the spaces, so the pattern's lightest colour is the
 * spaces and every other colour is blocks. Nothing is stored: the colours decide it, and
 * the readout and progress stay the colour runs every craft uses (logic/readout.ts).
 */
import { hexToLab } from '../logic/lab.ts'
import { SKIP_INDEX, type Pattern } from '../model/types.ts'

/** Stitches in one square, and the one more each row has at its starting edge. */
export const STITCHES_PER_SQUARE = 3

export type Square = 'block' | 'space' | 'skip'

/** The palette index read as spaces: the lightest colour (CIELAB L*), the first of equals.
 *  Null for an empty palette. */
export function spaceIndex(p: Pick<Pattern, 'palette'>): number | null {
  let best: number | null = null
  let bestL = -Infinity
  p.palette.forEach((e, i) => {
    let l: number
    try {
      l = hexToLab(e.hex)[0]
    } catch {
      return
    }
    if (l > bestL) {
      bestL = l
      best = i
    }
  })
  return best
}

/** What a cell of palette index `paletteIndex` is worked as, given the spaces' index. */
export function squareOf(paletteIndex: number, spaces: number | null): Square {
  if (paletteIndex === SKIP_INDEX) return 'skip'
  return paletteIndex === spaces ? 'space' : 'block'
}

/** "1 block", "3 spaces", "2 skip". */
export function squaresText(square: Square, n: number): string {
  if (square === 'skip') return `${n} skip`
  return `${n} ${square}${n === 1 ? '' : 's'}`
}

/** The stitches `n` squares take: "9 dc" for 3 blocks, "(ch 2, dc) × 2" for 2 spaces.
 *  A block is 3 dc; a space is ch 2, skip 2, dc. Empty for skipped cells. */
export function stitchesText(square: Square, n: number): string {
  if (square === 'block') return `${STITCHES_PER_SQUARE * n} dc`
  if (square === 'space') return n === 1 ? 'ch 2, dc' : `(ch 2, dc) × ${n}`
  return ''
}

/** The foundation chain for `cols` squares, before the turning chain: 3 per square + 1. */
export const foundationChain = (cols: number): number => STITCHES_PER_SQUARE * cols + 1

/** A row's runs (logic/readout.ts `encodeRow`) as squares: "3 spaces, 2 blocks, 1 space". */
export function formatFiletRow(p: Pattern, runs: readonly { palette_index: number; count: number }[]): string {
  const spaces = spaceIndex(p)
  return runs.map((run) => squaresText(squareOf(run.palette_index, spaces), run.count)).join(', ')
}
