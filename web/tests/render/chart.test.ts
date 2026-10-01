import { describe, expect, it } from 'vitest'

import {
  CARRY_MIN_ROW,
  DONE_STRIKE,
  DONE_WASH,
  GRID_COLOR,
  NUMBER_MIN_FONT,
  bands,
  carryStrip,
  carryEdge,
  cellPixels,
  drawChart,
  numberFont,
  spotlightPixels,
  stitchNumbers,
  type CellImage,
} from '../../src/render/chart.ts'
import { AXIS_LEFT, AXIS_TOP, computeLayout, type RowPlace } from '../../src/render/layout.ts'
import { SKIP_INDEX, type Pattern } from '../../src/model/types.ts'

function pattern(rows: number, cols: number, cells?: number[]): Pattern {
  return {
    id: 'p',
    name: 'p',
    created_at: 0,
    updated_at: 0,
    rows,
    cols,
    row_ids: Array.from({ length: rows }, (_, i) => `r${i}`),
    cells: Uint16Array.from(cells ?? Array.from({ length: rows * cols }, (_, i) => i % 2)),
    palette: [
      { id: 'a', hex: '#ff0000', name: 'Red', dmc: null, count: 0 },
      { id: 'b', hex: '#00ff00', name: 'Green', dmc: null, count: 0 },
    ],
    start_direction: 'RTL',
    alternate_direction: true,
    bottom_up: true,
    craft: 'tapestry',
  }
}

describe('cellPixels', () => {
  it('is one RGBA pixel per cell from the palette, grey for skipped or unknown cells', () => {
    const px = cellPixels(pattern(1, 4, [0, 1, SKIP_INDEX, 7]))
    expect([...px]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 200, 200, 200, 255, 200, 200, 200, 255])
  })
})

describe('spotlightPixels', () => {
  it('keeps one colour’s cells and fades the rest: to light behind a dark colour, dark behind a light one', () => {
    const p = pattern(1, 2, [0, 1])
    // Red is dark (luma 54): green fades 80% towards light grey.
    expect([...spotlightPixels(p, 0)]).toEqual([255, 0, 0, 255, 189, 240, 189, 255])
    // Green is light (luma 182): red fades 80% towards dark grey.
    expect([...spotlightPixels(p, 1)]).toEqual([89, 38, 38, 255, 0, 255, 0, 255])
    // No such colour: unchanged.
    expect([...spotlightPixels(p, 5)]).toEqual([...cellPixels(p)])
  })
})

describe('stitchNumbers', () => {
  // One row: Red Red Red Green Green Red Red Red Red, as image columns.
  const row = [0, 0, 0, 1, 1, 0, 0, 0, 0]
  const one = (over: Partial<Pattern>) => ({ ...pattern(1, 9, row), ...over })

  it('counts each run of one colour from 1, left to right on a left-to-right row', () => {
    expect([...stitchNumbers(one({ start_direction: 'LTR' }), 0)]).toEqual([1, 2, 3, 1, 2, 1, 2, 3, 4])
  })

  it('counts from the right on a right-to-left row', () => {
    expect([...stitchNumbers(one({ start_direction: 'RTL' }), 0)]).toEqual([3, 2, 1, 2, 1, 4, 3, 2, 1])
  })

  it('follows each row’s own direction when rows turn, and leaves skipped cells unnumbered', () => {
    // bottom_up, starting from the right: image row 1 is worked first (right to left),
    // image row 0 second (left to right).
    const p = pattern(2, 4, [0, 0, SKIP_INDEX, 1, 1, 0, 0, 0])
    expect([...stitchNumbers(p, 1)]).toEqual([1, 3, 2, 1])
    expect([...stitchNumbers(p, 0)]).toEqual([1, 2, 0, 1])
  })
})

describe('numberFont', () => {
  it('shrinks with the digits, and gives up below the smallest readable size', () => {
    expect(numberFont(24, 24, 1)).toBe(14)
    expect(numberFont(24, 24, 2)).toBe(14)
    expect(numberFont(24, 24, 3)).toBe(11)
    expect(numberFont(10, 24, 1)).toBe(14)
    expect(numberFont(10, 24, 2)).toBe(0)
    expect(numberFont(24, 12, 1)).toBe(0)
    expect(numberFont(100, 100, 1)).toBe(16)
    expect(numberFont(24, 14, 1)).toBeGreaterThanOrEqual(NUMBER_MIN_FONT)
  })
})

describe('bands', () => {
  it('groups consecutive rows of equal height', () => {
    expect(bands([5, 5, 8, 8, 8, 5, 5], 0, 7)).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 3 },
      { start: 5, count: 2 },
    ])
    expect(bands([5, 5, 8, 8, 8, 5, 5], 1, 3)).toEqual([
      { start: 1, count: 1 },
      { start: 2, count: 1 },
    ])
  })
})

/** A 2D context that records what is drawn. */
function recorder() {
  const calls: { op: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown; font: unknown }[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key]
      return (...args: unknown[]) => calls.push({ op: key, args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle, font: target.font })
    },
    set(target, key: string, v) {
      target[key] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const colors = { background: '#fff', text: '#111', axis: '#777', accent: '#f0a800', fontFamily: 'sans-serif' }

describe('drawChart', () => {
  it('copies the cells in a few bands, then draws lines, done rows and the current row over them', () => {
    const p = pattern(200, 40)
    const layout = computeLayout({ rows: 200, cols: 40, current: 100, emphasise: true, focus: false, width: 440, height: 428 })
    const { ctx, calls } = recorder()
    drawChart(ctx, {
      layout,
      image: {} as CellImage,
      pattern: p,
      completed: new Set([101, 102]),
      scrollX: 0,
      scrollY: 800,
      width: 440,
      height: 428,
      dpr: 1,
      colors,
    })
    const images = calls.filter((c) => c.op === 'drawImage')
    // Plain rows above, the five emphasised rows, plain rows below.
    expect(images).toHaveLength(3)
    expect(calls.filter((c) => c.op === 'fillRect' && c.fillStyle === DONE_WASH)).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'fillRect' && c.fillStyle === DONE_STRIKE)).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'fill' && c.fillStyle === GRID_COLOR)).toHaveLength(1)
    expect(calls.filter((c) => c.op === 'strokeRect' && c.strokeStyle === colors.accent)).toHaveLength(1)
    // Never a fillRect per cell.
    expect(calls.filter((c) => c.op === 'fillRect').length).toBeLessThan(10)
  })

  it('washes the part of the current row already worked, and nothing when none is', () => {
    const p = pattern(10, 10)
    const layout = computeLayout({ rows: 10, cols: 10, current: 9, emphasise: false, focus: false, width: 240, height: 228 })
    const draw = (place: RowPlace | null, completed = new Set<number>()) => {
      const { ctx, calls } = recorder()
      drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed, place, scrollX: 0, scrollY: 0, width: 240, height: 228, dpr: 1, colors })
      return calls.filter((c) => c.op === 'fillRect' && c.fillStyle === DONE_WASH)
    }
    const runs = [{ start_col: 0, count: 4 }, { start_col: 4, count: 6 }]
    const ltr = draw({ runs, runIndex: 1, stitches: 2, direction: 'LTR' })
    expect(ltr).toHaveLength(1)
    const [x, , w] = ltr[0]!.args as number[]
    expect(w).toBeCloseTo(6 * layout.cell)
    const rtl = draw({ runs, runIndex: 1, stitches: 2, direction: 'RTL' })
    expect((rtl[0]!.args as number[])[0]).toBeCloseTo(x! + 4 * layout.cell)
    expect(draw({ runs, runIndex: 0, stitches: 0, direction: 'LTR' })).toHaveLength(0)
    // A current row already marked done is washed once, whole.
    expect(draw({ runs, runIndex: 1, stitches: 2, direction: 'LTR' }, new Set([9]))).toHaveLength(1)
  })

  it('numbers rows in working order', () => {
    const p = pattern(10, 10)
    const layout = computeLayout({ rows: 10, cols: 10, current: 9, emphasise: false, focus: false, width: 240, height: 228 })
    const { ctx, calls } = recorder()
    drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set(), scrollX: 0, scrollY: 0, width: 240, height: 228, dpr: 1, colors })
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])
    // bottom_up: the top image row is the last worked. The current row (here row 1, at
    // the bottom) is drawn last, over the rest.
    expect(texts.slice(0, 10)).toEqual(['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'])
    // Column numbers 1..10 along the top.
    expect(texts.slice(-10)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
  })

  it('draws each carried strand along the middle of its stitches, stacked by colour, under the done wash', () => {
    const p = pattern(10, 10)
    const layout = computeLayout({ rows: 10, cols: 10, current: 9, emphasise: false, focus: false, width: 240, height: 228 })
    expect(layout.heights[4]).toBeGreaterThanOrEqual(CARRY_MIN_ROW)
    const carries = Array.from({ length: 10 }, () => [] as { palette_index: number; from: number; to: number; kind: 'on' | 'pickup' }[])
    carries[4] = [
      { palette_index: 0, from: 2, to: 5, kind: 'on' },
      { palette_index: 1, from: 3, to: 4, kind: 'pickup' },
    ]
    const { ctx, calls } = recorder()
    drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set([4]), carries, scrollX: 0, scrollY: 0, width: 240, height: 228, dpr: 1, colors })
    const fills = calls.filter((c) => c.op === 'fillRect')
    const red = fills.filter((c) => c.fillStyle === '#ff0000').map((c) => c.args as number[])
    const green = fills.filter((c) => c.fillStyle === '#00ff00').map((c) => c.args as number[])
    expect(red).toHaveLength(1)
    expect(green).toHaveLength(1)
    // Across exactly the carried columns.
    expect(red[0]![2]).toBeCloseTo(3 * layout.cell)
    expect(green[0]![0]! - red[0]![0]!).toBeCloseTo(layout.cell)
    // Two lanes, either side of the row's middle, inside the row.
    const y = layout.offsets[4]! + AXIS_TOP
    const mid = y + layout.heights[4]! / 2
    expect(red[0]![1]! + red[0]![3]!).toBeLessThanOrEqual(mid + 1)
    expect(green[0]![1]!).toBeGreaterThanOrEqual(mid - 1)
    expect(red[0]![1]!).toBeGreaterThan(y)
    expect(green[0]![1]! + green[0]![3]!).toBeLessThan(y + layout.heights[4]!)
    // Each on its edge (both pale enough for the dark one), all before the done wash
    // that fades a finished row.
    expect(fills.filter((c) => c.fillStyle === carryEdge('#ff0000'))).toHaveLength(2)
    const wash = calls.findIndex((c) => c.op === 'fillRect' && c.fillStyle === DONE_WASH)
    expect(calls.findIndex((c) => c.fillStyle === '#00ff00')).toBeLessThan(wash)
  })

  it('draws no strands on rows too short to show them, or when none are given', () => {
    // A small fitted chart: plain rows ~4 px, the five around the current one taller.
    const p = pattern(50, 40)
    const layout = computeLayout({ rows: 50, cols: 40, current: 25, emphasise: true, focus: false, width: 200, height: 400 })
    const tall = layout.heights.filter((h) => h >= CARRY_MIN_ROW).length
    expect(tall).toBeGreaterThan(0)
    expect(tall).toBeLessThan(50)
    const carries = Array.from({ length: 50 }, () => [{ palette_index: 0, from: 0, to: 40, kind: 'on' as const }])
    const draw = (given: typeof carries | null) => {
      const { ctx, calls } = recorder()
      drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set(), carries: given, scrollX: 0, scrollY: 0, width: 200, height: 400, dpr: 1, colors })
      return calls.filter((c) => c.op === 'fillRect' && c.fillStyle === '#ff0000')
    }
    expect(draw(carries)).toHaveLength(tall)
    expect(draw(null)).toHaveLength(0)
  })

  it('numbers the stitches only when asked, in black or white for the stitch, under the done wash', () => {
    const p = { ...pattern(2, 4, [0, 0, 1, 1, 1, 0, 0, 0]), palette: [
      { id: 'a', hex: '#ffffff', name: 'White', dmc: null, count: 0 },
      { id: 'b', hex: '#000000', name: 'Black', dmc: null, count: 0 },
    ] }
    const layout = computeLayout({ rows: 2, cols: 4, current: 1, emphasise: false, focus: false, width: 240, height: 228 })
    expect(numberFont(layout.cell, layout.heights[0]!, 1)).toBeGreaterThan(0)
    const draw = (numbers: boolean) => {
      const { ctx, calls } = recorder()
      drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set([0]), numbers, scrollX: 0, scrollY: 0, width: 240, height: 228, dpr: 1, colors })
      return calls
    }
    const ink = (calls: ReturnType<typeof draw>) =>
      calls.filter((c) => c.op === 'fillText' && (c.fillStyle === '#000000' || c.fillStyle === '#ffffff')).map((c) => [c.args[0], c.fillStyle])
    expect(ink(draw(false))).toEqual([])
    const calls = draw(true)
    // Image row 0 is worked second, left to right; row 1 first, right to left.
    expect(ink(calls)).toEqual([
      ['1', '#000000'],
      ['2', '#000000'],
      ['1', '#ffffff'],
      ['2', '#ffffff'],
      ['1', '#ffffff'],
      ['3', '#000000'],
      ['2', '#000000'],
      ['1', '#000000'],
    ])
    const wash = calls.findIndex((c) => c.op === 'fillRect' && c.fillStyle === DONE_WASH)
    const lastNumber = calls.findLastIndex((c) => c.op === 'fillText' && (c.fillStyle === '#000000' || c.fillStyle === '#ffffff'))
    expect(lastNumber).toBeLessThan(wash)
  })

  it('gives a row’s numbers one size, set by its longest, unless that one can’t fit', () => {
    // Each row 12 red stitches in one run. The current row, drawn taller, has room for a
    // bigger single digit than for 10, but 1..9 and 10..12 are drawn at the same size.
    const p = pattern(10, 12, Array.from({ length: 120 }, () => 0))
    const layout = computeLayout({ rows: 10, cols: 12, current: 5, emphasise: true, focus: false, width: 200, height: 400 })
    const h = layout.heights[5 - layout.range.start]!
    const two = numberFont(layout.cell, h, 2)
    expect(two).toBeGreaterThan(0)
    expect(two).toBeLessThan(numberFont(layout.cell, h, 1))
    const { ctx, calls } = recorder()
    drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set(), numbers: true, scrollX: 0, scrollY: 0, width: 200, height: 400, dpr: 1, colors })
    const ink = calls.filter((c) => c.op === 'fillText' && c.fillStyle === '#ffffff')
    const mid = AXIS_TOP + layout.offsets[5 - layout.range.start]! + h / 2
    const current = ink.filter((c) => Math.abs((c.args[2] as number) - mid) < 0.01)
    expect(current).toHaveLength(12)
    expect(new Set(current.map((c) => c.font))).toEqual(new Set([`${two}px sans-serif`]))
  })

  it('in a numbered row, lays the strands along the foot of the stitches, under numbers of the usual size', () => {
    const p = pattern(10, 10, Array.from({ length: 100 }, () => 0))
    const layout = computeLayout({ rows: 10, cols: 10, current: 9, emphasise: false, focus: false, width: 240, height: 228 })
    const h = layout.heights[4]!
    const carries = Array.from({ length: 10 }, () => [] as { palette_index: number; from: number; to: number; kind: 'on' | 'pickup' }[])
    carries[4] = [{ palette_index: 1, from: 2, to: 5, kind: 'on' }]
    const draw = (numbers: boolean) => {
      const { ctx, calls } = recorder()
      drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set(), carries, numbers, scrollX: 0, scrollY: 0, width: 240, height: 228, dpr: 1, colors })
      return calls
    }
    const rowTop = AXIS_TOP + layout.offsets[4]!
    const strand = (calls: ReturnType<typeof draw>) => calls.find((c) => c.op === 'fillRect' && c.fillStyle === '#00ff00')!.args as number[]

    // Without numbers: through the middle, as before.
    const [, my, , mt] = strand(draw(false))
    expect(my! + mt! / 2).toBeCloseTo(rowTop + h / 2, 0)

    // With them: in the strip at the bottom, and the row's numbers centred above it.
    const calls = draw(true)
    const { thickness, height } = carryStrip(h, 1)
    const [, y, , t] = strand(calls)
    expect(t).toBe(thickness)
    // Its lower edge ends a pixel short of the gridline under the row.
    expect(y! + t! + 1).toBeCloseTo(rowTop + h - 1, 0)
    const row4 = calls.filter((c) => c.op === 'fillText' && c.fillStyle === '#ffffff' && (c.args[2] as number) < rowTop + h && (c.args[2] as number) > rowTop)
    expect(row4).toHaveLength(10)
    for (const c of row4) expect(c.args[2]).toBeCloseTo(rowTop + (h - height) / 2)
    // The same size as a row with no strands, and the digits clear the strip.
    const fs = numberFont(layout.cell, h, 1)
    expect(new Set(row4.map((c) => c.font))).toEqual(new Set([`${fs}px sans-serif`]))
    expect(rowTop + (h - height) / 2 + (0.75 * fs) / 2).toBeLessThanOrEqual(y! - 1)
  })

  it('leaves the number off a stitch whose strand has to stay in the middle', () => {
    // A 14 px row with three strands: no room at the foot.
    const p = pattern(1, 4, [0, 0, 0, 0])
    const layout = { ...computeLayout({ rows: 1, cols: 4, current: 0, emphasise: false, focus: false, width: 200, height: 228 }) }
    const l = { ...layout, cell: 24, heights: [14], offsets: [0, 14], gridWidth: 96, gridHeight: 14 }
    const carries = [[0, 1, 2].map((k) => ({ palette_index: k, from: 1, to: 3, kind: 'on' as const }))]
    const { ctx, calls } = recorder()
    drawChart(ctx, { layout: l, image: {} as CellImage, pattern: p, completed: new Set(), carries, numbers: true, scrollX: 0, scrollY: 0, width: 200, height: 228, dpr: 1, colors })
    const xs = calls.filter((c) => c.op === 'fillText' && c.fillStyle === '#ffffff').map((c) => c.args[1])
    expect(xs).toEqual([AXIS_LEFT + 12, AXIS_LEFT + 3 * 24 + 12])
  })

  it('keeps the strands through the middle where a number wouldn’t clear them at the foot', () => {
    expect(numberFont(24, 24, 1, carryStrip(24, 1).height)).toBe(numberFont(24, 24, 1))
    // Three strands at once in a 14 px row: no room above them.
    expect(numberFont(24, 14, 1, carryStrip(14, 3).height)).toBe(0)
    expect(numberFont(24, 14, 1, carryStrip(14, 1).height)).toBeGreaterThanOrEqual(NUMBER_MIN_FONT)
  })

  it('draws no stitch numbers where the cells are too small to hold one', () => {
    const p = pattern(50, 120)
    const layout = computeLayout({ rows: 50, cols: 120, current: 25, emphasise: false, focus: false, width: 600, height: 400 })
    expect(numberFont(layout.cell, Math.max(...layout.heights), 1)).toBe(0)
    const { ctx, calls } = recorder()
    drawChart(ctx, { layout, image: {} as CellImage, pattern: p, completed: new Set(), numbers: true, scrollX: 0, scrollY: 0, width: 600, height: 400, dpr: 1, colors })
    expect(calls.filter((c) => c.op === 'fillText' && (c.fillStyle === '#000000' || c.fillStyle === '#ffffff'))).toHaveLength(0)
  })

  it('edges a pale strand dark and a dark one pale', () => {
    expect(carryEdge('#ffffff')).toBe('#888888')
    expect(carryEdge('#000000')).toBe('#cccccc')
  })
})
