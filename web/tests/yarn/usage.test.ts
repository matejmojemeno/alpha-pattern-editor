import { describe, expect, it } from 'vitest'

import { countCells } from '../../src/logic/edit.ts'
import { SKIP_INDEX, type PaletteEntry } from '../../src/model/types.ts'
import {
  ballFrom,
  ballIn,
  ballsFor,
  fieldValue,
  formatLength,
  perStitchFrom,
  perStitchIn,
  usageText,
  yarnUsage,
} from '../../src/yarn/usage.ts'

const entry = (name: string, hex: string, count: number): PaletteEntry => ({ id: name, hex, name, dmc: null, count })

describe('yarnUsage', () => {
  const palette = [entry('White', '#ffffff', 1000), entry('Black', '#000000', 1), entry('Unused', '#ff0000', 0)]

  it('is stitches × yarn per stitch × (1 + margin), per colour', () => {
    const u = yarnUsage(palette, { yarnPerStitchCm: 2.5, ballMetres: 295, marginPercent: 10 })
    expect(u.colours.map((c) => c.metres)).toEqual([expect.closeTo(27.5, 12), expect.closeTo(0.0275, 12), 0])
    expect(u.colours.map((c) => c.balls)).toEqual([1, 1, 0])
    expect(u.stitches).toBe(1001)
    expect(u.metres).toBeCloseTo(27.5275, 12)
    expect(u.balls).toBe(2) // each colour bought on its own
  })

  it('rounds balls up, and not past an exact multiple', () => {
    expect(ballsFor(295, 295)).toBe(1)
    expect(ballsFor(295.01, 295)).toBe(2)
    expect(ballsFor(0.1 + 0.2, 0.1)).toBe(3) // 3.0000000000000004 balls' worth
    expect(ballsFor(0, 295)).toBe(0)
    // 11,800 stitches × 2.5 cm = 295 m exactly, with no margin: one ball.
    expect(yarnUsage([entry('A', '#000000', 11_800)], { yarnPerStitchCm: 2.5, ballMetres: 295, marginPercent: 0 }).balls).toBe(1)
    expect(yarnUsage([entry('A', '#000000', 11_801)], { yarnPerStitchCm: 2.5, ballMetres: 295, marginPercent: 0 }).balls).toBe(2)
  })

  it('counts the margin', () => {
    const at = (marginPercent: number) =>
      yarnUsage([entry('A', '#000000', 11_800)], { yarnPerStitchCm: 2.5, ballMetres: 295, marginPercent })
    expect(at(0).metres).toBeCloseTo(295, 9)
    expect(at(20).metres).toBeCloseTo(354, 9)
    expect(at(20).balls).toBe(2)
  })

  it('counts no balls when the ball length is unknown', () => {
    const u = yarnUsage(palette, { yarnPerStitchCm: 2.5, ballMetres: null, marginPercent: 10 })
    expect(u.colours.every((c) => c.balls === null)).toBe(true)
    expect(u.balls).toBeNull()
  })

  it("takes recount's counts: skip cells and out-of-range indices count towards no colour", () => {
    // The counts every edit recomputes (edit.ts's `_recount`).
    const counts = countCells(Uint16Array.from([0, 1, SKIP_INDEX, 7, 0, 0]), 2)
    const palette = counts.map((n, i) => entry(String(i), '#000000', n))
    const u = yarnUsage(palette, { yarnPerStitchCm: 10, ballMetres: 1, marginPercent: 0 })
    expect(u.colours.map((c) => c.stitches)).toEqual([3, 1])
    expect(u.stitches).toBe(4)
    expect(u.colours.map((c) => c.balls)).toEqual([1, 1])
  })
})

describe('units', () => {
  it('shows lengths rounded up, in metres or yards', () => {
    expect(formatLength(27.01, 'metric')).toBe('28 m')
    expect(formatLength(27, 'metric')).toBe('27 m')
    expect(formatLength(0, 'metric')).toBe('0 m')
    expect(formatLength(91.44, 'imperial')).toBe('100 yd')
    expect(formatLength(91.45, 'imperial')).toBe('101 yd')
    expect(formatLength(1234.5, 'metric')).toBe('1,235 m')
  })

  it('converts the inputs both ways', () => {
    expect(perStitchIn(2.54, 'imperial')).toBeCloseTo(1, 12)
    expect(perStitchFrom(1, 'imperial')).toBeCloseTo(2.54, 12)
    expect(perStitchIn(2.5, 'metric')).toBe(2.5)
    expect(ballIn(295, 'imperial')).toBeCloseTo(322.6159, 3) // the ball band says 322 yds
    expect(ballFrom(ballIn(295, 'imperial'), 'imperial')).toBeCloseTo(295, 12)
    expect(ballFrom(100, 'metric')).toBe(100)
    expect(fieldValue(0.98425196, 2)).toBe('0.98')
    expect(fieldValue(2.5, 2)).toBe('2.5')
  })
})

describe('usageText', () => {
  it('lists each colour, the assumptions and the total', () => {
    const palette = [entry('White', '#ffffff', 1000), entry('Black', '#000000', 1)]
    const inputs = { yarnPerStitchCm: 2.5, ballMetres: 295, marginPercent: 10 }
    const text = usageText(yarnUsage(palette, inputs), {
      patternName: 'Heart',
      inputs,
      units: 'metric',
      ballNote: 'Stylecraft Special DK, 295 m per 100 g',
      shades: ['Stylecraft Special DK 1001 White', null],
    })
    expect(text).toBe(
      [
        'Heart: yarn estimate',
        '',
        'Yarn per stitch: 2.5 cm. Ball: 295 m (Stylecraft Special DK, 295 m per 100 g). Extra: 10%.',
        'An estimate: one stitch per cell; yarn carried inside the stitches (tapestry crochet),',
        'ends, a foundation chain and borders are not counted. Lengths and balls are rounded up.',
        '',
        'White (#ffffff), nearest Stylecraft Special DK 1001 White: 1000 stitches, 28 m, 1 ball',
        'Black (#000000): 1 stitch, 1 m, 1 ball',
        '',
        'Total: 1001 stitches, 28 m, 2 balls',
        '',
      ].join('\n'),
    )
  })

  it('in yards, with no ball length', () => {
    const inputs = { yarnPerStitchCm: 2.54, ballMetres: null, marginPercent: 0 }
    const text = usageText(yarnUsage([entry('A', '#000000', 36)], inputs), {
      patternName: 'P',
      inputs,
      units: 'imperial',
      ballNote: null,
    })
    expect(text).toContain('Yarn per stitch: 1 in. Ball: unknown, so no balls are counted. Extra: 0%.')
    expect(text).toContain('A (#000000): 36 stitches, 1 yd\n')
    expect(text).toContain('Total: 36 stitches, 1 yd\n')
  })
})
