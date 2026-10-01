/**
 * Where to carry yarn: tapestry crochet worked over the strands, with no floats, that
 * keeps each colour only as far as the next row needs it. Not in the Python: the desktop
 * never showed it, and it only reads the pattern (readout.ts), never changes it.
 *
 * Each colour is worked in, and carried inside the stitches between its runs, as usual.
 * The choice is at the ends of its stretch in a row:
 *
 *   carry on  After a colour's last stitch in a row, keep it inside the stitches that
 *             follow, up to the column of its first stitch in the next row, when the
 *             next row can only reach that column before it reaches the strand (the
 *             next row's first stitch of it is further along this row's direction). The
 *             strand then waits exactly where the next row picks it up.
 *   pick up   Otherwise the strand is dropped after its last stitch, and the next row
 *             passes it before needing it: pick it up there and carry it inside the
 *             stitches up to its first stitch.
 *
 * Either way a colour is carried over |q − p| stitches between consecutive rows, where p
 * is its last column in one row and q its first in the next. Carrying between two runs
 * of the same colour in one row isn't listed: that's done anyway. A colour that isn't in
 * the next row is dropped, and joined again where it's next needed. When every row runs
 * the same way, a strand the next row needs *behind* it can't be reached without a
 * float, so nothing is suggested there.
 */
import { SKIP_INDEX, type Pattern, type Run } from '../model/types.ts'
import { rowDirection } from './readout.ts'
import { workSequence } from './work.ts'

export type CarryKind = 'on' | 'pickup'

/** One colour carried inside the stitches of image columns [from, to) of a row. */
export interface Carry {
  readonly palette_index: number
  readonly from: number
  readonly to: number
  readonly kind: CarryKind
}

/** Where a colour is used in a row: its first and last image column in working order. */
function ends(p: Pattern, r: number): Map<number, { first: number; last: number }> {
  const ltr = rowDirection(p, r) === 'LTR'
  const out = new Map<number, { first: number; last: number }>()
  for (let k = 0; k < p.cols; k++) {
    const c = ltr ? k : p.cols - 1 - k
    const v = p.cells[r * p.cols + c]!
    if (v === SKIP_INDEX) continue
    const e = out.get(v)
    if (e) e.last = c
    else out.set(v, { first: c, last: c })
  }
  return out
}

/** The carries of every row, indexed by image row, each row's in working order. */
export function carryPlan(p: Pattern): Carry[][] {
  const plan: Carry[][] = Array.from({ length: p.rows }, () => [])
  const seq = workSequence(p)
  const used = seq.map((r) => ends(p, r))
  /** Where each colour's strand was left at the end of the row before. */
  let left = new Map<number, number>()
  seq.forEach((r, k) => {
    const s = rowDirection(p, r) === 'LTR' ? 1 : -1
    const next = used[k + 1]
    const exits = new Map<number, number>()
    for (const [v, { first, last }] of used[k]!) {
      const e = left.get(v)
      // The strand lies behind the first stitch that needs it: picked up on the way.
      if (e !== undefined && (first - e) * s > 0) {
        plan[r]!.push({ palette_index: v, ...span(e, first - s), kind: 'pickup' })
      }
      let exit = last
      const q = next?.get(v)?.first
      // The next row needs it further along: carried on to there.
      if (q !== undefined && (q - last) * s > 0) {
        plan[r]!.push({ palette_index: v, ...span(last + s, q), kind: 'on' })
        exit = q
      }
      exits.set(v, exit)
    }
    const ltr = s > 0
    plan[r]!.sort((a, b) => (ltr ? a.from - b.from : b.to - a.to) || a.palette_index - b.palette_index)
    left = exits
  })
  return plan
}

/** The half-open column span covering columns a and b, inclusive. */
function span(a: number, b: number): { from: number; to: number } {
  return { from: Math.min(a, b), to: Math.max(a, b) + 1 }
}

export type CarryPart = 'first' | 'last' | 'all'

/** A colour carried over some of a run's stitches. */
export interface RunCarry {
  readonly palette_index: number
  readonly count: number
  /** Which of the run's stitches, in working order: carrying on covers the first ones
   *  after the colour's last stitch, picking up the last ones before its first. */
  readonly part: CarryPart
  readonly kind: CarryKind
  /** The strand is picked up in this run (it lies at the start of the carry). */
  readonly pickUp: boolean
}

/**
 * The carries worth showing: those that start or stop partway through a row, where the
 * maker has to count to know where to drop a strand or pick one up. A carry that runs to
 * either end of the row is the usual "carry it to the end" (or, from the start, the
 * strand already in hand as the row begins): nothing to count, so it isn't shown, though
 * it's still carried, and still counted in the yarn estimate (`carriedStitches`).
 */
export function countedCarries(cols: number, plan: readonly (readonly Carry[])[]): Carry[][] {
  return plan.map((row) => row.filter((c) => c.from > 0 && c.to < cols))
}

/** The carries of a row, split over its runs (encodeRow), in the same order. */
export function carriesByRun(
  cols: number,
  runs: readonly Pick<Run, 'start_col' | 'count'>[],
  carries: readonly Carry[],
  direction: 'LTR' | 'RTL',
): RunCarry[][] {
  // In working order, as the runs' start_col is.
  const spans = carries.map((c) => ({
    c,
    a: direction === 'LTR' ? c.from : cols - c.to,
    b: direction === 'LTR' ? c.to : cols - c.from,
  }))
  return runs.map((run) => {
    const s = run.start_col
    const e = s + run.count
    const out: RunCarry[] = []
    for (const { c, a, b } of spans) {
      const n = Math.min(b, e) - Math.max(a, s)
      if (n <= 0) continue
      const part: CarryPart = n >= run.count ? 'all' : a <= s ? 'first' : 'last'
      out.push({ palette_index: c.palette_index, count: n, part, kind: c.kind, pickUp: c.kind === 'pickup' && a >= s })
    }
    return out
  })
}

/**
 * How many stitches each colour is carried inside, worked as carryPlan says, for the yarn
 * estimate (yarn/usage.ts): in each row, the stitches between its first and last that are
 * another colour's (carried between its runs), and the carries to and from the next row.
 * Indexed by palette index; skip cells and indices past the palette count for no colour.
 */
export function carriedStitches(p: Pattern): number[] {
  const out = new Array<number>(p.palette.length).fill(0)
  const plan = carryPlan(p)
  for (let r = 0; r < p.rows; r++) {
    const seen = new Map<number, { first: number; last: number; n: number }>()
    for (let c = 0; c < p.cols; c++) {
      const v = p.cells[r * p.cols + c]!
      if (v === SKIP_INDEX || v >= out.length) continue
      const e = seen.get(v)
      if (e) {
        e.last = c
        e.n++
      } else seen.set(v, { first: c, last: c, n: 1 })
    }
    for (const [v, { first, last, n }] of seen) out[v]! += last - first + 1 - n
    for (const k of plan[r]!) if (k.palette_index < out.length) out[k.palette_index]! += k.to - k.from
  }
  return out
}
