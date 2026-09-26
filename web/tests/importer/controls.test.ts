import { describe, expect, it } from 'vitest'

import { cellSize, shrinkNotice } from '../../src/importer/controls.ts'

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
