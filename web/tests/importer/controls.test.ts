import { describe, expect, it } from 'vitest'

import {
  cellSize,
  DEFAULT_DELTA_E,
  deltaEFromSlider,
  MAX_DELTA_E,
  MIN_DELTA_E,
  shrinkNotice,
  sliderFromDeltaE,
} from '../../src/importer/controls.ts'

describe('the colour-detail slider', () => {
  it('runs opposite to ΔE over 2–15: right is more colours, a lower ΔE', () => {
    expect([MIN_DELTA_E, MAX_DELTA_E, DEFAULT_DELTA_E]).toEqual([2, 15, 6])
    expect(sliderFromDeltaE(15)).toBe(2) // far left: fewest colours
    expect(sliderFromDeltaE(2)).toBe(15) // far right: most colours
    expect(sliderFromDeltaE(6)).toBe(11)
    for (let v = 2; v <= 15; v++) expect(sliderFromDeltaE(deltaEFromSlider(v))).toBe(v)
    // Moving right lowers ΔE.
    expect(deltaEFromSlider(12)).toBeLessThan(deltaEFromSlider(11))
  })
})

describe('the shrink notice', () => {
  it('says what was reduced to what, only when it was', () => {
    const p = { imageWidth: 4000, imageHeight: 3000, detectedWidth: 2000, detectedHeight: 1500 }
    expect(shrinkNotice(p)).toBe(
      'Reduced from 4000×3000 to 2000×1500 for detection. Check the size, and fix it in Design if needed.',
    )
    expect(shrinkNotice({ ...p, detectedWidth: 4000, detectedHeight: 3000 })).toBeNull()
  })
})

describe('the pattern’s cell size', () => {
  it('is the largest whole number of device pixels that fits, gridline included', () => {
    expect(cellSize(10, 5, 201, 300, 1)).toBe(20)
    expect(cellSize(10, 5, 200, 300, 1)).toBe(19) // no room for the closing line
    expect(cellSize(10, 5, 100, 150, 2)).toBe(19)
    expect(cellSize(1000, 1000, 100, 100, 1)).toBe(1) // never below one pixel
    expect(cellSize(10, 5, 0, 0, 1)).toBe(0) // not laid out yet
  })
})
