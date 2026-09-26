/** The Design canvas's geometry: which cell a pointer is over, zoom, fit. */
import { describe, expect, it } from 'vitest'

import {
  AXIS_LEFT,
  AXIS_TOP,
  MAX_FIT,
  MAX_ZOOM,
  MIN_ZOOM,
  PAD,
  cellAt,
  contentSize,
  fitCell,
  showNumber,
  visibleCells,
  zoomScroll,
  zoomStep,
} from '../../src/render/design.ts'
import { newPattern } from '../../src/logic/edit.ts'

describe('cellAt', () => {
  const v = { cell: 10, rows: 5, cols: 8, scrollX: 0, scrollY: 0 }
  it('maps a point to its cell, past the axis margins', () => {
    expect(cellAt(AXIS_LEFT, AXIS_TOP, v)).toEqual({ r: 0, c: 0 })
    expect(cellAt(AXIS_LEFT + 79.9, AXIS_TOP + 49.9, v)).toEqual({ r: 4, c: 7 })
    expect(cellAt(AXIS_LEFT + 25, AXIS_TOP + 15, v)).toEqual({ r: 1, c: 2 })
  })
  it('is null over the margins and past the grid', () => {
    expect(cellAt(AXIS_LEFT - 1, AXIS_TOP + 5, v)).toBeNull()
    expect(cellAt(AXIS_LEFT + 5, AXIS_TOP - 1, v)).toBeNull()
    expect(cellAt(AXIS_LEFT + 80, AXIS_TOP, v)).toBeNull()
    expect(cellAt(AXIS_LEFT, AXIS_TOP + 50, v)).toBeNull()
  })
  it('follows the scroll position', () => {
    expect(cellAt(AXIS_LEFT + 5, AXIS_TOP + 5, { ...v, scrollX: 30, scrollY: 20 })).toEqual({ r: 2, c: 3 })
  })
  it('clamps to the nearest cell during a drag', () => {
    expect(cellAt(0, 0, v, true)).toEqual({ r: 0, c: 0 })
    expect(cellAt(9999, 9999, v, true)).toEqual({ r: 4, c: 7 })
    expect(cellAt(AXIS_LEFT + 35, -50, v, true)).toEqual({ r: 0, c: 3 })
  })
})

describe('zoom', () => {
  it('steps through the ladder and stops at its ends', () => {
    expect(zoomStep(16, 1)).toBe(20)
    expect(zoomStep(16, -1)).toBe(14)
    expect(zoomStep(17, -1)).toBe(16) // a fitted size between steps goes to the next one
    expect(zoomStep(17, 1)).toBe(20)
    expect(zoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(zoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('fits the whole pattern to the view, within limits', () => {
    const w = AXIS_LEFT + PAD
    const h = AXIS_TOP + PAD
    expect(fitCell(200, 200, w + 800, h + 600)).toBe(3)
    expect(fitCell(40, 40, w + 800, h + 600)).toBe(15)
    expect(fitCell(2, 2, w + 800, h + 600)).toBe(MAX_FIT)
    expect(fitCell(999, 999, w + 800, h + 600)).toBe(MIN_ZOOM)
    const size = contentSize(40, 40, 15)
    expect(size.width).toBeLessThanOrEqual(w + 800)
    expect(size.height).toBeLessThanOrEqual(h + 600)
  })

  it('keeps the point under the pointer still', () => {
    const x = AXIS_LEFT + 57
    const y = AXIS_TOP + 33
    const s = zoomScroll(x, y, 10, 20, 100, 40)
    // The grid point under the pointer: before, (57 + 100) / 10 cells across.
    expect((x - AXIS_LEFT + s.left) / 20).toBeCloseTo((57 + 100) / 10)
    expect((y - AXIS_TOP + s.top) / 20).toBeCloseTo((33 + 40) / 10)
    expect(zoomScroll(x, y, 20, 2, 0, 0)).toEqual({ left: 0, top: 0 })
  })
})

it('draws only the cells in view', () => {
  const pattern = newPattern(200, 200, '#ffffff')
  expect(visibleCells({ pattern, cell: 10, scrollX: 95, scrollY: 0, width: AXIS_LEFT + 300, height: AXIS_TOP + 200 })).toEqual(
    { r0: 0, r1: 20, c0: 9, c1: 40 },
  )
})

it('numbers every cell on small charts, every 5th or 10th on large ones', () => {
  expect([1, 2, 3].map((n) => showNumber(n, 10, 20, 10))).toEqual([true, true, true])
  expect([1, 2, 5, 10].map((n) => showNumber(n, 40, 10, 10))).toEqual([true, false, true, true])
  expect([1, 5, 10].map((n) => showNumber(n, 200, 3, 8))).toEqual([true, false, true])
})
