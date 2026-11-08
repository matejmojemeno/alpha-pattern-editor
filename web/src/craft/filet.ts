/**
 * Filet crochet (§15): a chart of filled squares (blocks) and open ones (spaces), worked
 * in the mesh the pattern has chosen. Every convention here is cited in ./README.md.
 *
 * A filet chart's blank squares are the spaces, so the pattern's lightest colour is the
 * spaces and every other colour is blocks. That isn't stored: the colours decide it, and
 * the readout and progress stay the colour runs every craft uses (logic/readout.ts).
 */
import { hexToLab } from '../logic/lab.ts'
import { encodeRow } from '../logic/readout.ts'
import { workSequence } from '../logic/work.ts'
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

/** A turning chain's length for each stitch. It counts as the row's first stitch, the one
 *  at its edge. */
export const TURNING_CHAIN: Readonly<Record<Mesh['stitch'], number>> = { dc: 3, tr: 4 }

/** "Turn and ch 3: it counts as the first dc.", for every row after the first. */
export const turnText = (mesh: Mesh): string =>
  `Turn and ch ${TURNING_CHAIN[mesh.stitch]}: it counts as the first ${mesh.stitch}.`

/** Row 1's first square, as it's worked; cells skipped at its start are passed over. */
export function firstSquare(p: Pattern): 'block' | 'space' {
  const row = workSequence(p)[0]
  if (row === undefined) return 'block'
  const spaces = spaceIndex(p)
  const run = encodeRow(p, row).find((r) => r.palette_index !== SKIP_INDEX)
  return run !== undefined && squareOf(run.palette_index, spaces) === 'space' ? 'space' : 'block'
}

/** The chain row 1 is worked into, and where its first stitch goes. */
export interface Foundation {
  /** Every chain to make: `squares + turning + space`. */
  readonly chains: number
  /** A square's width for each square. */
  readonly squares: number
  /** The turning chain, which is row 1's first stitch. */
  readonly turning: number
  /** When row 1 starts with a space, the chains across its top; else 0. */
  readonly space: number
  /** The chain, counted from the hook, that row 1's first worked stitch goes in. */
  readonly hook: number
}

/** The foundation chain for `p`, from its mesh and row 1's first square. A space's top
 *  chains are made with the foundation, then as many chains are skipped below it. */
export function foundation(p: Pattern): Foundation {
  const mesh = meshOf(p)
  const turning = TURNING_CHAIN[mesh.stitch]
  const space = firstSquare(p) === 'space' ? mesh.width - 1 : 0
  const squares = mesh.width * p.cols
  return { chains: squares + turning + space, squares, turning, space, hook: turning + 2 * space + 1 }
}

/** 1st, 2nd, 3rd, 4th… */
function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** Row 1's start, said in full so another turning chain or edge can be worked out from it:
 *  "Chain 66: 3 × 20 for the squares, 4 for the turning chain (it counts as the first tr)
 *  and 2 for the first space. Then tr in the 9th chain from the hook." */
export function foundationText(p: Pattern): string {
  const mesh = meshOf(p)
  const f = foundation(p)
  const turning = `${f.turning} for the turning chain (it counts as the first ${mesh.stitch})`
  const parts = f.space ? `${turning} and ${f.space} for the first space` : `and ${turning}`
  return `Chain ${f.chains}: ${mesh.width} × ${p.cols} for the squares, ${parts}. Then ${mesh.stitch} in the ${ordinal(f.hook)} chain from the hook.`
}

/** A row's runs (logic/readout.ts `encodeRow`) as squares: "3 spaces, 2 blocks, 1 space". */
export function formatFiletRow(p: Pattern, runs: readonly { palette_index: number; count: number }[]): string {
  const spaces = spaceIndex(p)
  return runs.map((run) => squaresText(squareOf(run.palette_index, spaces), run.count)).join(', ')
}
