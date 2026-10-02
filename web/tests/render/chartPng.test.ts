import { describe, expect, it } from 'vitest'

import { AXIS_LEFT, AXIS_TOP, PAD } from '../../src/render/layout.ts'
import {
  CHART_PNG_CELL,
  CHART_PNG_MAX_AREA,
  CHART_PNG_MIN_CELL,
  chartPngCell,
  chartPngLayout,
} from '../../src/render/chartPng.ts'

describe('chartPngLayout', () => {
  it('lays out every row, all the same height, with no current row', () => {
    for (const [rows, cols] of [
      [30, 30],
      [5, 120], // wide
      [194, 88], // tall: would scroll in the Work stage
      [1, 1],
    ] as const) {
      const { layout, width, height } = chartPngLayout(rows, cols)
      expect(layout.cell).toBe(CHART_PNG_CELL)
      expect(layout.current).toBeNull()
      expect(layout.range).toEqual({ start: 0, end: rows })
      expect(layout.near).toEqual({ start: 0, end: 0 })
      expect(new Set(layout.heights)).toEqual(new Set([CHART_PNG_CELL]))
      expect(layout.gridWidth).toBe(cols * CHART_PNG_CELL)
      expect(layout.gridHeight).toBe(rows * CHART_PNG_CELL)
      expect([layout.maxScrollX, layout.maxScrollY]).toEqual([0, 0])
      expect([width, height]).toEqual([AXIS_LEFT + PAD + cols * CHART_PNG_CELL, AXIS_TOP + PAD + rows * CHART_PNG_CELL])
    }
  })
})

describe('chartPngCell', () => {
  it('keeps the full cell while the picture fits, and shrinks a huge chart to fit', () => {
    expect(chartPngCell(100, 100)).toBe(CHART_PNG_CELL)
    const area = (rows: number, cols: number, c: number) => (AXIS_LEFT + PAD + cols * c) * (AXIS_TOP + PAD + rows * c)
    for (const [rows, cols] of [
      [200, 200],
      [300, 150],
      [400, 400],
    ] as const) {
      const c = chartPngCell(rows, cols)
      expect(c).toBeLessThan(CHART_PNG_CELL)
      expect(area(rows, cols, c)).toBeLessThanOrEqual(CHART_PNG_MAX_AREA)
      // The biggest that fits.
      expect(area(rows, cols, c + 1)).toBeGreaterThan(CHART_PNG_MAX_AREA)
    }
    // Never below the minimum, even if that's over.
    expect(chartPngCell(2000, 2000)).toBe(CHART_PNG_MIN_CELL)
  })
})
