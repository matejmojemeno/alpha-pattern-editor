/**
 * Moving the detected grid's outline: edges move in whole cells at the detected pitch.
 */
import { describe, expect, it } from 'vitest'

import { gridLines, mostCells, moveEdge, moveHandle, sameGrid, stepEdge, type Grid } from '../../src/importer/outline.ts'

// A 10 × 10 px lattice: 20 cols × 10 rows found at (100, 50)–(300, 150), in a 400 × 200 image.
const grid: Grid = { extent: { x0: 100, y0: 50, x1: 300, y1: 150 }, rows: 10, cols: 20 }
const bounds = { width: 400, height: 200 }

describe('moveEdge', () => {
  it('takes in whole columns on the right, snapping to the nearest gridline', () => {
    expect(moveEdge(grid, 'right', 334, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x1: 330 }, cols: 23 })
    expect(moveEdge(grid, 'right', 336, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x1: 340 }, cols: 24 })
  })

  it('takes in rows at the top, keeping the bottom where it is', () => {
    expect(moveEdge(grid, 'top', 18, bounds)).toEqual({ ...grid, extent: { ...grid.extent, y0: 20 }, rows: 13 })
  })

  it('leaves out rows and columns when dragged inward', () => {
    expect(moveEdge(grid, 'left', 151, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x0: 150 }, cols: 15 })
    expect(moveEdge(grid, 'bottom', 92, bounds)).toEqual({ ...grid, extent: { ...grid.extent, y1: 90 }, rows: 4 })
  })

  it('keeps at least one cell, even dragged past the opposite edge', () => {
    expect(moveEdge(grid, 'right', 20, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x1: 110 }, cols: 1 })
    expect(moveEdge(grid, 'top', 190, bounds)).toEqual({ ...grid, extent: { ...grid.extent, y0: 140 }, rows: 1 })
  })

  it('stops at the image: whole cells that fit, clamped to its last pixel', () => {
    // From x0 = 100 the image's last pixel is 299 px away: 29.9 cells, so 30 with the overhang.
    expect(moveEdge(grid, 'right', 5000, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x1: 399 }, cols: 30 })
    expect(moveEdge(grid, 'left', -500, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x0: 0 }, cols: 30 })
    // A cell that would hang well off the image isn't taken in.
    const off = { ...grid, extent: { ...grid.extent, x0: 105, x1: 305 } } // room: 294 px = 29.4 cells
    expect(moveEdge(off, 'right', 5000, bounds).cols).toBe(29)
  })

  it('keeps the pitch of a fractional lattice', () => {
    const g: Grid = { extent: { x0: 10.5, y0: 0, x1: 34.5, y1: 30 }, rows: 3, cols: 3 } // 8 px cells
    const moved = moveEdge(g, 'right', 60, { width: 100, height: 100 })
    expect(moved.cols).toBe(6)
    expect(moved.extent.x1).toBeCloseTo(58.5)
  })
})

describe('moveHandle', () => {
  it('moves one edge from an edge handle, whatever the other coordinate', () => {
    expect(moveHandle(grid, 'bottom', { x: 0, y: 171 }, bounds)).toEqual({ ...grid, extent: { ...grid.extent, y1: 170 }, rows: 12 })
  })

  it('moves both edges from a corner', () => {
    expect(moveHandle(grid, 'top-left', { x: 79, y: 31 }, bounds)).toEqual({
      extent: { x0: 80, y0: 30, x1: 300, y1: 150 },
      rows: 12,
      cols: 22,
    })
  })
})

describe('stepEdge', () => {
  it('moves an edge one cell out or in', () => {
    expect(stepEdge(grid, 'left', 1, bounds)).toEqual({ ...grid, extent: { ...grid.extent, x0: 90 }, cols: 21 })
    expect(stepEdge(grid, 'bottom', -1, bounds)).toEqual({ ...grid, extent: { ...grid.extent, y1: 140 }, rows: 9 })
  })

  it('does nothing past the image or below one cell', () => {
    const edge = moveEdge(grid, 'top', -100, bounds)
    expect(sameGrid(stepEdge(edge, 'top', 1, bounds), edge)).toBe(true)
    const one = moveEdge(grid, 'right', 0, bounds)
    expect(sameGrid(stepEdge(one, 'right', -1, bounds), one)).toBe(true)
  })
})

describe('mostCells', () => {
  it('is how many cells an edge could take in', () => {
    expect(mostCells(grid, 'top', bounds)).toBe(15)
    expect(mostCells(grid, 'bottom', bounds)).toBe(15)
    expect(mostCells(grid, 'right', bounds)).toBe(30)
  })
})

describe('gridLines', () => {
  it('divides the extent evenly, as confirm.resample does', () => {
    const g: Grid = { extent: { x0: 0, y0: 10, x1: 30, y1: 30 }, rows: 2, cols: 3 }
    expect(gridLines(g)).toEqual({ rowLines: [10, 20, 30], colLines: [0, 10, 20, 30] })
  })
})
