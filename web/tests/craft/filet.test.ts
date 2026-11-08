import { describe, expect, it } from 'vitest'

import { craftOf, withCraft } from '../../src/craft/crafts.ts'
import {
  firstSquare,
  formatFiletRow,
  foundation,
  foundationText,
  meshOf,
  MESHES,
  spaceIndex,
  spaceText,
  squareOf,
  squaresText,
  stitchesText,
  turnText,
} from '../../src/craft/filet.ts'
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

  it('reads row 1\'s first square as it is worked, past skipped cells', () => {
    // Row 1 is the bottom row, worked right to left; 0 is black (blocks), 1 white (spaces).
    const p = (bottom: string) => withCraft(pattern(['#000000', '#ffffff'], ['0000', bottom]), 'filet')
    expect(firstSquare(p('0001'))).toBe('space')
    expect(firstSquare(p('1110'))).toBe('block')
    expect(firstSquare(p('11..'))).toBe('space')
    expect(firstSquare({ ...p('0001'), start_direction: 'LTR' })).toBe('block')
  })

  // Each count below is one a source in craft/README.md gives in full.
  it('chains for row 1: the squares, the turning chain, and a first space\'s top', () => {
    // 7 squares: blocks then spaces, or spaces then blocks.
    const row = (first: 'block' | 'space', filet_mesh: string) =>
      withCraft({ ...pattern(['#000000', '#ffffff'], [first === 'space' ? '0000111' : '1110000']), filet_mesh }, 'filet')
    const counts = (first: 'block' | 'space', filet_mesh: string) => {
      const f = foundation(row(first, filet_mesh))
      return [f.chains, f.hook]
    }
    // Craftsy, Dream a Little Bigger: 7 × 3 + 3, dc in the 4th; 7 × 3 + 5, dc in the 8th.
    expect(counts('block', 'ch2-dc')).toEqual([24, 4])
    expect(counts('space', 'ch2-dc')).toEqual([26, 8])
    // Crochet Cabana: "7 x 2 + tch (3 if solid, 4 if open) = 17, 18 (go into the 4th
    // chain for a closed block, and 6th chain for an open mesh)".
    expect(counts('block', 'ch1-dc')).toEqual([17, 4])
    expect(counts('space', 'ch1-dc')).toEqual([18, 6])
    // The same with a treble's 4-chain turning chain: 3 × squares + 4, or + 6.
    expect(counts('block', 'ch2-tr')).toEqual([25, 5])
    expect(counts('space', 'ch2-tr')).toEqual([27, 9])
    expect(foundation(row('space', 'ch2-tr'))).toMatchObject({ squares: 21, turning: 4, space: 2 })
  })

  it('says row 1\'s chain in full, and every other row\'s turning chain', () => {
    const p = withCraft({ ...pattern(['#000000', '#ffffff'], ['0000111']), filet_mesh: 'ch2-tr' }, 'filet')
    expect(foundationText(p)).toBe(
      'Chain 27: 3 × 7 for the squares, 4 for the turning chain (it counts as the first tr) and 2 for the first space. Then tr in the 9th chain from the hook.',
    )
    const q = withCraft(pattern(['#000000', '#ffffff'], ['1110000']), 'filet')
    expect(foundationText(q)).toBe(
      'Chain 24: 3 × 7 for the squares, and 3 for the turning chain (it counts as the first dc). Then dc in the 4th chain from the hook.',
    )
    expect(turnText(CH2_DC)).toBe('Turn and ch 3: it counts as the first dc.')
    expect(turnText(CH1_DC)).toBe('Turn and ch 3: it counts as the first dc.')
    expect(turnText(CH2_TR)).toBe('Turn and ch 4: it counts as the first tr.')
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
