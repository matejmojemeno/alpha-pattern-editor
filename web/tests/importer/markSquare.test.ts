/**
 * "Mark one square"'s geometry (importer/markSquare.ts): the zoomed view and the box.
 */
import { describe, expect, it } from 'vitest'

import {
  centreSquareAt,
  clampView,
  dragCorner,
  fitView,
  growSquare,
  MAX_SCALE,
  MIN_SQUARE,
  moveSquare,
  panBy,
  START_BOX,
  startSquare,
  startView,
  toImagePoint,
  toStage,
  zoomAbout,
} from '../../src/importer/markSquare.ts'

const image = { width: 1200, height: 800 }
const stage = { width: 600, height: 500 }

describe('fitView', () => {
  it('shows the whole image, centred', () => {
    expect(fitView(stage, image)).toEqual({ scale: 0.5, x: 0, y: 50 })
  })
  it('is harmless before the stage has a size', () => {
    expect(fitView({ width: 0, height: 0 }, image)).toEqual({ scale: 1, x: 0, y: 0 })
  })
})

describe('clampView', () => {
  it('keeps the scale between the whole image and MAX_SCALE', () => {
    expect(clampView({ scale: 0.1, x: 0, y: 0 }, stage, image).scale).toBe(0.5)
    expect(clampView({ scale: 999, x: 0, y: 0 }, stage, image).scale).toBe(MAX_SCALE)
  })
  it('lets an edge of the image come in as far as the middle of the stage, no further', () => {
    expect(clampView({ scale: 2, x: 100, y: 100 }, stage, image)).toEqual({ scale: 2, x: 100, y: 100 })
    expect(clampView({ scale: 2, x: 1000, y: 1000 }, stage, image)).toEqual({ scale: 2, x: 300, y: 250 })
    expect(clampView({ scale: 2, x: -5000, y: -5000 }, stage, image)).toEqual({ scale: 2, x: 300 - 2400, y: 250 - 1600 })
    // The whole image, smaller than the stage one way, the same.
    expect(clampView({ scale: 0.5, x: 0, y: 260 }, stage, image).y).toBe(250)
    expect(clampView({ scale: 0.5, x: 0, y: -160 }, stage, image).y).toBe(-150)
  })
})

describe('zoomAbout', () => {
  it('keeps the image point under `at` where it is', () => {
    const v = { scale: 1, x: -100, y: -50 }
    const at = { x: 250, y: 200 }
    const before = toImagePoint(at, v)
    const after = zoomAbout(v, 2, at, stage, image)
    expect(after.scale).toBe(2)
    const p = toStage(before, after)
    expect(p.x).toBeCloseTo(at.x, 9)
    expect(p.y).toBeCloseTo(at.y, 9)
  })
  it('keeps the point still through every notch as a small image grows past the stage', () => {
    // The case that drifted: a 223 × 239 chart, whole in a wide stage, zoomed in four
    // notches about a point near its left. Kept centred, or inside the stage, the image was
    // pushed at the second notch and the point ended up off the stage.
    const wide = { width: 1110, height: 516 }
    const chart = { width: 223, height: 239 }
    let v = fitView(wide, chart)
    const at = { x: 407.84, y: 76.66 }
    const p = toImagePoint(at, v)
    for (let i = 0; i < 4; i++) {
      v = zoomAbout(v, Math.exp(0.45), at, wide, chart)
      const q = toStage(p, v)
      expect(q.x).toBeCloseTo(at.x, 9)
      expect(q.y).toBeCloseTo(at.y, 9)
    }
    expect(chart.width * v.scale).toBeGreaterThan(wide.width)
  })
  it('stops at its limits', () => {
    expect(zoomAbout(fitView(stage, image), 0.5, { x: 0, y: 0 }, stage, image)).toEqual(fitView(stage, image))
    expect(zoomAbout({ scale: 30, x: 0, y: 0 }, 10, { x: 0, y: 0 }, stage, image).scale).toBe(MAX_SCALE)
  })
})

describe('panBy', () => {
  it('moves the view, kept on the image', () => {
    expect(panBy({ scale: 2, x: -100, y: -100 }, 30, -20, stage, image)).toEqual({ scale: 2, x: -70, y: -120 })
    expect(panBy({ scale: 2, x: 290, y: 0 }, 30, 0, stage, image).x).toBe(300)
  })
})

describe('startSquare', () => {
  it('is the middle square of the grid read', () => {
    const grid = { extent: { x0: 100, y0: 50, x1: 1100, y1: 750 }, cols: 10, rows: 7 }
    expect(startSquare(grid, image)).toEqual([600, 350, 700, 450])
  })
  it('is a twentieth of the shorter side, in the middle, with no grid', () => {
    expect(startSquare(null, image)).toEqual([580, 380, 620, 420])
  })
  it('ignores a grid whose squares are too small to be one', () => {
    const grid = { extent: { x0: 0, y0: 0, x1: 1200, y1: 800 }, cols: 1200, rows: 800 }
    expect(startSquare(grid, image)).toEqual(startSquare(null, image))
  })
})

describe('startView', () => {
  it('zooms so the square is START_BOX across, centred on it', () => {
    const square = [600, 350, 612, 362] as [number, number, number, number]
    const v = startView(square, stage, image)
    expect(v.scale).toBe(START_BOX / 12)
    const centre = toStage({ x: 606, y: 356 }, v)
    expect(centre.x).toBeCloseTo(300, 9)
    expect(centre.y).toBeCloseTo(250, 9)
  })
  it('centres a square in the image’s corner too, and keeps to the zoom limits', () => {
    const v = startView([0, 0, 1, 1], stage, image)
    expect(v).toEqual({ scale: MAX_SCALE, x: 300 - MAX_SCALE / 2, y: 250 - MAX_SCALE / 2 })
    expect(startView([0, 0, 1200, 800], stage, image)).toEqual(fitView(stage, image))
  })
})

describe('the box', () => {
  const square = [100, 100, 120, 120] as [number, number, number, number]
  it('moves, kept inside the image', () => {
    expect(moveSquare(square, 5.5, -3, image)).toEqual([105.5, 97, 125.5, 117])
    expect(moveSquare(square, -500, 5000, image)).toEqual([0, 780, 20, 800])
  })
  it('is centred on a tap', () => {
    expect(centreSquareAt(square, { x: 300, y: 200.5 }, image)).toEqual([290, 190.5, 310, 210.5])
    expect(centreSquareAt(square, { x: 1199, y: 1 }, image)).toEqual([1180, 0, 1200, 20])
  })
  it('resizes from a corner, the opposite one kept', () => {
    expect(dragCorner(square, 'top-left', { x: 90.25, y: 95 }, image)).toEqual([90.25, 95, 120, 120])
    expect(dragCorner(square, 'bottom-right', { x: 131, y: 140 }, image)).toEqual([100, 100, 131, 140])
    expect(dragCorner(square, 'top-right', { x: 150, y: 80 }, image)).toEqual([100, 80, 150, 120])
    expect(dragCorner(square, 'bottom-left', { x: 50, y: 130 }, image)).toEqual([50, 100, 120, 130])
  })
  it('never turns inside out or shrinks below MIN_SQUARE', () => {
    expect(dragCorner(square, 'top-left', { x: 500, y: 500 }, image)).toEqual([120 - MIN_SQUARE, 120 - MIN_SQUARE, 120, 120])
    expect(dragCorner(square, 'bottom-right', { x: 0, y: 0 }, image)).toEqual([100, 100, 100 + MIN_SQUARE, 100 + MIN_SQUARE])
  })
  it('stays inside the image when a corner is dragged off it', () => {
    expect(dragCorner(square, 'top-left', { x: -40, y: -1 }, image)).toEqual([0, 0, 120, 120])
    expect(dragCorner(square, 'bottom-right', { x: 5000, y: 5000 }, image)).toEqual([100, 100, 1200, 800])
  })
  it('grows and shrinks from its right and bottom edges', () => {
    expect(growSquare(square, 1, -1, image)).toEqual([100, 100, 121, 119])
    expect(growSquare(square, -100, 0, image)).toEqual([100, 100, 100 + MIN_SQUARE, 120])
  })
})
