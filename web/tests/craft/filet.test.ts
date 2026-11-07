import { describe, expect, it } from 'vitest'

import { craftOf, withCraft } from '../../src/craft/crafts.ts'
import { formatFiletRow, foundationChain, meshOf, MESHES, spaceIndex, spaceText, squareOf, squaresText, stitchesText } from '../../src/craft/filet.ts'
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

const mesh = (filet_mesh: string) => meshOf({ filet_mesh })
const CH2_DC = mesh('ch2-dc')
const CH1_DC = mesh('ch1-dc')
const CH2_TR = mesh('ch2-tr')

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
    expect(stitchesText('block', 1, CH2_DC)).toBe('3 dc')
    expect(stitchesText('block', 4, CH2_DC)).toBe('12 dc')
    expect(stitchesText('space', 1, CH2_DC)).toBe('ch 2, dc')
    expect(stitchesText('space', 3, CH2_DC)).toBe('(ch 2, dc) × 3')
    expect(stitchesText('skip', 2, CH2_DC)).toBe('')
  })

  it('works a narrower square in ch 1, dc: a block is 2 dc', () => {
    expect(stitchesText('block', 1, CH1_DC)).toBe('2 dc')
    expect(stitchesText('block', 4, CH1_DC)).toBe('8 dc')
    expect(stitchesText('space', 1, CH1_DC)).toBe('ch 1, dc')
    expect(stitchesText('space', 3, CH1_DC)).toBe('(ch 1, dc) × 3')
    expect(stitchesText('skip', 2, CH1_DC)).toBe('')
  })

  it('swaps every dc for a tr in ch 2, tr: a block is 3 tr', () => {
    expect(stitchesText('block', 1, CH2_TR)).toBe('3 tr')
    expect(stitchesText('block', 4, CH2_TR)).toBe('12 tr')
    expect(stitchesText('space', 1, CH2_TR)).toBe('ch 2, tr')
    expect(stitchesText('space', 3, CH2_TR)).toBe('(ch 2, tr) × 3')
  })

  it('chains a square\'s width each, plus 1', () => {
    expect(foundationChain(1, CH2_DC)).toBe(4)
    expect(foundationChain(5, CH2_DC)).toBe(16)
    expect(foundationChain(20, CH2_DC)).toBe(61)
    expect(foundationChain(5, CH2_TR)).toBe(16)
    expect(foundationChain(1, CH1_DC)).toBe(3)
    expect(foundationChain(5, CH1_DC)).toBe(11)
    expect(foundationChain(20, CH1_DC)).toBe(41)
  })

  it('offers the three meshes, by name, and reads an unknown one as ch 2, dc', () => {
    expect(MESHES.map(spaceText)).toEqual(['ch 2, dc', 'ch 1, dc', 'ch 2, tr'])
    expect(newPattern(3, 2, '#ffffff', { now: 1 }).filet_mesh).toBe('ch2-dc')
    expect(mesh('from-a-newer-build')).toBe(CH2_DC)
  })

  it('reads a row in working order as squares', () => {
    // Black blocks on white: row 1 (the bottom) is worked right to left.
    const p = withCraft(pattern(['#000000', '#ffffff'], ['0110', '1100']), 'filet')
    expect(formatFiletRow(p, encodeRow(p, 1))).toBe('2 blocks, 2 spaces')
    expect(formatFiletRow(p, encodeRow(p, 0))).toBe('1 block, 2 spaces, 1 block')
  })
})
