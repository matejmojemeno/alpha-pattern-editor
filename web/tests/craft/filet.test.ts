import { describe, expect, it } from 'vitest'

import { craftOf, withCraft } from '../../src/craft/crafts.ts'
import { formatFiletRow, foundationChain, spaceIndex, squareOf, squaresText, stitchesText } from '../../src/craft/filet.ts'
import { newPattern } from '../../src/logic/edit.ts'
import { encodeRow } from '../../src/logic/readout.ts'
import { SKIP_INDEX, type Pattern } from '../../src/model/types.ts'

/** A pattern of `rows`, one string a row, each character a palette index. */
function pattern(hexes: string[], rows: string[]): Pattern {
  const base = newPattern(rows[0]!.length, rows.length, hexes[0]!, { now: 1 })
  const palette = hexes.map((hex, i) => ({ id: `c${i}`, hex, name: `Colour ${i}`, dmc: null, count: 0 }))
  const cells = Uint16Array.from(rows.join(''), (ch) => (ch === '.' ? SKIP_INDEX : Number(ch)))
  return { ...base, palette, cells }
}

describe('filet crochet', () => {
  it('is read like a crochet graph and counted in squares', () => {
    const p = withCraft(newPattern(3, 2, '#ffffff', { now: 1 }), 'filet')
    expect([p.craft, p.bottom_up, p.start_direction, p.alternate_direction]).toEqual(['filet', true, 'RTL', true])
    const filet = craftOf(p)
    expect([filet.unit, filet.units, filet.carries, filet.inRounds]).toEqual(['square', 'squares', false, true])
  })

  it('reads the lightest colour as spaces, whatever its place in the palette', () => {
    expect(spaceIndex(pattern(['#000000', '#ffffff'], ['01']))).toBe(1)
    expect(spaceIndex(pattern(['#f5f0e6', '#1a237e', '#c62828'], ['012']))).toBe(0)
    // Pale yellow is lighter than mid grey, though its RGB sum is not the largest.
    expect(spaceIndex(pattern(['#9a9a9a', '#ffff66'], ['01']))).toBe(1)
    // The first of equals.
    expect(spaceIndex(pattern(['#ffffff', '#ffffff', '#000000'], ['012']))).toBe(0)
    expect(spaceIndex({ palette: [] })).toBeNull()
  })

  it('names squares and the stitches they take', () => {
    expect(squareOf(1, 1)).toBe('space')
    expect(squareOf(0, 1)).toBe('block')
    expect(squareOf(SKIP_INDEX, 1)).toBe('skip')
    expect([squaresText('block', 1), squaresText('block', 3), squaresText('space', 1), squaresText('space', 2)]).toEqual([
      '1 block',
      '3 blocks',
      '1 space',
      '2 spaces',
    ])
    // A block is 3 dc; a space is ch 2, skip 2, dc.
    expect(stitchesText('block', 1)).toBe('3 dc')
    expect(stitchesText('block', 4)).toBe('12 dc')
    expect(stitchesText('space', 1)).toBe('ch 2, dc')
    expect(stitchesText('space', 3)).toBe('(ch 2, dc) × 3')
    expect(stitchesText('skip', 2)).toBe('')
  })

  it('chains 3 a square plus 1', () => {
    expect(foundationChain(1)).toBe(4)
    expect(foundationChain(5)).toBe(16)
    expect(foundationChain(20)).toBe(61)
  })

  it('reads a row in working order as squares', () => {
    // Black blocks on white: row 1 (the bottom) is worked right to left.
    const p = withCraft(pattern(['#000000', '#ffffff'], ['0110', '1100']), 'filet')
    expect(formatFiletRow(p, encodeRow(p, 1))).toBe('2 blocks, 2 spaces')
    expect(formatFiletRow(p, encodeRow(p, 0))).toBe('1 block, 2 spaces, 1 block')
  })
})
