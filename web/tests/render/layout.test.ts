import { describe, expect, it } from 'vitest'

import {
  AXIS_LEFT,
  AXIS_TOP,
  EMPHASIS_SCALE,
  MIN_CELL,
  PAD,
  computeLayout,
  followCurrent,
  nearRows,
  rowHeight,
  rowInView,
  rowSpan,
  rowsInViewport,
  shouldScroll,
  showAxisNumber,
  visibleRows,
  yOffsets,
  type LayoutInput,
} from '../../src/render/layout.ts'

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
