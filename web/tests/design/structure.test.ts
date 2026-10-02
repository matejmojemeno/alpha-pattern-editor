/** The structural panel's previews and checks. */
import { describe, expect, it } from 'vitest'

import {
  NO_SIDES,
  borderPreview,
  centreSides,
  keptRect,
  removedCount,
  removesArtwork,
  resizeSides,
  scaledSize,
  shiftSides,
  sizeWith,
  tryBorder,
  type Rect,
  type Sides,
} from '../../src/design/structure.ts'
import { centred, endSize, formSides, initialForm, isCentred, sizeText, typeSize, withSides } from '../../src/design/structureForm.ts'
import { EditError, addBorder, newPattern, padToSize, setCell, addPaletteEntry } from '../../src/logic/edit.ts'
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

  it('grows outwards in the border colour, outlining where the pattern sits', () => {
    const v = borderPreview(p, { top: 1, right: 2, bottom: 0, left: 1 }, 1)!
    expect([v.pattern.cols, v.pattern.rows]).toEqual([8, 5])
    expect(v.removed).toEqual([])
    expect(v.outline).toEqual({ r0: 1, r1: 5, c0: 1, c1: 6 })
    expect(region(v.pattern, v.outline!)).toEqual([...p.cells])
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

  // Every combination of sides from -3 to 2: what the preview keeps (the outlined part
  // when it removes cells, all of it when it only adds) is exactly what addBorder makes,
  // and the hatched cells are the ones it drops.
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
      const all = { r0: 0, c0: 0, r1: v.pattern.rows, c1: v.pattern.cols }
      const out = v.removed.length ? v.outline! : all
      expect([out.c1 - out.c0, out.r1 - out.r0]).toEqual([got.cols, got.rows])
      expect(region(v.pattern, out)).toEqual([...got.cells])
      const hatched = v.removed.reduce((n, r) => n + (r.r1 - r.r0) * (r.c1 - r.c0), 0)
      expect(hatched).toBe(v.outline ? removedCount(p, s) : 0)
      if (!v.removed.length && v.outline) expect(region(v.pattern, v.outline)).toEqual([...p.cells])
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

describe('a size, as a border', () => {
  const p = framed() // 5 × 4
  const same = (a: Pattern, b: Pattern) => expect([a.cols, a.rows, ...a.cells]).toEqual([b.cols, b.rows, ...b.cells])

  // From no border, a size is padding, centred as pad_to_size centres it: the Python's
  // own padding (mirrored by padToSize, golden-tested) for every size up to 12 × 11.
  it('makes exactly what padToSize makes, for every larger size', () => {
    for (let w = p.cols; w <= 12; w++) {
      for (let h = p.rows; h <= 11; h++) {
        const s = resizeSides(p, NO_SIDES, w, h)
        expect(sizeWith(p, s)).toEqual({ width: w, height: h })
        same(addBorder(p, { ...s, paletteIndex: 2 }), padToSize(p, w, h, { paletteIndex: 2 }))
      }
    }
  })

  it('shares a change between opposite sides, so the pattern stays where it was', () => {
    const from: Sides = { top: 0, right: 5, bottom: 2, left: 1 }
    expect(resizeSides(p, from, 5 + 6 + 4, null)).toEqual({ top: 0, right: 7, bottom: 2, left: 3 })
    expect(resizeSides(p, from, null, 4 + 2 - 3)).toEqual({ top: -2, right: 5, bottom: 1, left: 1 }) // smaller: crops
    expect(resizeSides(p, from, 11, 6)).toEqual(from)
  })

  it('centres in the same size', () => {
    expect(centreSides({ top: 0, right: 5, bottom: 3, left: 0 })).toEqual({ top: 1, right: 3, bottom: 2, left: 2 })
    expect(centreSides({ top: -3, right: 0, bottom: 0, left: 0 })).toEqual({ top: -2, right: 0, bottom: -1, left: 0 })
  })
})

describe('shiftSides (dragging the pattern)', () => {
  it('moves a cell at a time, keeping the size, and stops at the edges of what is added', () => {
    const from: Sides = { top: 1, right: 2, bottom: 2, left: 2 }
    expect(shiftSides(from, 1, -1)).toEqual({ top: 2, right: 3, bottom: 1, left: 1 })
    expect(shiftSides(from, 10, 10)).toEqual({ top: 3, right: 0, bottom: 0, left: 4 })
    expect(shiftSides(from, -10, -10)).toEqual({ top: 0, right: 4, bottom: 3, left: 0 })
  })

  it('where cells are only removed, chooses which side they go from, never adding any', () => {
    const from: Sides = { top: -2, right: 0, bottom: 0, left: -1 }
    expect(shiftSides(from, 1, 5)).toEqual({ top: -1, right: -1, bottom: -1, left: 0 })
    expect(shiftSides(from, -5, -5)).toEqual({ top: -2, right: 0, bottom: 0, left: -1 })
  })

  it('never jumps from where it was picked up', () => {
    const from: Sides = { top: 0, right: 5, bottom: 0, left: -2 } // 3 added on balance
    expect(shiftSides(from, 0, 0)).toEqual(from)
    expect(shiftSides(from, 0, 1)).toEqual({ top: 0, right: 4, bottom: 0, left: -1 })
    expect(shiftSides(from, 0, 9)).toEqual({ top: 0, right: 0, bottom: 0, left: 3 })
  })
})

describe('the border form’s size fields', () => {
  const p = { cols: 58, rows: 98 }

  it('show the size the sides give, starting with no border', () => {
    expect(formSides(initialForm().border)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(sizeText(initialForm().border, p)).toEqual({ width: '58', height: '98' })
    expect(sizeText(withSides(initialForm(), { top: 1, right: 1, bottom: 1, left: 1 }).border, p)).toEqual({ width: '60', height: '100' })
  })

  it('set the sides from where typing began, whatever was typed on the way', () => {
    let f = initialForm()
    for (const v of ['7', '70']) f = typeSize(f, p, 'width', v) // typing "70"
    expect(formSides(f.border)).toEqual({ top: 0, right: 6, bottom: 0, left: 6 })
    expect(sizeText(f.border, p)).toEqual({ width: '70', height: '98' })
    expect(f.border.linked).toBe(false) // no longer the same on every side
    f = typeSize(f, p, 'width', '') // cleared: the sides stay as they began
    expect(formSides(f.border)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(sizeText(f.border, p).width).toBe('')
    f = endSize(typeSize(f, p, 'height', '99'))
    expect(f.border.size).toBeNull()
    expect(sizeText(f.border, p)).toEqual({ width: '58', height: '99' })
  })

  it('centre the pattern, and know when it is', () => {
    const f = withSides(initialForm(), { top: 0, right: 4, bottom: 0, left: 0 })
    expect(isCentred(f)).toBe(false)
    expect(formSides(centred(f).border)).toEqual({ top: 0, right: 2, bottom: 0, left: 2 })
    expect(isCentred(centred(f))).toBe(true)
  })
})


describe('scaledSize', () => {
  it('says the size, and when it passes 999', () => {
    expect(scaledSize({ cols: 40, rows: 30 }, 3)).toEqual({ cols: 120, rows: 90, large: false })
    expect(scaledSize({ cols: 100, rows: 30 }, 10)).toEqual({ cols: 1000, rows: 300, large: true })
    expect(scaledSize({ cols: 83, rows: 30 }, 12).large).toBe(false)
  })
})
