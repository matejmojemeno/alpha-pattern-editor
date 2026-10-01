import { describe, expect, it } from 'vitest'

import { CARRY_MIN_ROW, DONE_STRIKE, DONE_WASH, GRID_COLOR, bands, carryEdge, cellPixels, drawChart, spotlightPixels, type CellImage } from '../../src/render/chart.ts'
import { AXIS_TOP, computeLayout, type RowPlace } from '../../src/render/layout.ts'
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
  const calls: { op: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown }[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key]
      return (...args: unknown[]) => calls.push({ op: key, args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle })
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

  it('edges a pale strand dark and a dark one pale', () => {
    expect(carryEdge('#ffffff')).toBe('#888888')
    expect(carryEdge('#000000')).toBe('#cccccc')
  })
})
