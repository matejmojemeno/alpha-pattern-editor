/** The structural panel's previews and checks. */
import { describe, expect, it } from 'vitest'

import {
  borderPreview,
  dragOffsets,
  keptRect,
  padOffsets,
  padPreview,
  removedCount,
  removesArtwork,
  scaledSize,
  tryBorder,
  type Rect,
  type Sides,
} from '../../src/design/structure.ts'
import { EditError, newPattern, padToSize, setCell, addPaletteEntry } from '../../src/logic/edit.ts'
import type { Pattern } from '../../src/model/types.ts'

/** 5×4: a white frame (0) around black (1) and red (2) art. */
function framed(): Pattern {
  let p = newPattern(5, 4, '#ffffff')
  p = addPaletteEntry(p, '#000000', 'Black')
  p = addPaletteEntry(p, '#ff0000', 'Red')
  p = setCell(p, 1, 1, 1)
  p = setCell(p, 1, 2, 2)
  p = setCell(p, 2, 3, 1)
  return p
}

const region = (p: Pattern, r: Rect) => {
  const out: number[] = []
  for (let y = r.r0; y < r.r1; y++) for (let x = r.c0; x < r.c1; x++) out.push(p.cells[y * p.cols + x]!)
  return out
}

describe('borderPreview', () => {
  const p = framed()

  it('shows nothing for no border', () => {
    expect(borderPreview(p, { top: 0, right: 0, bottom: 0, left: 0 }, 0)).toBeNull()
  })

  it('grows outwards in the border colour, outlining the result', () => {
    const v = borderPreview(p, { top: 1, right: 2, bottom: 0, left: 1 }, 1)!
    expect([v.pattern.cols, v.pattern.rows]).toEqual([8, 5])
    expect(v.removed).toEqual([])
    expect(v.outline).toEqual({ r0: 0, r1: 5, c0: 0, c1: 8 })
    expect(region(v.pattern, { r0: 0, r1: 1, c0: 0, c1: 8 })).toEqual(new Array(8).fill(1))
  })

  it('keeps the removed cells in view, marked, and outlines what is left', () => {
    const v = borderPreview(p, { top: -1, right: -2, bottom: 0, left: 0 }, 0)!
    expect([v.pattern.cols, v.pattern.rows]).toEqual([5, 4])
    expect(v.outline).toEqual({ r0: 1, r1: 4, c0: 0, c1: 3 })
    expect(v.removed).toEqual([
      { r0: 0, r1: 1, c0: 0, c1: 5 },
      { r0: 1, r1: 4, c0: 3, c1: 5 },
    ])
  })

  // Every combination of sides from -3 to 2: the outlined part of the preview is exactly
  // what addBorder makes, and the hatched cells are the ones it drops.
  it('outlines exactly what addBorder makes, for every side from -3 to +2', () => {
    const range = [-3, -1, 0, 1, 2]
    for (const top of range) for (const right of range) for (const bottom of range) for (const left of range) {
      const s: Sides = { top, right, bottom, left }
      const v = borderPreview(p, s, 2)
      const got = tryBorder(p, s, 2)
      if (v === null) {
        expect(s).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
        continue
      }
      if (got instanceof EditError) continue
      const out = v.outline ?? { r0: 0, c0: 0, r1: v.pattern.rows, c1: v.pattern.cols }
      expect([out.c1 - out.c0, out.r1 - out.r0]).toEqual([got.cols, got.rows])
      expect(region(v.pattern, out)).toEqual([...got.cells])
      const hatched = v.removed.reduce((n, r) => n + (r.r1 - r.r0) * (r.c1 - r.c0), 0)
      expect(hatched).toBe(v.outline ? removedCount(p, s) : 0)
    }
  })

  it('refuses, with the Python’s message, a removal that leaves nothing', () => {
    const e = tryBorder(p, { top: -2, right: 0, bottom: -2, left: 0 }, 0)
    expect(e).toBeInstanceOf(EditError)
    expect((e as EditError).message).toBe('Border removal would leave an empty pattern.')
    const v = borderPreview(p, { top: -2, right: 0, bottom: -2, left: 0 }, 0)!
    expect(v.removed).toEqual([{ r0: 0, c0: 0, r1: 4, c1: 5 }])
  })
})

describe('removal checks', () => {
  const p = framed()
  it('knows when the cells removed are all one colour', () => {
    expect(removesArtwork(p, { top: -1, right: -1, bottom: -1, left: -1 })).toBe(false) // the white frame
    expect(removesArtwork(p, { top: -2, right: 0, bottom: 0, left: 0 })).toBe(true)
    expect(removesArtwork(p, { top: 3, right: 0, bottom: 0, left: 0 })).toBe(false)
    expect(removedCount(p, { top: -1, right: -1, bottom: 0, left: 0 })).toBe(5 + 3)
    expect(keptRect(p, { top: -9, right: 0, bottom: 0, left: 0 })).toMatchObject({ r0: 4, r1: 4 })
  })
})

describe('pad to size', () => {
  const p = framed()
  it('centres by default, as pad_to_size does, and clamps offsets', () => {
    expect(padOffsets(p, 10, 9, null, null)).toEqual({ left: 2, top: 2, addedCols: 5, addedRows: 5 })
    expect(padOffsets(p, 10, 9, 9, -3)).toMatchObject({ left: 5, top: 0 })
    expect(padOffsets(p, 3, 3, null, null)).toEqual({ left: 0, top: 0, addedCols: 0, addedRows: 0 })
  })

  it('previews exactly what padToSize makes', () => {
    const v = padPreview(p, 9, 7, 1, 3, 2)!
    const real = padToSize(p, 9, 7, { offsetLeft: 1, offsetTop: 3, paletteIndex: 2 })
    expect([...v.pattern.cells]).toEqual([...real.cells])
    expect(v.outline).toEqual({ r0: 3, r1: 7, c0: 1, c1: 6 })
    expect(padPreview(p, 5, 4, 0, 0, 0)).toBeNull()
  })

  it('drags the pattern a whole cell at a time, within the new size', () => {
    const added = { cols: 4, rows: 3 }
    expect(dragOffsets({ left: 2, top: 1 }, 1, -1, added)).toEqual({ left: 1, top: 2 })
    expect(dragOffsets({ left: 2, top: 1 }, 10, 10, added)).toEqual({ left: 4, top: 3 })
    expect(dragOffsets({ left: 2, top: 1 }, -10, -10, added)).toEqual({ left: 0, top: 0 })
  })
})

describe('scaledSize', () => {
  it('says the size, and when it passes 999', () => {
    expect(scaledSize({ cols: 40, rows: 30 }, 3)).toEqual({ cols: 120, rows: 90, large: false })
    expect(scaledSize({ cols: 100, rows: 30 }, 10)).toEqual({ cols: 1000, rows: 300, large: true })
    expect(scaledSize({ cols: 83, rows: 30 }, 12).large).toBe(false)
  })
})
