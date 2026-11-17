import { describe, expect, it } from 'vitest'

import {
  applyColourChanges,
  blankPiece,
  projectColours,
  sameColoursPlan,
  SAME_COLOUR_DELTA_E,
} from '../../src/app/projectColours.ts'
import { countCells, newPattern } from '../../src/logic/edit.ts'
import { deltaE, hexToLab } from '../../src/logic/lab.ts'
import type { Pattern } from '../../src/model/types.ts'
import { stitchesFor } from '../../src/yarn/usage.ts'

/** A pattern whose cells use `colours` in turn, each `count` times (cols = total). */
function piece(name: string, colours: [hex: string, name: string, count: number][]): Pattern {
  const total = colours.reduce((n, c) => n + c[2], 0)
  const cells = new Uint16Array(total)
  let at = 0
  colours.forEach((c, i) => {
    cells.fill(i, at, at + c[2])
    at += c[2]
  })
  const p = newPattern(total, 1, colours[0]![0], { name, now: 1 })
  return {
    ...p,
    cells,
    palette: colours.map(([hex, n, count], i) => ({ id: `${name}-${i}`, hex, name: n, dmc: null, count })),
  }
}

describe('projectColours', () => {
  it('one per hex across the pieces, most stitches first, named by the entry with the most', () => {
    const front = piece('front', [
      ['#ffffff', 'White', 10],
      ['#cc0000', 'Red', 2],
    ])
    const back = piece('back', [
      ['#CC0000', 'Cherry', 5],
      ['#ffffff', 'Cream', 3],
      ['#000000', 'Black', 1],
    ])
    expect(projectColours([front, back])).toEqual([
      { hex: '#ffffff', name: 'White', count: 13 },
      { hex: '#cc0000', name: 'Cherry', count: 7 },
      { hex: '#000000', name: 'Black', count: 1 },
    ])
  })
})

describe('blankPiece', () => {
  const colours = [
    { hex: '#ffffff', name: 'White' },
    { hex: '#cc0000', name: 'Red' },
    { hex: '#000000', name: 'Black' },
  ]

  it('is all background, with the other colours ready and no stitches in them', () => {
    const p = blankPiece({ name: 'Sleeve', cols: 4, rows: 3 }, colours, '#cc0000', null, 5)
    expect(p).toMatchObject({ name: 'Sleeve', cols: 4, rows: 3, created_at: 5 })
    expect(p.palette.map((e) => [e.hex, e.name, e.count])).toEqual([
      ['#cc0000', 'Red', 12],
      ['#ffffff', 'White', 0],
      ['#000000', 'Black', 0],
    ])
    expect([...p.cells].every((v) => v === 0)).toBe(true)
    expect(countCells(p.cells, p.palette.length)).toEqual([12, 0, 0])
    expect(new Set(p.palette.map((e) => e.id)).size).toBe(3)
  })

  it('is worked the way the first piece is', () => {
    const like = { ...newPattern(2, 2, '#ffffff'), start_direction: 'LTR', alternate_direction: false, bottom_up: false, craft: 'knitting' } as const
    const p = blankPiece({ name: 'Back', cols: 2, rows: 2 }, colours, '#ffffff', like)
    expect(p).toMatchObject({ start_direction: 'LTR', alternate_direction: false, bottom_up: false, craft: 'knitting' })
    expect(p.id).not.toBe(like.id)
  })
})

describe('sameColoursPlan', () => {
  // Two reds 4.6 apart and a white: a photo's red and another photo's red of the same yarn.
  const red = '#c0392b'
  const red2 = '#c43d30'
  it('the yarns', () => {
    expect(deltaE(hexToLab(red), hexToLab(red2))).toBeLessThan(SAME_COLOUR_DELTA_E)
  })

  it('a close colour in another piece takes the most-used one’s hex and name; cells are untouched', () => {
    const front = piece('front', [
      ['#ffffff', 'White', 10],
      [red, 'Red', 6],
    ])
    const back = piece('back', [
      ['#fefefe', 'Snow', 4],
      [red2, 'Tomato', 3],
      ['#0000ff', 'Blue', 2],
    ])
    const plan = sameColoursPlan([front, back])
    expect(plan[0]).toEqual([])
    expect(plan[1]).toEqual([
      { entryId: 'back-0', from: { hex: '#fefefe', name: 'Snow' }, to: { hex: '#ffffff', name: 'White' } },
      { entryId: 'back-1', from: { hex: red2, name: 'Tomato' }, to: { hex: red, name: 'Red' } },
    ])
    const after = applyColourChanges(back, plan[1]!)
    expect(after.palette.map((e) => [e.id, e.hex, e.name, e.count])).toEqual([
      ['back-0', '#ffffff', 'White', 4],
      ['back-1', red, 'Red', 3],
      ['back-2', '#0000ff', 'Blue', 2],
    ])
    expect(after.cells).toEqual(back.cells)
    expect(after.row_ids).toEqual(back.row_ids)
    // Done once, there's nothing more to do.
    expect(sameColoursPlan([front, after]).flat()).toEqual([])
  })

  it('the earlier piece gives its colour, however few stitches it has: a new blank piece never recolours the others', () => {
    const front = piece('front', [[red, 'Red', 2]])
    const blank = piece('blank', [[red2, 'Tomato', 50]])
    const plan = sameColoursPlan([front, blank])
    expect(plan[0]).toEqual([])
    expect(plan[1]).toEqual([{ entryId: 'blank-0', from: { hex: red2, name: 'Tomato' }, to: { hex: red, name: 'Red' } }])
  })

  it('the same hex with another name takes the name', () => {
    const a = piece('a', [['#ffffff', 'White', 5]])
    const b = piece('b', [['#FFFFFF', 'Ecru', 1]])
    expect(sameColoursPlan([a, b])[1]).toEqual([{ entryId: 'b-0', from: { hex: '#FFFFFF', name: 'Ecru' }, to: { hex: '#ffffff', name: 'White' } }])
  })

  it('colours further apart than ΔE 15 stay as they are', () => {
    const a = piece('a', [['#ffffff', 'White', 5]])
    const b = piece('b', [['#bbbbbb', 'Grey', 5]])
    expect(deltaE(hexToLab('#ffffff'), hexToLab('#bbbbbb'))).toBeGreaterThan(SAME_COLOUR_DELTA_E)
    expect(sameColoursPlan([a, b]).flat()).toEqual([])
  })

  it('never makes two colours of one piece one: each takes a different colour, or stays', () => {
    // The front has two close reds on purpose; the back has one of them.
    const front = piece('front', [
      [red, 'Red', 6],
      [red2, 'Tomato', 5],
    ])
    const back = piece('back', [
      ['#c13a2c', 'Red-ish', 4],
      ['#c33c2f', 'Tomato-ish', 2],
    ])
    const plan = sameColoursPlan([front, back])
    expect(plan[0]).toEqual([])
    const after = applyColourChanges(back, plan[1]!)
    expect(new Set(after.palette.map((e) => e.hex)).size).toBe(2)
    expect(after.palette.map((e) => e.hex).sort()).toEqual([red, red2].sort())
  })

  it('a colour in only one piece is left alone', () => {
    expect(sameColoursPlan([piece('a', [['#123456', 'Navy', 3]])])).toEqual([[]])
  })
})

describe('stitchesFor', () => {
  const swatch = { stitches: 10, rows: 12, widthCm: 10, heightCm: 9, grams: null }
  it('the columns and rows a size takes, to the nearest stitch', () => {
    // 1 cm a stitch, 0.75 cm a row: 52 cm is 52 stitches, 70 cm is 93.3 rows.
    expect(stitchesFor(52, 70, swatch)).toEqual({ cols: 52, rows: 93 })
    expect(stitchesFor(0.2, 0.2, swatch)).toEqual({ cols: 1, rows: 1 })
  })
  it('null where the swatch or the size isn’t measured', () => {
    expect(stitchesFor(52, null, swatch)).toEqual({ cols: 52, rows: null })
    expect(stitchesFor(52, 70, { ...swatch, widthCm: null })).toEqual({ cols: null, rows: 93 })
  })
})
