/**
 * Filet crochet (§15): a chart of filled squares (blocks) and open ones (spaces), worked
 * in the mesh the pattern has chosen. Every convention here is cited in ./README.md.
 *
 * A filet chart's blank squares are the spaces, so the pattern's lightest colour is the
 * spaces and every other colour is blocks. That isn't stored: the colours decide it, and
 * the readout and progress stay the colour runs every craft uses (logic/readout.ts).
 */
import { hexToLab } from '../logic/lab.ts'
import { PATTERN_DEFAULTS, SKIP_INDEX, type Pattern } from '../model/types.ts'

/** The stitches squares are worked in. */
export interface Mesh {
  readonly id: string
  /** Stitches one square is wide, without the 1 more each row has at its starting edge. A
   *  space chains all of them but its closing stitch. */
  readonly width: number
  /** The stitch of every block and of each space's wall. */
  readonly stitch: 'dc' | 'tr'
}

export const MESHES: readonly Mesh[] = [
  { id: PATTERN_DEFAULTS.filet_mesh, width: 3, stitch: 'dc' },
  { id: 'ch1-dc', width: 2, stitch: 'dc' },
  { id: 'ch2-tr', width: 3, stitch: 'tr' },
]

/** The pattern's mesh; an id this build doesn't know is the default. */
export function meshOf(p: Pick<Pattern, 'filet_mesh'>): Mesh {
  return MESHES.find((m) => m.id === p.filet_mesh) ?? MESHES[0]!
}

/** One space's stitches, which also names the mesh: "ch 2, dc". */
export const spaceText = (mesh: Mesh): string => `ch ${mesh.width - 1}, ${mesh.stitch}`

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

/** The stitches `n` squares take: in ch 2, dc, "9 dc" for 3 blocks and "(ch 2, dc) × 2" for
 *  2 spaces. A block fills the square's width; a space chains it, skips as many, and closes
 *  with one stitch. Empty for skipped cells. */
export function stitchesText(square: Square, n: number, mesh: Mesh): string {
  if (square === 'block') return `${mesh.width * n} ${mesh.stitch}`
  if (square === 'space') return n === 1 ? spaceText(mesh) : `(${spaceText(mesh)}) × ${n}`
  return ''
}

/** The foundation chain for `cols` squares, before the turning chain: a square's width
 *  each, plus 1. */
export const foundationChain = (cols: number, mesh: Mesh): number => mesh.width * cols + 1

/** A row's runs (logic/readout.ts `encodeRow`) as squares: "3 spaces, 2 blocks, 1 space". */
export function formatFiletRow(p: Pattern, runs: readonly { palette_index: number; count: number }[]): string {
  const spaces = spaceIndex(p)
  return runs.map((run) => squaresText(squareOf(run.palette_index, spaces), run.count)).join(', ')
}
