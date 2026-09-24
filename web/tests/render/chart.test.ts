import { describe, expect, it } from 'vitest'

import { DONE_STRIKE, DONE_WASH, GRID_COLOR, bands, cellPixels, drawChart, type CellImage } from '../../src/render/chart.ts'
import { computeLayout } from '../../src/render/layout.ts'
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
  }
}

describe('cellPixels', () => {
  it('is one RGBA pixel per cell from the palette, grey for skipped or unknown cells', () => {
    const px = cellPixels(pattern(1, 4, [0, 1, SKIP_INDEX, 7]))
    expect([...px]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 200, 200, 200, 255, 200, 200, 200, 255])
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
})
