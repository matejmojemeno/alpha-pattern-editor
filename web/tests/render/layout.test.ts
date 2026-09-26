import { describe, expect, it } from 'vitest'

import {
  AXIS_LEFT,
  AXIS_TOP,
  EMPHASIS_SCALE,
  MIN_CELL,
  PAD,
  computeLayout,
  followCurrent,
  followCurrentX,
  followMargin,
  nearRows,
  placeColumn,
  rowHeight,
  rowInView,
  rowSpan,
  rowsInViewport,
  shouldScroll,
  showAxisNumber,
  visibleRows,
  yOffsets,
  type ChartLayout,
  type LayoutInput,
  type RowPlace,
} from '../../src/render/layout.ts'
import { encodeRow } from '../../src/logic/readout.ts'
import type { Direction, Pattern } from '../../src/model/types.ts'

/** A chart area whose grid viewport is exactly `w` × `h`. */
const area = (w: number, h: number) => ({ width: w + AXIS_LEFT + PAD, height: h + AXIS_TOP + PAD })

const layout = (over: Partial<LayoutInput> & Pick<LayoutInput, 'rows' | 'cols'>) =>
  computeLayout({ current: 0, emphasise: false, focus: false, ...area(400, 400), ...over })

describe('rows around the current one', () => {
  it('is the current row ± 2, clipped at both ends', () => {
    expect(nearRows(20, 10)).toEqual({ start: 8, end: 13 })
    expect(nearRows(20, 0)).toEqual({ start: 0, end: 3 })
    expect(nearRows(20, 19)).toEqual({ start: 17, end: 20 })
    expect(nearRows(3, 1)).toEqual({ start: 0, end: 3 })
    expect(nearRows(20, null)).toEqual({ start: 0, end: 0 })
  })

  it('is what focus mode draws (chart_view.py _visible_rows)', () => {
    expect(visibleRows(20, 10, true)).toEqual(nearRows(20, 10))
    expect(visibleRows(20, 0, true)).toEqual({ start: 0, end: 3 })
    expect(visibleRows(20, 10, false)).toEqual({ start: 0, end: 20 })
    // Nothing to focus on once the pattern is finished.
    expect(visibleRows(20, null, true)).toEqual({ start: 0, end: 20 })
  })

  it('is what emphasis makes taller', () => {
    const l = layout({ rows: 20, cols: 20, current: 10, emphasise: true })
    expect(l.near).toEqual(nearRows(20, 10))
    expect(l.heights.filter((h) => h > l.cell)).toHaveLength(5)
  })

  it('in focus mode, lays out only those rows', () => {
    const l = layout({ rows: 20, cols: 20, current: 10, focus: true })
    expect(l.range).toEqual({ start: 8, end: 13 })
    expect(l.heights).toHaveLength(5)
    expect(rowSpan(l, 7)).toBeNull()
    expect(rowSpan(l, 8)!.top).toBe(0)
  })
})

describe('row heights', () => {
  const near = nearRows(20, 10)

  it('are the base height with emphasis off', () => {
    for (let r = 0; r < 20; r++) expect(rowHeight(r, 10, near, false)).toBe(10)
    const l = layout({ rows: 20, cols: 20, current: 10 })
    expect(new Set(l.heights)).toEqual(new Set([l.cell]))
  })

  it('are taller within the radius with emphasis on', () => {
    expect(rowHeight(10, 10, near, true)).toBe(10 * EMPHASIS_SCALE)
    expect(rowHeight(8, 10, near, true)).toBe(10 * EMPHASIS_SCALE)
    expect(rowHeight(12, 10, near, true)).toBe(10 * EMPHASIS_SCALE)
    expect(rowHeight(7, 10, near, true)).toBe(10)
    expect(rowHeight(13, 10, near, true)).toBe(10)
  })

  it('snap to device pixels', () => {
    // 7 × 1.6 = 11.2 → 11 at 1×, 11.0 at 2× (22.4 → 22 device px).
    expect(rowHeight(10, 7, near, true, 1)).toBe(11)
    expect(rowHeight(10, 7, near, true, 2)).toBe(11)
    const l = computeLayout({ rows: 13, cols: 7, current: 3, emphasise: true, focus: false, width: 333, height: 517, dpr: 2 })
    for (const y of l.offsets) expect(Number.isInteger(y * 2)).toBe(true)
    expect(Number.isInteger(l.cell * 2)).toBe(true)
  })

  it('still fit the chart when emphasis makes some rows taller', () => {
    const l = layout({ rows: 20, cols: 20, current: 10, emphasise: true })
    expect(l.mode).toBe('fit')
    expect(l.gridHeight).toBeLessThanOrEqual(l.viewHeight)
    expect(l.gridWidth).toBeLessThanOrEqual(l.viewWidth)
    expect(l.maxScrollY).toBe(0)
  })
})

describe('the cell size stays put as the current row moves', () => {
  // Near either end the band around the current row is clipped; the cells must not grow
  // to fill the space it leaves, or the chart zooms as you reach the start or the end. A
  // short, wide area, so the rows' height is what sizes the cells.
  const shapes: [string, number, number][] = [
    ['30 rows, fitted', 30, 20],
    ['30 rows, scrolling across', 30, 80],
    ['3 rows, fitted', 3, 4],
    ['3 rows, scrolling across', 3, 20],
  ]
  for (const [name, rows, cols] of shapes) {
    for (const emphasise of [false, true]) {
      for (const focus of [false, true]) {
        it(`${name}, emphasis ${emphasise ? 'on' : 'off'}, focus ${focus ? 'on' : 'off'}`, () => {
          const bases = new Set<number>()
          for (let current = 0; current < rows; current++) {
            bases.add(computeLayout({ rows, cols, current, emphasise, focus, width: 2000, height: 300, dpr: 2 }).cell)
          }
          expect([...bases]).toHaveLength(1)
        })
      }
    }
  }

  it('sizes the rows as the whole band would fill them', () => {
    // 660 px for 30 rows, 5 of them 1.6× as tall, is 660 / 33 = 20 px a row at every
    // current row, though at row 0 only 3 are tall (660 / 31.8 would be 20.5 at 2×).
    const at = (current: number, over: Partial<LayoutInput> = {}) =>
      layout({ rows: 30, cols: 20, current, emphasise: true, dpr: 2, ...area(2000, 660), ...over })
    expect(at(0).cell).toBe(20)
    expect(at(15).cell).toBe(20)
    expect(at(29).cell).toBe(20)
    // In focus mode, as if five rows were shown when only three are: 300 / 5.
    const focused = (current: number) => at(current, { cols: 4, emphasise: false, focus: true, ...area(2000, 300) })
    expect(focused(0).heights).toHaveLength(3)
    expect(focused(0).cell).toBe(60)
    expect(focused(15).cell).toBe(60)
  })
})

describe('y offsets', () => {
  it('are the running sum of the heights', () => {
    expect(yOffsets([])).toEqual([0])
    expect(yOffsets([10, 16, 10])).toEqual([0, 10, 26, 36])
  })

  it('are what the layout uses', () => {
    const l = layout({ rows: 12, cols: 10, current: 5, emphasise: true })
    expect(l.offsets).toEqual(yOffsets(l.heights))
    expect(l.gridHeight).toBe(l.offsets.at(-1))
    expect(rowSpan(l, 5)).toEqual({ top: l.offsets[5], bottom: l.offsets[6] })
    expect(rowSpan(l, 12)).toBeNull()
  })
})

describe('fit or scroll', () => {
  it('switches at a 2:1 aspect ratio', () => {
    expect(shouldScroll(40, 20)).toBe(false)
    expect(shouldScroll(41, 20)).toBe(true)
    expect(shouldScroll(20, 40)).toBe(false)
    expect(shouldScroll(20, 41)).toBe(true)
    expect(layout({ rows: 40, cols: 20 }).mode).toBe('fit')
    expect(layout({ rows: 41, cols: 20 }).mode).toBe('scroll')
  })

  it('fits a chart up to 2:1 into the space, like the desktop', () => {
    const l = layout({ rows: 40, cols: 20 })
    // min(400 / 20, 400 / 40)
    expect(l.cell).toBe(10)
    expect(l.gridHeight).toBe(400)
    expect(l.maxScrollX).toBe(0)
    expect(l.maxScrollY).toBe(0)
  })

  it('sizes a tall chart to its width and scrolls it vertically', () => {
    const l = layout({ rows: 200, cols: 40 })
    expect(l.cell).toBe(10) // 400 / 40
    expect(l.gridWidth).toBe(400)
    expect(l.gridHeight).toBe(2000)
    expect(l.maxScrollX).toBe(0)
    expect(l.maxScrollY).toBe(1600)
  })

  it('sizes a wide chart to its height and scrolls it horizontally', () => {
    const l = layout({ rows: 40, cols: 200 })
    expect(l.cell).toBe(10) // 400 / 40
    expect(l.gridHeight).toBe(400)
    expect(l.maxScrollY).toBe(0)
    expect(l.maxScrollX).toBe(1600)
  })

  it('scrolls a fitted chart too once its cells would drop below the minimum', () => {
    const l = layout({ rows: 300, cols: 200, ...area(400, 400) })
    expect(l.mode).toBe('fit')
    expect(l.cell).toBe(MIN_CELL)
    expect(l.maxScrollY).toBe(300 * MIN_CELL - 400)
  })

  it('makes the owner’s long charts readable on a phone', () => {
    // 88×194 and 100×159 in a ~360 px-wide chart area.
    const a = computeLayout({ rows: 194, cols: 88, current: 0, emphasise: true, focus: false, width: 368, height: 380, dpr: 2 })
    expect(a.mode).toBe('scroll')
    expect(a.cell).toBeCloseTo((368 - AXIS_LEFT - PAD) / 88, 0)
    const b = computeLayout({ rows: 159, cols: 100, current: 0, emphasise: true, focus: false, width: 368, height: 380, dpr: 2 })
    expect(b.mode).toBe('fit') // 1.59:1
    expect(b.cell).toBe(MIN_CELL)
  })

  it('always fits in focus mode, which only shows a few rows', () => {
    const l = layout({ rows: 200, cols: 40, current: 100, focus: true })
    expect(l.mode).toBe('fit')
    expect(l.maxScrollY).toBe(0)
  })
})

describe('the current row stays in view', () => {
  const cases: [string, Partial<LayoutInput> & Pick<LayoutInput, 'rows' | 'cols'>][] = [
    ['a tall scrolling chart', { rows: 200, cols: 40 }],
    ['with emphasis', { rows: 200, cols: 40, emphasise: true }],
    ['on a phone', { rows: 194, cols: 88, emphasise: true, width: 368, height: 380, dpr: 2 }],
    ['a fitted chart at the minimum cell size', { rows: 300, cols: 200, emphasise: true }],
    ['a chart that fits', { rows: 30, cols: 30, emphasise: true }],
    ['in focus mode', { rows: 200, cols: 40, focus: true, emphasise: true }],
  ]

  it.each(cases)('%s, as it moves through every row, both ways', (_, input) => {
    let scroll = 0
    const walk = (r: number) => {
      const l = layout({ ...input, current: r })
      scroll = followCurrent(l, scroll)
      expect(scroll).toBeGreaterThanOrEqual(0)
      expect(scroll).toBeLessThanOrEqual(l.maxScrollY)
      expect(rowInView(l, r, scroll)).toBe(true)
    }
    for (let r = 0; r < input.rows; r++) walk(r)
    for (let r = input.rows - 1; r >= 0; r--) walk(r)
  })

  it('is centred mid-chart and pinned to the ends at the ends', () => {
    const at = (r: number) => {
      const l = layout({ rows: 200, cols: 40, current: r })
      return { l, y: followCurrent(l, 777) }
    }
    expect(at(0).y).toBe(0)
    const last = at(199)
    expect(last.y).toBe(last.l.maxScrollY)
    const mid = at(100)
    const span = rowSpan(mid.l, 100)!
    expect((span.top + span.bottom) / 2 - mid.y).toBe(mid.l.viewHeight / 2)
  })

  it('leaves the scroll alone, clamped, when there is no current row', () => {
    const l = layout({ rows: 200, cols: 40, current: null })
    expect(followCurrent(l, 500)).toBe(500)
    expect(followCurrent(l, 99_999)).toBe(l.maxScrollY)
    expect(followCurrent(l, -5)).toBe(0)
  })
})

describe('rows in the viewport', () => {
  it('are the rows overlapping it', () => {
    const l = layout({ rows: 200, cols: 40 }) // 10 px rows, 400 px view
    expect(rowsInViewport(l, 0)).toEqual({ from: 0, to: 40 })
    expect(rowsInViewport(l, 5)).toEqual({ from: 0, to: 41 })
    expect(rowsInViewport(l, 1600)).toEqual({ from: 160, to: 200 })
  })

  it('handle uneven row heights', () => {
    const l = layout({ rows: 200, cols: 40, current: 100, emphasise: true })
    const y = followCurrent(l, 0)
    const { from, to } = rowsInViewport(l, y)
    expect(from).toBeLessThanOrEqual(100)
    expect(to).toBeGreaterThan(100)
    expect(l.offsets[from + 1]!).toBeGreaterThan(y)
    expect(l.offsets[to - 1]!).toBeLessThan(y + l.viewHeight)
  })
})

describe('axis numbers', () => {
  it('label every line on charts of 15 or fewer', () => {
    for (let n = 1; n <= 15; n++) expect(showAxisNumber(n, 15)).toBe(true)
  })

  it('label every 5th plus the first on larger charts', () => {
    const shown = Array.from({ length: 16 }, (_, i) => i + 1).filter((n) => showAxisNumber(n, 16))
    expect(shown).toEqual([1, 5, 10, 15])
  })
})

describe('your place in the row stays in view across', () => {
  // 100 × 20 in a 400 × 200 view: 10 px cells, a 1000 px grid, scrolling 0..600 across,
  // and a 30 px margin (three cells).
  const wide = () => layout({ rows: 20, cols: 100, current: 5, ...area(400, 200) })
  /** Ten segments of ten stitches, in working order. */
  const tens = Array.from({ length: 10 }, (_, i) => ({ start_col: i * 10, count: 10 }))
  const at = (runIndex: number, stitches: number, direction: Direction, runs = tens): RowPlace => ({
    runs,
    runIndex,
    stitches,
    direction,
  })

  /** Every stitch of a row in turn: the scroll offsets it passes through, checking your
   *  place is in view at each one. */
  function workRow(l: ChartLayout, direction: Direction, runs = tens): number[] {
    let x = followCurrentX(l, at(0, 0, direction, runs), direction === 'LTR' ? l.maxScrollX : 0)
    const stops = [x]
    runs.forEach((run, i) => {
      for (let s = 0; s < run.count; s++) {
        const place = at(i, s, direction, runs)
        x = followCurrentX(l, place, x)
        const left = placeColumn(l.cols, place)! * l.cell
        expect(left).toBeGreaterThanOrEqual(x)
        expect(left + l.cell).toBeLessThanOrEqual(x + l.viewWidth)
        if (x !== stops[stops.length - 1]) stops.push(x)
      }
    })
    return stops
  }

  it('is laid out as the tests assume', () => {
    const l = wide()
    expect(l.cell).toBe(10)
    expect(l.maxScrollX).toBe(600)
    expect(followMargin(l)).toBe(30)
  })

  it('maps working order to image columns, mirrored on right-to-left rows', () => {
    expect(placeColumn(100, at(1, 0, 'LTR'))).toBe(10)
    expect(placeColumn(100, at(1, 0, 'RTL'))).toBe(89)
    expect(placeColumn(100, at(1, 3, 'LTR'))).toBe(13)
    expect(placeColumn(100, at(1, 3, 'RTL'))).toBe(86)
    // Out of range clamps: the last segment's last stitch, the first segment's first.
    expect(placeColumn(100, at(99, 99, 'LTR'))).toBe(99)
    expect(placeColumn(100, at(-1, -1, 'RTL'))).toBe(99)
    expect(placeColumn(100, at(0, 0, 'LTR', []))).toBeNull()
  })

  it('lands on the segment’s own colour, straight from encodeRow', () => {
    const cells = Uint16Array.from([0, 0, 1, 1, 1, 2])
    for (const start_direction of ['LTR', 'RTL'] as const) {
      const p = { rows: 1, cols: 6, cells, start_direction, alternate_direction: true, bottom_up: true } as Pattern
      const runs = encodeRow(p, 0)
      expect(runs.map((r) => r.palette_index)).toEqual(start_direction === 'LTR' ? [0, 1, 2] : [2, 1, 0])
      runs.forEach((run, i) => {
        for (let s = 0; s < run.count; s++) {
          const col = placeColumn(6, { runs, runIndex: i, stitches: s, direction: start_direction })!
          expect(cells[col]).toBe(run.palette_index)
        }
      })
    }
  })

  it('starts a left-to-right row at the left edge', () => {
    expect(followCurrentX(wide(), at(0, 0, 'LTR'), 600)).toBe(0)
    expect(followCurrentX(wide(), at(0, 0, 'LTR'), 5)).toBe(0)
  })

  it('starts a right-to-left row at the right edge', () => {
    expect(followCurrentX(wide(), at(0, 0, 'RTL'), 0)).toBe(600)
    expect(followCurrentX(wide(), at(0, 0, 'RTL'), 590)).toBe(600)
  })

  it('stays put while your place is comfortably in view', () => {
    const l = wide()
    expect(followCurrentX(l, at(3, 0, 'LTR'), 0)).toBe(0) // x 300..310
    expect(followCurrentX(l, at(3, 5, 'LTR'), 0)).toBe(0)
    expect(followCurrentX(l, at(5, 0, 'LTR'), 340)).toBe(340)
    expect(followCurrentX(l, at(3, 0, 'RTL'), 600)).toBe(600) // col 69, x 690..700
    expect(followCurrentX(l, at(5, 0, 'RTL'), 250)).toBe(250) // col 49, x 490..500
  })

  it('works a left-to-right row a view at a time, ending at the right edge', () => {
    // Your place nears the right (col 37 at x 370), so it goes a margin in from the left;
    // then the last move stops at the right edge. Two moves in 100 stitches.
    expect(workRow(wide(), 'LTR')).toEqual([0, 340, 600])
  })

  it('works a right-to-left row a view at a time, ending at the left edge', () => {
    // Mirrored: col 62 at x 620..630 nears the left of 600, so it goes a margin in from
    // the right (630 + 30 - 400 = 260); then the left edge.
    expect(workRow(wide(), 'RTL')).toEqual([600, 260, 0])
  })

  it('moves by partial stitches, not only by segments', () => {
    const l = wide()
    // Segment 3 starts at x 300, in view; 9 stitches in, x 390..400 is past the margin.
    expect(followCurrentX(l, at(3, 6, 'LTR'), 0)).toBe(0)
    expect(followCurrentX(l, at(3, 9, 'LTR'), 0)).toBe(390 - 30)
    // Right to left, segment 3 starts at col 69 and its stitches go left: 6 in is col 63,
    // x 630, just clear of the margin; 7 in is col 62, x 620..630, not.
    expect(followCurrentX(l, at(3, 6, 'RTL'), 600)).toBe(600)
    expect(followCurrentX(l, at(3, 7, 'RTL'), 600)).toBe(630 + 30 - 400)
  })

  it('shows where the rest of a segment wider than the view starts', () => {
    const l = wide()
    const runs = [
      { start_col: 0, count: 5 },
      { start_col: 5, count: 80 },
      { start_col: 85, count: 15 },
    ]
    // Left to right, 50 into the long segment: col 55, a margin in from the left.
    expect(followCurrentX(l, at(1, 50, 'LTR', runs), 0)).toBe(550 - 30)
    // Right to left: col 99 - 55 = 44, x 440..450, a margin in from the right.
    expect(followCurrentX(l, at(1, 50, 'RTL', runs), 600)).toBe(450 + 30 - 400)
    // Its first stitch, just past the short first segment, is still in view.
    expect(followCurrentX(l, at(1, 0, 'LTR', runs), 0)).toBe(0)
    expect(followCurrentX(l, at(1, 0, 'RTL', runs), 600)).toBe(600)
    // And every stitch of the row stays in view.
    expect(workRow(l, 'LTR', runs)).toEqual([0, 340, 600])
    expect(workRow(l, 'RTL', runs)).toEqual([600, 260, 0])
  })

  it('brings your place back after a scroll by hand', () => {
    const l = wide()
    // Scrolled to the far side of where you are.
    expect(followCurrentX(l, at(2, 0, 'LTR'), 600)).toBe(200 - 30)
    expect(followCurrentX(l, at(2, 0, 'RTL'), 0)).toBe(800 + 30 - 400) // col 79
    // Scrolled out of range: clamped first.
    expect(followCurrentX(l, at(3, 0, 'LTR'), -50)).toBe(0)
  })

  it('never moves a chart that fits across', () => {
    const fits = layout({ rows: 40, cols: 40 })
    const tall = layout({ rows: 200, cols: 40 }) // scrolls down, not across
    const row = [{ start_col: 0, count: 40 }]
    for (const l of [fits, tall]) {
      expect(l.maxScrollX).toBe(0)
      for (const d of ['LTR', 'RTL'] as const) {
        expect(followCurrentX(l, at(0, 0, d, row), 0)).toBe(0)
        expect(followCurrentX(l, at(0, 30, d, row), 0)).toBe(0)
      }
    }
  })

  it('only clamps without a current row or a place', () => {
    expect(followCurrentX(wide(), null, 250)).toBe(250)
    expect(followCurrentX(wide(), null, 900)).toBe(600)
    const finished = layout({ rows: 20, cols: 100, current: null, ...area(400, 200) })
    expect(followCurrentX(finished, at(5, 0, 'LTR'), 250)).toBe(250)
  })
})

describe('zoom', () => {
  it('scales the base cell size, so a fitted chart grows past its view and scrolls both ways', () => {
    const one = layout({ rows: 40, cols: 40 })
    const two = layout({ rows: 40, cols: 40, zoom: 2 })
    expect(one.cell).toBe(10)
    expect(two.cell).toBe(20)
    expect([two.maxScrollX, two.maxScrollY]).toEqual([400, 400])
    expect(two.mode).toBe(one.mode)
  })

  it('keeps per-row heights: the rows around the current one stay taller, and followed', () => {
    const z = layout({ rows: 40, cols: 40, current: 20, emphasise: true, zoom: 3 })
    const base = layout({ rows: 40, cols: 40, current: 20, emphasise: true })
    expect(z.heights[20]).toBe(Math.round(z.cell * EMPHASIS_SCALE)) // on whole device pixels
    expect(z.heights[0]).toBe(z.cell)
    expect(z.cell).toBeCloseTo(base.cell * 3, 0)
    const span = rowSpan(z, 20)!
    expect(followCurrent(z, 0)).toBeCloseTo((span.top + span.bottom) / 2 - z.viewHeight / 2)
  })

  it('lets a chart that fits across at 1× scroll across, and follows your place there', () => {
    const z = layout({ rows: 40, cols: 40, current: 0, zoom: 4 })
    expect(z.maxScrollX).toBeGreaterThan(0)
    const row = [{ start_col: 0, count: 40 }]
    expect(followCurrentX(z, { runs: row, runIndex: 0, stitches: 35, direction: 'LTR' }, 0)).toBeGreaterThan(0)
  })

  it('stays within 1× and 8×', () => {
    expect(layout({ rows: 40, cols: 40, zoom: 0.2 }).cell).toBe(10)
    expect(layout({ rows: 40, cols: 40, zoom: 50 }).cell).toBe(80)
    expect(layout({ rows: 40, cols: 40, zoom: Number.NaN }).cell).toBe(10)
  })
})
