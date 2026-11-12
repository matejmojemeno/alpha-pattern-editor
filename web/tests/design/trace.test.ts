/** Where the image to trace lies, and moving and resizing it (design/trace.ts). */
import { describe, expect, it } from 'vitest'

import { MIN_TRACE_CELLS, corners, fitTrace, handleAt, heightOf, moveTrace, resizeTrace, type Corner } from '../../src/design/trace.ts'

const wide = { iw: 400, ih: 200 }
const tall = { iw: 100, ih: 300 }

describe('fitTrace', () => {
  it('fits the whole image over the whole pattern, centred', () => {
    // 2:1 over 10 × 10: as wide as the pattern, half as tall, in the middle.
    expect(fitTrace(10, 10, wide)).toEqual({ x: 0, y: 2.5, width: 10 })
    // 1:3 over 30 × 12: as tall as the pattern.
    const t = fitTrace(30, 12, tall)
    expect(t.width).toBeCloseTo(4)
    expect(heightOf(t, tall)).toBeCloseTo(12)
    expect(t.x).toBeCloseTo(13)
    expect(t.y).toBeCloseTo(0)
  })

  it('treats an empty pattern as one cell', () => {
    expect(fitTrace(0, 0, wide)).toEqual({ x: 0, y: 0.25, width: 1 })
  })
})

describe('resizeTrace', () => {
  const p = { x: 2, y: 3, width: 8 } // 8 × 4 of a 2:1 image

  it('keeps the opposite corner and the shape, from every corner', () => {
    const cases: [Corner, number, number][] = [
      ['se', 14, 9], // further down than across: the height wins
      ['nw', -2, 1],
      ['ne', 20, 2],
      ['sw', 0, 20],
    ]
    for (const [corner, px, py] of cases) {
      const opposite = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[corner] as Corner
      const before = corners(p, wide)[opposite]
      const r = resizeTrace(p, wide, corner, px, py)
      const after = corners(r, wide)[opposite]
      expect(after.x, corner).toBeCloseTo(before.x)
      expect(after.y, corner).toBeCloseTo(before.y)
      expect(heightOf(r, wide) / r.width, corner).toBeCloseTo(0.5)
    }
  })

  it('follows the direction the pointer went further in', () => {
    // From the top-left corner (2, 3): 12 across but 10 down → 20 wide (10 tall).
    expect(resizeTrace(p, wide, 'se', 14, 13).width).toBeCloseTo(20)
    // 12 across, 1 down → 12 wide.
    expect(resizeTrace(p, wide, 'se', 14, 4).width).toBeCloseTo(12)
  })

  it('stops at the smallest size instead of turning inside out', () => {
    const r = resizeTrace(p, wide, 'se', -50, -50)
    expect(heightOf(r, wide)).toBeCloseTo(MIN_TRACE_CELLS)
    expect(r.x).toBe(2)
    expect(r.y).toBe(3)
    const t = resizeTrace({ x: 0, y: 0, width: 5 }, tall, 'nw', 99, 99)
    expect(t.width).toBeCloseTo(MIN_TRACE_CELLS)
  })
})

describe('handleAt and moveTrace', () => {
  const p = { x: 0, y: 0, width: 10 } // 10 × 5

  it('finds the corner within reach, and nothing in the middle', () => {
    expect(handleAt(p, wide, 0.2, -0.1, 0.5)).toBe('nw')
    expect(handleAt(p, wide, 10.3, 5.2, 0.5)).toBe('se')
    expect(handleAt(p, wide, 9.8, 0, 0.5)).toBe('ne')
    expect(handleAt(p, wide, 5, 2.5, 0.5)).toBeNull()
    expect(handleAt(p, wide, 1, 0, 0.5)).toBeNull()
  })

  it('picks the nearer corner on a tiny image', () => {
    const tiny = { x: 0, y: 0, width: 0.4 }
    expect(handleAt(tiny, wide, 0.35, 0.18, 1)).toBe('se')
  })

  it('moves by whole and part cells', () => {
    expect(moveTrace(p, 1.5, -2)).toEqual({ x: 1.5, y: -2, width: 10 })
  })
})
