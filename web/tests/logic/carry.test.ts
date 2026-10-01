import { describe, expect, it } from 'vitest'

import { carriedStitches, carriesByRun, carryPlan, carryReach, type Carry } from '../../src/logic/carry.ts'
import { encodeRow, rowDirection } from '../../src/logic/readout.ts'
import { workSequence } from '../../src/logic/work.ts'
import { SKIP_INDEX, type Pattern } from '../../src/model/types.ts'
import { carryNote } from '../../src/ui/work/segments.ts'

/** Rows given top to bottom as strings of palette digits, e.g. '0011'. */
function pattern(rows: string[], opts: Partial<Pattern> = {}): Pattern {
  const cols = rows[0]!.length
  return {
    id: 'p',
    name: 'p',
    created_at: 0,
    updated_at: 0,
    rows: rows.length,
    cols,
    row_ids: rows.map((_, i) => `r${i}`),
    cells: Uint16Array.from(rows.join('').split('').map(Number)),
    palette: ['#ffffff', '#000000', '#ff0000', '#00ff00'].map((hex, i) => ({ id: `c${i}`, hex, name: `C${i}`, dmc: null, count: 0 })),
    start_direction: 'LTR',
    alternate_direction: true,
    bottom_up: true,
    craft: 'tapestry',
    ...opts,
  }
}

describe('carryPlan', () => {
  it('carries a colour on to where the next row starts it: the screenshot’s row', () => {
    // Worked bottom-up: the bottom row left to right, the one above right to left. Black
    // ends at column 4 below and starts (from the right) at column 5 above.
    const p = pattern(['0011010000', '0011100000'])
    expect(rowDirection(p, 1)).toBe('LTR')
    expect(carryPlan(p)[1]).toEqual([{ palette_index: 1, from: 5, to: 6, kind: 'on' }])
    // And nothing to carry in the last row worked.
    expect(carryPlan(p)[0]).toEqual([])
  })

  it('picks a strand up in the next row when that row reaches it before needing it', () => {
    // Black ends at column 6 below; above (right to left) it's first needed at column 3.
    const p = pattern(['0001100000', '0011111000'])
    const plan = carryPlan(p)
    expect(plan[1]).toEqual([])
    // Picked up at column 6 and carried over 6 and 5: |3 − 6| stitches in all.
    expect(plan[0]).toEqual([{ palette_index: 1, from: 5, to: 7, kind: 'pickup' }])
  })

  it('carries nothing when the strand is already where the next row starts it', () => {
    expect(carryPlan(pattern(['0000011000', '0001111000']))).toEqual([[], []])
  })

  it('drops a colour the next row doesn’t use, and joins it fresh later', () => {
    // Top-down now: row 0 first. Black skips row 1.
    const p = pattern(['0110000', '0000000', '0000110'], { bottom_up: false })
    expect(carryPlan(p)).toEqual([[], [], []])
  })

  it('carries the background colour too, and several colours at once', () => {
    // Left to right below: 1 ends at column 2, 2 at 3, 0 at 6. Right to left above: 1 is
    // first needed at column 6, 2 at 5, 0 at 3.
    const p = pattern(['0000121', '0112000'])
    const plan = carryPlan(p)
    expect(plan[1]).toEqual([
      { palette_index: 1, from: 3, to: 7, kind: 'on' },
      { palette_index: 2, from: 4, to: 6, kind: 'on' },
    ])
    // 0 was left at column 6: picked up there, carried over 6, 5 and 4.
    expect(plan[0]).toEqual([{ palette_index: 0, from: 4, to: 7, kind: 'pickup' }])
  })

  it('suggests nothing it can’t reach without a float when rows don’t alternate', () => {
    // Every row left to right. Next row's black is behind where it was left: no carry.
    const behind = pattern(['0110000', '0000110'], { alternate_direction: false })
    expect(carryPlan(behind)).toEqual([[], []])
    // Ahead of it: carried on in the row below.
    const ahead = pattern(['0000110', '0110000'], { alternate_direction: false })
    expect(carryPlan(ahead)[1]).toEqual([{ palette_index: 1, from: 3, to: 5, kind: 'on' }])
  })
})

describe('carryReach', () => {
  // The owner's cats: a black cat reaching the left edge of a row worked right to left
  // (the bottom row here), under a row worked left to right that starts in white.
  const cats = pattern(['0000000011', '1110000000'], { start_direction: 'RTL' })

  it('marks a carry that runs on to the end of its row, or from its start', () => {
    expect(rowDirection(cats, 1)).toBe('RTL')
    const plan = carryPlan(cats)
    // White is carried on through the cat to the end of the row, where the next row
    // starts with it: the usual "carry it to the end".
    expect(plan[1]).toEqual([{ palette_index: 0, from: 0, to: 3, kind: 'on' }])
    expect(carryReach(cats.cols, plan[1]![0]!, 'RTL')).toBe('end')
    // Black, left at the start of the next row, is carried from its start up to its
    // first stitch.
    expect(plan[0]).toEqual([{ palette_index: 1, from: 0, to: 8, kind: 'pickup' }])
    expect(carryReach(cats.cols, plan[0]![0]!, 'LTR')).toBe('start')
    // Which end is which follows the row's direction.
    expect(carryReach(10, { from: 7, to: 10 }, 'LTR')).toBe('end')
    expect(carryReach(10, { from: 7, to: 10 }, 'RTL')).toBe('start')
  })

  it('marks nothing for one that starts and stops partway through a row, where you count', () => {
    // Carried on over one stitch, then dropped.
    const on = pattern(['0011010000', '0011100000'])
    expect(carryPlan(on)[1]).toEqual([{ palette_index: 1, from: 5, to: 6, kind: 'on' }])
    expect(carryReach(on.cols, carryPlan(on)[1]![0]!, 'LTR')).toBeNull()
    // Picked up two stitches before it's needed.
    const pick = pattern(['0001100000', '0011111000'])
    expect(carryPlan(pick)[0]).toEqual([{ palette_index: 1, from: 5, to: 7, kind: 'pickup' }])
    expect(carryReach(pick.cols, carryPlan(pick)[0]![0]!, 'RTL')).toBeNull()
  })
})

describe('carriesByRun', () => {
  const runs = [
    { start_col: 0, count: 2 },
    { start_col: 2, count: 8 },
  ]
  it('splits carries over the runs they cross, as the first, last or all of each', () => {
    expect(carriesByRun(10, runs, [{ palette_index: 3, from: 1, to: 4, kind: 'pickup' }], 'LTR')).toEqual([
      [{ palette_index: 3, count: 1, part: 'last', kind: 'pickup', pickUp: true, reach: null }],
      [{ palette_index: 3, count: 2, part: 'first', kind: 'pickup', pickUp: false, reach: null }],
    ])
    expect(carriesByRun(10, runs, [{ palette_index: 3, from: 3, to: 6, kind: 'on' }], 'LTR')).toEqual([
      [],
      [{ palette_index: 3, count: 3, part: 'last', kind: 'on', pickUp: false, reach: null }],
    ])
  })

  it('gives a carry that reaches an end of the row only to the run it begins in', () => {
    // Held from the start of the row (column 0) over both runs: said on the first.
    expect(carriesByRun(10, runs, [{ palette_index: 3, from: 0, to: 4, kind: 'pickup' }], 'LTR')).toEqual([
      [{ palette_index: 3, count: 2, part: 'all', kind: 'pickup', pickUp: true, reach: 'start' }],
      [],
    ])
    // On to the end, from the 2nd stitch of the second run.
    expect(carriesByRun(10, runs, [{ palette_index: 3, from: 3, to: 10, kind: 'on' }], 'LTR')).toEqual([
      [],
      [{ palette_index: 3, count: 7, part: 'last', kind: 'on', pickUp: false, reach: 'end' }],
    ])
    // Right to left, the end of the row is column 0: begun in the run at working
    // position 5 (image column 4).
    expect(carriesByRun(10, [{ start_col: 0, count: 5 }, { start_col: 5, count: 5 }], [{ palette_index: 1, from: 0, to: 5, kind: 'on' }], 'RTL')).toEqual([
      [],
      [{ palette_index: 1, count: 5, part: 'all', kind: 'on', pickUp: false, reach: 'end' }],
    ])
  })

  it('counts a right-to-left row from the right', () => {
    // Image columns 2..4 are working positions 5..7.
    expect(carriesByRun(10, [{ start_col: 0, count: 5 }, { start_col: 5, count: 5 }], [{ palette_index: 1, from: 2, to: 5, kind: 'on' }], 'RTL')).toEqual([
      [],
      [{ palette_index: 1, count: 3, part: 'first', kind: 'on', pickUp: false, reach: null }],
    ])
  })

  it('agrees with encodeRow on a real row', () => {
    const p = pattern(['0000121', '0112000'])
    const byRun = carriesByRun(p.cols, encodeRow(p, 1), carryPlan(p)[1]!, rowDirection(p, 1))
    // Runs 0, 11, 2, 000: 1 is carried on over the 2 and the three 0s, to the end of the
    // row, so it's said once, where it begins; 2 over two of the 0s.
    expect(byRun).toEqual([
      [],
      [],
      [{ palette_index: 1, count: 1, part: 'all', kind: 'on', pickUp: false, reach: 'end' }],
      [{ palette_index: 2, count: 2, part: 'first', kind: 'on', pickUp: false, reach: null }],
    ])
  })
})

/** A small seeded generator, so a failure can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Blocky random rows, like an alpha chart: runs of a few colours. */
function randomPattern(rand: () => number, opts: Partial<Pattern>): Pattern {
  const rows = 2 + Math.floor(rand() * 10)
  const cols = 1 + Math.floor(rand() * 14)
  const colours = 1 + Math.floor(rand() * 4)
  const out: string[] = []
  for (let r = 0; r < rows; r++) {
    let row = ''
    let v = Math.floor(rand() * colours)
    for (let c = 0; c < cols; c++) {
      if (rand() < 0.3) v = Math.floor(rand() * colours)
      row += v
    }
    out.push(row)
  }
  return pattern(out, opts)
}

/**
 * Checked from the strands, not the algorithm: each colour's stretch of a row is where
 * it's used plus where it's carried. Worked in order, a strand must enter each row where
 * it left the row before (no float), be carried over exactly |q − p| stitches between
 * consecutive rows (never further than needed), and never over its own colour.
 */
function checkStrands(p: Pattern, plan: Carry[][]) {
  const seq = workSequence(p)
  const at = (r: number, c: number) => p.cells[r * p.cols + c]!
  const stretch = (r: number, v: number) => {
    const ltr = rowDirection(p, r) === 'LTR'
    const cols = new Set<number>()
    for (let c = 0; c < p.cols; c++) if (at(r, c) === v) cols.add(c)
    const used = [...cols]
    for (const k of plan[r]!.filter((x) => x.palette_index === v)) {
      for (let c = k.from; c < k.to; c++) {
        expect(at(r, c)).not.toBe(v)
        cols.add(c)
      }
    }
    const sorted = [...cols].sort((a, b) => (ltr ? a - b : b - a))
    const usedSorted = used.sort((a, b) => (ltr ? a - b : b - a))
    return { entry: sorted[0], exit: sorted[sorted.length - 1], first: usedSorted[0], last: usedSorted[usedSorted.length - 1] }
  }
  let floats = 0
  for (let k = 0; k + 1 < seq.length; k++) {
    const [r, n] = [seq[k]!, seq[k + 1]!]
    for (let v = 0; v < 4; v++) {
      const a = stretch(r, v)
      const b = stretch(n, v)
      if (a.last === undefined || b.first === undefined) continue
      const carried =
        plan[r]!.filter((x) => x.palette_index === v && x.kind === 'on').reduce((t, x) => t + x.to - x.from, 0) +
        plan[n]!.filter((x) => x.palette_index === v && x.kind === 'pickup').reduce((t, x) => t + x.to - x.from, 0)
      if (a.exit !== b.entry) {
        // Only possible where rows run the same way and the next use is behind.
        expect(p.alternate_direction).toBe(false)
        expect(carried).toBe(0)
        floats++
        continue
      }
      expect(carried).toBe(Math.abs(b.first - a.last))
    }
  }
  return floats
}

describe('carryPlan, checked against the strands on random patterns', () => {
  it('never leaves a float when rows alternate, and never carries further than needed', () => {
    const rand = rng(12345)
    for (let i = 0; i < 400; i++) {
      const p = randomPattern(rand, {
        start_direction: rand() < 0.5 ? 'LTR' : 'RTL',
        bottom_up: rand() < 0.5,
      })
      expect(checkStrands(p, carryPlan(p))).toBe(0)
    }
  })

  it('leaves only unreachable strands when every row runs the same way', () => {
    const rand = rng(777)
    let floats = 0
    for (let i = 0; i < 400; i++) {
      const p = randomPattern(rand, { alternate_direction: false, start_direction: rand() < 0.5 ? 'LTR' : 'RTL', bottom_up: rand() < 0.5 })
      floats += checkStrands(p, carryPlan(p))
    }
    expect(floats).toBeGreaterThan(0)
  })
})

describe('carryNote', () => {
  it('says what to carry over which stitches, and where to pick a strand up', () => {
    expect(carryNote('Black', { count: 1, part: 'first', pickUp: false })).toBe('carry Black over the first 1')
    expect(carryNote('Black', { count: 4, part: 'all', pickUp: false })).toBe('carry Black over all 4')
    expect(carryNote('Black', { count: 3, part: 'last', pickUp: true })).toBe('pick up Black, carry over the last 3')
    expect(carryNote('Black', { count: 2, part: 'all', pickUp: true })).toBe('pick up Black, carry over all 2')
    expect(carryNote('Black', { count: 7, part: 'last', pickUp: false, reach: 'end' })).toBe('carry Black on to the end of the row')
    expect(carryNote('Black', { count: 2, part: 'all', pickUp: true, reach: 'start' })).toBe('carry Black from the start of the row')
  })
})

describe('carriedStitches', () => {
  it('counts each colour carried between its runs in a row, and on to the next row', () => {
    // Bottom row, left to right: White (0, 1, 5–9) is carried over Black's 3, and Black is
    // carried on over column 5, where the row above starts it. Top row, right to left:
    // White over Black's columns 2, 3 and 5; Black over White's column 4.
    const p = pattern(['0011010000', '0011100000'])
    expect(carryPlan(p)[1]).toEqual([{ palette_index: 1, from: 5, to: 6, kind: 'on' }])
    expect(carriedStitches(p)).toEqual([6, 2, 0, 0])
  })

  it('counts nothing for a colour in one run a row that the next row starts where it ended', () => {
    // Black at both ends of each row: carried over the two whites between, in both rows.
    expect(carriedStitches(pattern(['1001', '1001']))).toEqual([0, 4, 0, 0])
    // Stripes: nothing is carried.
    expect(carriedStitches(pattern(['1111', '0000']))).toEqual([0, 0, 0, 0])
  })

  it('counts skip cells and indices past the palette for no colour, but carries over them', () => {
    const p = pattern(['0000'], { cells: Uint16Array.from([1, SKIP_INDEX, 9, 1]) })
    expect(carriedStitches(p)).toEqual([0, 2, 0, 0])
  })
})
