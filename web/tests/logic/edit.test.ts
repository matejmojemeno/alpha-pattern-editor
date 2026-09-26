/** What the golden fixtures don't cover: newPattern, samePattern and the index guards. */
import { describe, expect, it } from 'vitest'

import {
  EditError,
  MAX_SIDE,
  addPaletteEntry,
  newId,
  newPattern,
  renamePaletteEntry,
  samePattern,
  setCell,
  floodFill,
} from '../../src/logic/edit.ts'

describe('newPattern', () => {
  it('is one colour, with a one-entry palette and fresh row ids', () => {
    const p = newPattern(4, 3, '#AABBCC', { name: 'Scarf', now: 100 })
    expect(p).toMatchObject({ name: 'Scarf', cols: 4, rows: 3, created_at: 100, updated_at: 100 })
    expect([...p.cells]).toEqual(new Array(12).fill(0))
    expect(p.palette).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/), hex: '#aabbcc', name: 'Background', dmc: null, count: 12 }])
    expect(new Set(p.row_ids).size).toBe(3)
    expect(p.id).toMatch(/^[0-9a-f]{32}$/)
    // The model's defaults for a new pattern (model.py), not a loaded file's.
    expect(p).toMatchObject({ start_direction: 'RTL', alternate_direction: true, bottom_up: true })
  })

  it('refuses sizes and colours it cannot make', () => {
    for (const [c, r] of [[0, 5], [5, 0], [MAX_SIDE + 1, 5], [2.5, 5]]) {
      expect(() => newPattern(c!, r!, '#ffffff')).toThrow(EditError)
    }
    expect(() => newPattern(5, 5, 'white')).toThrow(EditError)
    expect(newPattern(MAX_SIDE, 1, '#000000').cells.length).toBe(MAX_SIDE)
  })
})

describe('samePattern', () => {
  const p = newPattern(3, 3, '#ffffff')
  it('sees an edit that changed nothing as the same', () => {
    expect(samePattern(p, floodFill(p, 0, 0, 0))).toBe(true)
    expect(samePattern(p, setCell(p, 1, 1, 0))).toBe(true)
  })
  it('sees any change to cells, palette or rows', () => {
    const q = addPaletteEntry(p, '#000000')
    expect(samePattern(p, q)).toBe(false)
    expect(samePattern(q, setCell(q, 1, 1, 1))).toBe(false)
    expect(samePattern(p, renamePaletteEntry(p, p.palette[0]!.id, 'Snow'))).toBe(false)
    expect(samePattern(p, { ...p, row_ids: [...p.row_ids].reverse() })).toBe(false)
  })
})

it('refuses cells outside the pattern rather than wrapping', () => {
  const p = newPattern(3, 2, '#ffffff')
  expect(() => setCell(p, 2, 0, 0)).toThrow(RangeError)
  expect(() => setCell(p, -1, 0, 0)).toThrow(RangeError)
  expect(() => floodFill(p, 0, 3, 0)).toThrow(RangeError)
})

it('makes ids in the form uuid4().hex has', () => {
  const ids = Array.from({ length: 100 }, newId)
  expect(new Set(ids).size).toBe(100)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/)
})
