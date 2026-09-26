import { describe, expect, it } from 'vitest'

import { applyRemovals, matchEntry } from '../../src/importer/removals.ts'
import { deletePaletteEntryNearest } from '../../src/logic/edit.ts'
import type { PaletteEntry, Pattern } from '../../src/model/types.ts'

const entry = (id: string, hex: string, name: string, count = 0): PaletteEntry => ({ id, hex, name, dmc: null, count })

/** A 2×3 chart of white, near-white and black, as a preview (no row ids). */
const preview = (ids = ['a', 'b', 'c'], hexes = ['#ffffff', '#f0ece0', '#000000']) => ({
  rows: 2,
  cols: 3,
  cells: new Uint16Array([0, 1, 2, 2, 1, 0]),
  palette: [entry(ids[0]!, hexes[0]!, 'White', 2), entry(ids[1]!, hexes[1]!, 'Cream', 2), entry(ids[2]!, hexes[2]!, 'Black', 2)],
  confidence: new Float32Array(6).fill(0.5),
})

describe('matchEntry', () => {
  it('finds the nearest colour within the tolerance, or none', () => {
    const { palette } = preview()
    expect(matchEntry(palette, '#000000', 7.5)).toBe(2)
    expect(matchEntry(palette, '#040404', 7.5)).toBe(2) // a resample's slightly different black
    expect(matchEntry(palette, '#ff0000', 7.5)).toBe(-1) // red is nothing here
  })
})

describe('applyRemovals', () => {
  it('gives the removed colour’s cells the nearest remaining one, as Delete in Design does', () => {
    const p = preview()
    const { result, applied } = applyRemovals(p, [{ hex: '#f0ece0', name: 'Cream' }], 7.5)
    expect(applied).toEqual([true])
    expect(result.palette.map((e) => [e.name, e.count])).toEqual([
      ['White', 4],
      ['Black', 2],
    ])
    expect([...result.cells]).toEqual([0, 0, 1, 1, 0, 0])
    // Exactly what edit.ts gives.
    const asPattern = { ...p, row_ids: ['x', 'y'] } as unknown as Pattern
    const want = deletePaletteEntryNearest(asPattern, 'b')
    expect([...result.cells]).toEqual([...want.cells])
    expect(result.palette).toEqual(want.palette)
    // Everything else is kept, and the input is left alone.
    expect(result.confidence).toBe(p.confidence)
    expect(p.palette).toHaveLength(3)
    expect([...p.cells]).toEqual([0, 1, 2, 2, 1, 0])
  })

  it('finds a removed colour again in a resample, with new ids and a slightly different hex', () => {
    const again = preview(['x', 'y', 'z'], ['#fefefe', '#efebdf', '#030303'])
    const { result, applied } = applyRemovals(again, [{ hex: '#f0ece0', name: 'Cream' }], 7.5)
    expect(applied).toEqual([true])
    expect(result.palette.map((e) => e.id)).toEqual(['x', 'z'])
  })

  it('skips a colour the preview doesn’t have, and applies the rest in order', () => {
    const { result, applied } = applyRemovals(
      preview(),
      [
        { hex: '#ff0000', name: 'Red' },
        { hex: '#000000', name: 'Black' },
        { hex: '#f0ece0', name: 'Cream' },
      ],
      7.5,
    )
    expect(applied).toEqual([false, true, true])
    // Black went to Cream (its nearest), then Cream to White.
    expect(result.palette.map((e) => [e.name, e.count])).toEqual([['White', 6]])
  })

  it('never removes the last colour', () => {
    const { result, applied } = applyRemovals(
      preview(),
      ['#000000', '#f0ece0', '#ffffff'].map((hex) => ({ hex, name: hex })),
      7.5,
    )
    expect(applied).toEqual([true, true, false])
    expect(result.palette).toHaveLength(1)
  })

  it('keeps a Pattern’s own ids and row ids', () => {
    const p = { ...preview(), id: 'pat', row_ids: ['r0', 'r1'] }
    const { result } = applyRemovals(p, [{ hex: '#000000', name: 'Black' }], 7.5)
    expect(result.id).toBe('pat')
    expect(result.row_ids).toEqual(['r0', 'r1'])
  })

  it('names the colours left again, so one blue left alone is plain “Blue”', () => {
    const p = preview(['a', 'b', 'c'], ['#1a2a80', '#8ab8e8', '#ffffff'])
    p.palette = p.palette.map((e, i) => ({ ...e, name: ['Dark blue', 'Light blue', 'White'][i]! }))
    const { result } = applyRemovals(p, [{ hex: '#8ab8e8', name: 'Light blue' }], 7.5)
    expect(result.palette.map((e) => [e.id, e.name])).toEqual([
      ['a', 'Blue'],
      ['c', 'White'],
    ])
  })

  it('returns the same object when nothing is removed', () => {
    const p = preview()
    expect(applyRemovals(p, [], 7.5).result).toBe(p)
  })
})
