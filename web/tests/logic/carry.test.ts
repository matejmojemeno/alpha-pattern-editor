import { describe, expect, it } from 'vitest'

import { carriedStitches, carriesByRun, carryPlan, type Carry } from '../../src/logic/carry.ts'
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

  it('carries a strand round the join in rounds when the next round needs it behind', () => {
    // Every round left to right, bottom up. Black ends at column 5 below and is needed at
    // column 1 above: carried over column 6 to the end of the round, then over column 0
    // of the next, 7 − 1 − (5 − 1) = 2 stitches.
    const behind = pattern(['0110000', '0000110'], { alternate_direction: false })
    expect(carryPlan(behind)).toEqual([
      [{ palette_index: 1, from: 0, to: 1, kind: 'on' }],
      [{ palette_index: 1, from: 6, to: 7, kind: 'on' }],
    ])
    // Right to left: black ends at column 2 below, needed at column 5 above.
    const rtl = pattern(['0000010', '0011000'], { alternate_direction: false, start_direction: 'RTL' })
    expect(carryPlan(rtl)).toEqual([
      [{ palette_index: 1, from: 6, to: 7, kind: 'on' }],
      [{ palette_index: 1, from: 0, to: 2, kind: 'on' }],
    ])
    // Ending the round, or needed at the start of the next: only the other half. (The
    // background goes round the join too, over the black stitches.)
    expect(carryPlan(pattern(['0100000', '0000001'], { alternate_direction: false }))).toEqual([
      [{ palette_index: 1, from: 0, to: 1, kind: 'on' }],
      [{ palette_index: 0, from: 6, to: 7, kind: 'on' }],
    ])
    expect(carryPlan(pattern(['1000000', '0000100'], { alternate_direction: false }))).toEqual([
      [{ palette_index: 0, from: 0, to: 1, kind: 'on' }],
      [{ palette_index: 1, from: 5, to: 7, kind: 'on' }],
    ])
    // Ahead of it: carried on in the round below, as when rows turn.
    const ahead = pattern(['0000110', '0110000'], { alternate_direction: false })
    expect(carryPlan(ahead)[1]).toEqual([{ palette_index: 1, from: 3, to: 5, kind: 'on' }])
    // Needed right above where it was left: it waits there.
    expect(carryPlan(pattern(['0001000', '0011000'], { alternate_direction: false }))).toEqual([[], []])
  })
})

describe('carriesByRun', () => {
  const runs = [
    { start_col: 0, count: 2 },
    { start_col: 2, count: 8 },
  ]
  it('splits carries over the runs they cross, as the first, last or all of each', () => {
    expect(carriesByRun(10, runs, [{ palette_index: 3, from: 1, to: 4, kind: 'pickup' }], 'LTR')).toEqual([
      [{ palette_index: 3, count: 1, part: 'last', kind: 'pickup', pickUp: true }],
      [{ palette_index: 3, count: 2, part: 'first', kind: 'pickup', pickUp: false }],
    ])
    expect(carriesByRun(10, runs, [{ palette_index: 3, from: 0, to: 4, kind: 'on' }], 'LTR')).toEqual([
      [{ palette_index: 3, count: 2, part: 'all', kind: 'on', pickUp: false }],
      [{ palette_index: 3, count: 2, part: 'first', kind: 'on', pickUp: false }],
    ])
  })

  it('counts a right-to-left row from the right', () => {
    // Image columns 2..4 are working positions 5..7.
    expect(carriesByRun(10, [{ start_col: 0, count: 5 }, { start_col: 5, count: 5 }], [{ palette_index: 1, from: 2, to: 5, kind: 'on' }], 'RTL')).toEqual([
      [],
      [{ palette_index: 1, count: 3, part: 'first', kind: 'on', pickUp: false }],
    ])
  })

  it('agrees with encodeRow on a real row', () => {
    const p = pattern(['0000121', '0112000'])
    const byRun = carriesByRun(p.cols, encodeRow(p, 1), carryPlan(p)[1]!, rowDirection(p, 1))
    // Runs 0, 11, 2, 000: 1 is carried over the 2 and the three 0s, 2 over two 0s.
    expect(byRun).toEqual([
      [],
      [],
      [{ palette_index: 1, count: 1, part: 'all', kind: 'on', pickUp: false }],
      [
        { palette_index: 1, count: 3, part: 'all', kind: 'on', pickUp: false },
        { palette_index: 2, count: 2, part: 'first', kind: 'on', pickUp: false },
      ],
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
 * it left the row before (no float), and never be carried over its own colour. When rows
 * turn, it's carried over exactly |q − p| stitches between consecutive rows (never further
 * than needed). In rounds, the end of one round is followed by the start of the next, so
 * a strand may leave a round at its end and enter the next at its start, and it's carried
 * over the stitches between p and q along the rounds: q − p working positions on, or
 * round the join when q is behind p.
 */
function checkStrands(p: Pattern, plan: Carry[][]) {
  const seq = workSequence(p)
  const at = (r: number, c: number) => p.cells[r * p.cols + c]!
  /** A column's position in a row's working order. */
  const pos = (r: number, c: number) => (rowDirection(p, r) === 'LTR' ? c : p.cols - 1 - c)
  const stretch = (r: number, v: number) => {
    const cols = new Set<number>()
    for (let c = 0; c < p.cols; c++) if (at(r, c) === v) cols.add(c)
    const used = [...cols].map((c) => pos(r, c))
    for (const k of plan[r]!.filter((x) => x.palette_index === v)) {
      for (let c = k.from; c < k.to; c++) {
        expect(at(r, c)).not.toBe(v)
        cols.add(c)
      }
    }
    const all = [...cols].map((c) => pos(r, c))
    return { entry: Math.min(...all), exit: Math.max(...all), first: Math.min(...used), last: Math.max(...used) }
  }
  /** Stitches of row r carried for v: before its first stitch, or after its last. */
  const carriedIn = (r: number, v: number, after: boolean) => {
    const { first, last } = stretch(r, v)
    let n = 0
    for (const k of plan[r]!.filter((x) => x.palette_index === v)) {
      for (let c = k.from; c < k.to; c++) if (after ? pos(r, c) > last : pos(r, c) < first) n++
    }
    return n
  }
  let joins = 0
  for (let k = 0; k + 1 < seq.length; k++) {
    const [r, n] = [seq[k]!, seq[k + 1]!]
    for (let v = 0; v < 4; v++) {
      if (![...p.cells.subarray(r * p.cols, (r + 1) * p.cols)].includes(v)) continue
      if (![...p.cells.subarray(n * p.cols, (n + 1) * p.cols)].includes(v)) continue
      const a = stretch(r, v)
      const b = stretch(n, v)
      const carried = carriedIn(r, v, true) + carriedIn(n, v, false)
      // Image columns: the strand leaves row r and enters row n at the same one.
      const exitCol = rowDirection(p, r) === 'LTR' ? a.exit : p.cols - 1 - a.exit
      const entryCol = rowDirection(p, n) === 'LTR' ? b.entry : p.cols - 1 - b.entry
      if (p.alternate_direction) {
        expect(exitCol).toBe(entryCol)
        expect(carried).toBe(Math.abs((rowDirection(p, r) === 'LTR' ? a.last : p.cols - 1 - a.last) - (rowDirection(p, n) === 'LTR' ? b.first : p.cols - 1 - b.first)))
      } else if (b.first < a.last) {
        // Round the join: out at the end of round r, in at the start of round n.
        expect([a.exit, b.entry]).toEqual([p.cols - 1, 0])
        expect(carried).toBe(p.cols - 1 - (a.last - b.first))
        joins++
      } else {
        expect(exitCol).toBe(entryCol)
        expect(carried).toBe(b.first - a.last)
      }
    }
  }
  return joins
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

  it('never leaves a float in rounds either, carrying round the join when it must', () => {
    const rand = rng(777)
    let joins = 0
    for (let i = 0; i < 400; i++) {
      const p = randomPattern(rand, { alternate_direction: false, start_direction: rand() < 0.5 ? 'LTR' : 'RTL', bottom_up: rand() < 0.5 })
      joins += checkStrands(p, carryPlan(p))
    }
    expect(joins).toBeGreaterThan(0)
  })
})

describe('carryNote', () => {
  it('says what to carry over which stitches, and where to pick a strand up', () => {
    expect(carryNote('Black', { count: 1, part: 'first', pickUp: false })).toBe('carry Black over the first 1')
    expect(carryNote('Black', { count: 4, part: 'all', pickUp: false })).toBe('carry Black over all 4')
    expect(carryNote('Black', { count: 3, part: 'last', pickUp: true })).toBe('pick up Black, carry over the last 3')
    expect(carryNote('Black', { count: 2, part: 'all', pickUp: true })).toBe('pick up Black, carry over all 2')
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
